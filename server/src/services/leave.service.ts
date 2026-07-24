import type { Knex } from 'knex';
import db from '../config/database';
import { NotFoundError, ValidationError, ForbiddenError } from '../utils/errors';
import { notifyEmployee } from './notification.service';
import { countWorkingDaysInRange } from './payableDays.service';
import { LOCK, advisoryXactLock } from '../utils/locks';
import { INDIAN_STATES } from './statutory.service';
import {
  getTemplateRulesForEmployees, getEmployeeLeaveRule, ensureDefaultTemplate, type LeaveRule,
} from './leaveTemplate.service';

/** Inclusive list of 'YYYY-MM-DD' dates between start and end (capped for safety). */
function enumerateDates(start: string, end: string): string[] {
  const out: string[] = [];
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return out;
  for (let t = s.getTime(); t <= e.getTime() && out.length < 400; t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Reflects approved leave on the attendance calendar: every day in the range is
 * upserted as 'on_leave' (overriding any prior mark). This both shows on the
 * calendar and provides the data a Loss-of-Pay calculation reads.
 */
async function markLeaveDaysOnAttendance(
  trx: Knex.Transaction, employeeId: number, startDate: string, endDate: string,
) {
  for (const date of enumerateDates(startDate, endDate)) {
    const existing = await trx('attendance_records').where({ employee_id: employeeId, date }).first();
    if (existing) {
      await trx('attendance_records').where('id', existing.id).update({
        status: 'on_leave', check_in: null, check_out: null, working_hours: 0, updated_at: trx.fn.now(),
      });
    } else {
      await trx('attendance_records').insert({ employee_id: employeeId, date, status: 'on_leave', working_hours: 0 });
    }
  }
}

// ─── Leave Types + policy ───

const LT_BOOL_COLS = ['is_paid', 'is_active', 'is_encashable', 'half_day_allowed', 'after_probation_only', 'count_sandwich_days'];
const ELIGIBILITY_OPTS = ['any', 'female', 'male'];
const truthy = (v: any) => v === true || v === 1 || v === '1' || v === 'true';

// SQLite stores booleans as 0/1 — hand the client real booleans for form hydration.
function mapLeaveType(row: any) {
  if (!row) return row;
  const out: any = { ...row };
  for (const c of LT_BOOL_COLS) if (c in out && out[c] !== null && out[c] !== undefined) out[c] = !!out[c];
  return out;
}

/** Positive int, else null (blank/0 = no restriction). */
function policyInt(v: any): number | null {
  if (v === '' || v === null || v === undefined) return null;
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Editable policy columns present in `data` (partial-safe — absent keys unchanged). */
function collectPolicy(data: any): Record<string, any> {
  const out: Record<string, any> = {};
  if ('min_days_per_request' in data) out.min_days_per_request = policyInt(data.min_days_per_request);
  if ('max_days_per_request' in data) out.max_days_per_request = policyInt(data.max_days_per_request);
  if ('advance_notice_days' in data) out.advance_notice_days = policyInt(data.advance_notice_days);
  if ('document_required_after_days' in data) out.document_required_after_days = policyInt(data.document_required_after_days);
  if ('half_day_allowed' in data) out.half_day_allowed = truthy(data.half_day_allowed);
  if ('after_probation_only' in data) out.after_probation_only = truthy(data.after_probation_only);
  if ('count_sandwich_days' in data) out.count_sandwich_days = truthy(data.count_sandwich_days);
  if ('eligibility' in data) out.eligibility = ELIGIBILITY_OPTS.includes(data.eligibility) ? data.eligibility : 'any';
  return out;
}

/**
 * Replace a type's conflict set, keeping the matrix symmetric: every pair touching
 * this type (either direction) is removed, then each chosen type is linked both
 * ways — so "Casual blocks Privilege" ⇒ "Privilege blocks Casual".
 */
async function setConflicts(trx: Knex.Transaction, typeId: number, rawIds: any[]) {
  const ids = [...new Set((rawIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0 && n !== typeId))];
  const valid: number[] = ids.length ? await trx('leave_types').whereIn('id', ids).pluck('id') : [];
  await trx('leave_type_conflicts').where('leave_type_id', typeId).orWhere('conflict_leave_type_id', typeId).del();
  const rows = valid.flatMap((other) => [
    { leave_type_id: typeId, conflict_leave_type_id: other },
    { leave_type_id: other, conflict_leave_type_id: typeId },
  ]);
  if (rows.length) await trx('leave_type_conflicts').insert(rows).onConflict(['leave_type_id', 'conflict_leave_type_id']).ignore();
}

/**
 * Replace a type's allowed-department set. Unlike conflicts this is one-directional:
 * no rows means "every department", so clearing the list lifts the restriction.
 */
async function setDepartments(trx: Knex.Transaction, typeId: number, rawIds: any[]) {
  const ids = [...new Set((rawIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const valid: number[] = ids.length ? await trx('departments').whereIn('id', ids).pluck('id') : [];
  await trx('leave_type_departments').where('leave_type_id', typeId).del();
  if (valid.length) {
    await trx('leave_type_departments')
      .insert(valid.map((department_id) => ({ leave_type_id: typeId, department_id })))
      .onConflict(['leave_type_id', 'department_id']).ignore();
  }
}

/**
 * Whether an employee's recorded gender satisfies a leave type's `eligibility`.
 *
 * Strict, like the department rule: a gender-restricted type (Maternity, Paternity)
 * needs the gender ON RECORD to match, so an employee with no gender recorded can't
 * take it. Missing data never widens access. `eligibility: 'any'` restricts nothing,
 * and a gender of 'other' satisfies neither 'female' nor 'male'.
 *
 * The single definition — checkLeavePolicy (the gate), getLeaveTypes (the apply
 * dropdown) and getEffectiveBalances (the balances grid) all call this, so what an
 * employee sees and what they can submit never disagree.
 */
function genderAllows(eligibility?: string | null, gender?: string | null): boolean {
  if (!eligibility || eligibility === 'any') return true;
  return eligibility === gender;
}

/** Employees carry their department as free text — resolve it to a departments.id. */
async function departmentIdByName(name?: string | null): Promise<number | null> {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  const dept = await db('departments').whereRaw('lower(name) = lower(?)', [trimmed]).first();
  return dept?.id ?? null;
}

/** Attach each type's `cannot_club_with` + `departments` lists (one query each, grouped) + map booleans. */
async function withRelations(types: any[]): Promise<any[]> {
  if (!types.length) return types;
  const [conflicts, depts] = await Promise.all([
    db('leave_type_conflicts').select('leave_type_id', 'conflict_leave_type_id'),
    db('leave_type_departments as ltd')
      .join('departments as d', 'd.id', 'ltd.department_id')
      .select('ltd.leave_type_id', 'ltd.department_id', 'd.name as department_name')
      .orderBy('d.name'),
  ]);
  const conflictsByType = new Map<number, number[]>();
  for (const r of conflicts) {
    const list = conflictsByType.get(r.leave_type_id) ?? [];
    list.push(r.conflict_leave_type_id);
    conflictsByType.set(r.leave_type_id, list);
  }
  const deptsByType = new Map<number, { ids: number[]; names: string[] }>();
  for (const r of depts) {
    const entry = deptsByType.get(r.leave_type_id) ?? { ids: [], names: [] };
    entry.ids.push(r.department_id);
    entry.names.push(r.department_name);
    deptsByType.set(r.leave_type_id, entry);
  }
  return types.map((t) => ({
    ...mapLeaveType(t),
    cannot_club_with: conflictsByType.get(t.id) ?? [],
    departments: deptsByType.get(t.id)?.ids ?? [],
    department_names: deptsByType.get(t.id)?.names ?? [],
  }));
}

/**
 * Active leave types. Given an employee, hide the types their department can't take
 * — the apply screen is the only caller, so its dropdown only ever offers leave the
 * employee is allowed to request. (The Control Panel reads `getAllLeaveTypes`, which
 * stays unfiltered so admins keep seeing every type.)
 */
export async function getLeaveTypes(employeeId?: number) {
  const types = await withRelations(await db('leave_types').where('is_active', true).orderBy('name'));
  if (!employeeId) return types;
  const emp = await db('employees').where('id', employeeId).select('dept_name', 'gender').first();
  const deptId = await departmentIdByName(emp?.dept_name);
  return types.filter((t: any) =>
    (!t.departments.length || (deptId !== null && t.departments.includes(deptId)))
    && genderAllows(t.eligibility, emp?.gender));
}

/** All leave types incl. inactive — for the Control Panel. */
export async function getAllLeaveTypes() {
  return withRelations(await db('leave_types').orderBy('name'));
}

export async function createLeaveType(data: {
  name: string; default_days: number; is_paid?: boolean; is_encashable?: boolean;
}) {
  const name = String(data.name || '').trim();
  if (!name) throw new ValidationError('Leave type name is required');
  const dup = await db('leave_types').whereRaw('lower(name) = lower(?)', [name]).first();
  if (dup) throw new ValidationError('A leave type with this name already exists');
  const defaultDays = Number(data.default_days);
  if (!Number.isFinite(defaultDays) || defaultDays < 0 || defaultDays > 366) {
    throw new ValidationError('Default days must be between 0 and 366');
  }
  const id = await db.transaction(async (trx) => {
    const [{ id: newId }] = await trx('leave_types').insert({
      name, default_days: defaultDays,
      is_paid: data.is_paid === undefined ? true : !!data.is_paid,
      is_encashable: !!data.is_encashable,
      is_active: true,
      ...collectPolicy(data),
    }).returning('id');
    if ('cannot_club_with' in data) await setConflicts(trx, newId, (data as any).cannot_club_with);
    if ('departments' in data) await setDepartments(trx, newId, (data as any).departments);
    return newId;
  });
  // A new active type is unusable until it's in a template — add it to the Default plan so
  // it works immediately for everyone on Default (the migration-time invariant), instead of
  // being silently orphaned (un-appliable, un-encashable, dropped from F&F).
  await ensureDefaultTemplate();
  return (await getAllLeaveTypes()).find((t: any) => t.id === id);
}

export async function updateLeaveType(id: number, data: any) {
  const existing = await db('leave_types').where('id', id).first();
  if (!existing) throw new NotFoundError('Leave type');
  const patch: any = {};
  if ('name' in data) {
    const name = String(data.name || '').trim();
    if (!name) throw new ValidationError('Leave type name is required');
    const dup = await db('leave_types').whereRaw('lower(name) = lower(?)', [name]).whereNot('id', id).first();
    if (dup) throw new ValidationError('A leave type with this name already exists');
    patch.name = name;
  }
  if ('default_days' in data) {
    const d = Number(data.default_days);
    if (!Number.isFinite(d) || d < 0 || d > 366) throw new ValidationError('Default days must be between 0 and 366');
    patch.default_days = d;
  }
  if ('is_paid' in data) patch.is_paid = !!data.is_paid;
  if ('is_encashable' in data) patch.is_encashable = !!data.is_encashable;
  if ('is_active' in data) patch.is_active = !!data.is_active;
  Object.assign(patch, collectPolicy(data));

  await db.transaction(async (trx) => {
    await trx('leave_types').where('id', id).update({ ...patch, updated_at: trx.fn.now() });
    if ('cannot_club_with' in data) await setConflicts(trx, id, data.cannot_club_with);
    if ('departments' in data) await setDepartments(trx, id, data.departments);
  });
  // Reactivating a type that predates its template (e.g. it was inactive when 012 ran) leaves
  // it with no Default row; reconcile so a type that just became active is usable on Default.
  if (patch.is_active === true) await ensureDefaultTemplate();
  return (await getAllLeaveTypes()).find((t: any) => t.id === id);
}

/**
 * Hard-delete a leave type. Blocked when it has any history (leave requests,
 * allocations, or encashments) — deleting it would orphan those records — so the
 * caller is told to deactivate it instead.
 */
export async function deleteLeaveType(id: number) {
  const existing = await db('leave_types').where('id', id).first();
  if (!existing) throw new NotFoundError('Leave type');

  const [reqs, ents, enc] = await Promise.all([
    db('leave_requests').where('leave_type_id', id).count({ c: '*' }).first(),
    db('leave_entitlements').where('leave_type_id', id).count({ c: '*' }).first(),
    db('leave_encashments').where('leave_type_id', id).count({ c: '*' }).first(),
  ]);
  const inUse = Number((reqs as any)?.c || 0) + Number((ents as any)?.c || 0) + Number((enc as any)?.c || 0);
  if (inUse > 0) {
    throw new ValidationError('This leave type is in use (it has leave requests, allocations or encashments). Deactivate it instead of deleting.');
  }

  await db('leave_types').where('id', id).del();
  return { id };
}

// ─── Leave Periods ───

export async function getLeavePeriods() {
  return db('leave_periods').orderBy('start_date', 'desc');
}

export async function getCurrentPeriod() {
  const period = await db('leave_periods').where('is_current', true).first();
  if (!period) throw new NotFoundError('Current leave period');
  return period;
}

export async function createLeavePeriod(data: { name: string; start_date: string; end_date: string }) {
  const name = String(data.name || '').trim();
  if (!name) throw new ValidationError('Period name is required');
  const dup = await db('leave_periods').whereRaw('lower(name) = lower(?)', [name]).first();
  if (dup) throw new ValidationError('A leave period with this name already exists');
  if (!data.start_date || !data.end_date || data.end_date <= data.start_date) {
    throw new ValidationError('End date must be after the start date');
  }
  const [{ id }] = await db('leave_periods').insert({
    name, start_date: data.start_date, end_date: data.end_date, is_current: false,
  }).returning('id');
  return db('leave_periods').where('id', id).first();
}

/** Makes one period current (exactly one at a time). */
export async function setCurrentPeriod(id: number) {
  const period = await db('leave_periods').where('id', id).first();
  if (!period) throw new NotFoundError('Leave period');
  await db.transaction(async (trx) => {
    await trx('leave_periods').update({ is_current: false });
    await trx('leave_periods').where('id', id).update({ is_current: true, updated_at: trx.fn.now() });
  });
  return db('leave_periods').where('id', id).first();
}

// ─── Entitlements (allocation) ───

/**
 * Allocation grid: every active employee with their entitlements for a period.
 */
export async function getEntitlements(filters: { period_id: number; search?: string; branch?: string }) {
  const employeesQuery = db('employees as e')
    .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
    .where('e.is_active', true)
    .select('e.id', 'e.employee_code', 'e.first_name', 'e.last_name', 'e.branch_name', 'jt.title as designation')
    .orderBy('e.first_name');
  if (filters.branch) employeesQuery.where('e.branch_name', filters.branch);
  if (filters.search && filters.search.trim()) {
    const term = `%${filters.search.trim()}%`;
    employeesQuery.where(function (this: any) {
      this.where('e.first_name', 'ilike', term)
        .orWhere('e.last_name', 'ilike', term)
        .orWhere('e.employee_code', 'ilike', term)
        .orWhereRaw("(e.first_name || ' ' || e.last_name) ilike ?", [term]);
    });
  }
  const employees = await employeesQuery;

  const entitlements = await db('leave_entitlements')
    .where('leave_period_id', filters.period_id)
    .select('employee_id', 'leave_type_id', 'total_days', 'used_days');
  const byEmployee = new Map<number, any[]>();
  for (const ent of entitlements) {
    const list = byEmployee.get(ent.employee_id) ?? [];
    list.push({ leave_type_id: ent.leave_type_id, total_days: Number(ent.total_days), used_days: Number(ent.used_days) });
    byEmployee.set(ent.employee_id, list);
  }

  return employees.map((e: any) => ({ ...e, entitlements: byEmployee.get(e.id) ?? [] }));
}

/** Sets one employee's allocation for a leave type in a period. */
export async function upsertEntitlement(data: {
  employee_id: number; leave_type_id: number; leave_period_id: number; total_days: number;
}) {
  const employee = await db('employees').where('id', Number(data.employee_id)).first();
  if (!employee) throw new NotFoundError('Employee');
  const leaveType = await db('leave_types').where('id', Number(data.leave_type_id)).first();
  if (!leaveType) throw new NotFoundError('Leave type');
  const period = await db('leave_periods').where('id', Number(data.leave_period_id)).first();
  if (!period) throw new NotFoundError('Leave period');
  const totalDays = Number(data.total_days);
  if (!Number.isFinite(totalDays) || totalDays < 0 || totalDays > 366) {
    throw new ValidationError('Allocated days must be between 0 and 366');
  }

  const key = { employee_id: employee.id, leave_type_id: leaveType.id, leave_period_id: period.id };
  const existing = await db('leave_entitlements').where(key).first();
  if (existing) {
    if (totalDays < Number(existing.used_days)) {
      throw new ValidationError(`Cannot allocate ${totalDays} — ${existing.used_days} day(s) already used`);
    }
    await db('leave_entitlements').where('id', existing.id).update({ total_days: totalDays, updated_at: db.fn.now() });
  } else {
    await db('leave_entitlements').insert({ ...key, total_days: totalDays, used_days: 0 });
  }
  return db('leave_entitlements').where(key).first();
}

/**
 * Control Panel bulk allocation: sets total_days for one leave type across many
 * employees in a period. Existing rows keep their used_days.
 */
export async function bulkAllocate(data: {
  leave_period_id: number; leave_type_id: number; days: number; employee_ids: number[];
}) {
  const leaveType = await db('leave_types').where('id', Number(data.leave_type_id)).first();
  if (!leaveType) throw new NotFoundError('Leave type');
  const period = await db('leave_periods').where('id', Number(data.leave_period_id)).first();
  if (!period) throw new NotFoundError('Leave period');
  const days = Number(data.days);
  if (!Number.isFinite(days) || days < 0 || days > 366) throw new ValidationError('Days must be between 0 and 366');
  if (!Array.isArray(data.employee_ids) || data.employee_ids.length === 0) {
    throw new ValidationError('Select at least one employee');
  }

  let created = 0;
  let updated = 0;
  const skipped: string[] = [];
  await db.transaction(async (trx) => {
    for (const rawId of data.employee_ids) {
      const employeeId = Number(rawId);
      const existing = await trx('leave_entitlements')
        .where({ employee_id: employeeId, leave_type_id: leaveType.id, leave_period_id: period.id })
        .first();
      if (existing) {
        if (days < Number(existing.used_days)) {
          skipped.push(`employee ${employeeId}: ${existing.used_days} day(s) already used`);
          continue;
        }
        await trx('leave_entitlements').where('id', existing.id).update({ total_days: days, updated_at: trx.fn.now() });
        updated += 1;
      } else {
        await trx('leave_entitlements').insert({
          employee_id: employeeId, leave_type_id: leaveType.id, leave_period_id: period.id,
          total_days: days, used_days: 0,
        });
        created += 1;
      }
    }
  });
  return { created, updated, skipped };
}

// ─── Leave Balances ───

export type BalanceSource = 'entitlement' | 'default';

export interface EffectiveBalance {
  employee_id: number;
  leave_type_id: number;
  leave_type: string;
  is_paid: boolean;
  /** False when the type is restricted to departments this employee isn't in (migration 070). */
  applicable: boolean;
  /** Where `allocated` came from: an explicit entitlement row, or the type's default_days. */
  source: BalanceSource;
  allocated: number;
  /** Days on approved requests starting in this period. */
  taken: number;
  /** Days on pending requests starting in this period. */
  pending: number;
  /** Exactly the number applyLeave gates on — see the note below. */
  available: number;
  /** The stored counter, when an entitlement row exists. Null otherwise. */
  used_days: number | null;
}

/**
 * The one definition of "leave balance". applyLeave, getMyBalances and the admin
 * balances overview all read this — there is no second copy.
 *
 * `available` reproduces applyLeave's gate exactly, which means it is deliberately
 * asymmetric, because the underlying data is:
 *
 *   - entitlement row  → total_days − used_days. `used_days` is a stored counter
 *     bumped only on approval (approveLeave) and on encashment approval, so
 *     PENDING requests do not reduce it.
 *   - no entitlement   → default_days − (approved + pending) days booked this period,
 *     so PENDING requests DO reduce it.
 *
 * `taken` and `pending` are always summed from leave_requests, so a caller can see
 * the difference rather than have it averaged away. For entitlement rows `used_days`
 * and `taken` can legitimately disagree (encashment bumps the counter; an entitlement
 * created after leave was approved starts at 0).
 *
 * Bulk by construction: a fixed number of queries regardless of how many employees
 * are passed in.
 */
export async function getEffectiveBalances(
  employeeIds: number[],
  periodId: number,
  opts: { leaveTypeIds?: number[] } = {},
): Promise<EffectiveBalance[]> {
  if (!employeeIds.length) return [];
  const period = await db('leave_periods').where('id', periodId).first();
  if (!period) throw new NotFoundError('Leave period');

  // No leaveTypeIds = the types an employee could actually apply for (active only).
  // applyLeave passes an explicit id so it keeps gating inactive types as it always has.
  const typesQuery = db('leave_types').select('id', 'name', 'is_paid', 'default_days', 'eligibility').orderBy('name');
  if (opts.leaveTypeIds) typesQuery.whereIn('id', opts.leaveTypeIds);
  else typesQuery.where('is_active', true);

  const [employees, departments, leaveTypes, restrictions, entitlements, booked, templateRules] = await Promise.all([
    db('employees').whereIn('id', employeeIds).select('id', 'dept_name', 'gender'),
    db('departments').select('id', 'name'),
    typesQuery,
    db('leave_type_departments').select('leave_type_id', 'department_id'),
    db('leave_entitlements').where('leave_period_id', periodId).whereIn('employee_id', employeeIds)
      .select('employee_id', 'leave_type_id', 'total_days', 'used_days'),
    // Same window applyLeave uses: requests whose start_date falls in the period.
    db('leave_requests').whereIn('employee_id', employeeIds)
      .whereIn('status', ['pending', 'approved'])
      .whereBetween('start_date', [period.start_date, period.end_date])
      .groupBy('employee_id', 'leave_type_id', 'status')
      .select('employee_id', 'leave_type_id', 'status')
      .sum({ total: 'days' }),
    // Each employee's effective per-type rules from their assigned template (NULL → Default).
    getTemplateRulesForEmployees(employeeIds),
  ]);

  // Mirror departmentIdByName: trim the employee's text, compare case-insensitively.
  const deptIdByName = new Map<string, number>();
  for (const d of departments) deptIdByName.set(String(d.name).toLowerCase(), d.id);
  const deptIdOf = (deptName: any): number | null => {
    const trimmed = String(deptName || '').trim();
    if (!trimmed) return null;
    return deptIdByName.get(trimmed.toLowerCase()) ?? null;
  };

  const allowedByType = new Map<number, Set<number>>();
  for (const r of restrictions) {
    const set = allowedByType.get(r.leave_type_id) ?? new Set<number>();
    set.add(r.department_id);
    allowedByType.set(r.leave_type_id, set);
  }

  const key = (employeeId: number, leaveTypeId: number) => `${employeeId}:${leaveTypeId}`;
  const entByKey = new Map<string, any>();
  for (const e of entitlements) entByKey.set(key(e.employee_id, e.leave_type_id), e);
  const takenByKey = new Map<string, number>();
  const pendingByKey = new Map<string, number>();
  for (const b of booked as any[]) {
    const target = b.status === 'approved' ? takenByKey : pendingByKey;
    target.set(key(b.employee_id, b.leave_type_id), Number(b.total || 0));
  }

  const out: EffectiveBalance[] = [];
  for (const emp of employees) {
    const deptId = deptIdOf(emp.dept_name);
    const empRules = templateRules.get(emp.id);
    for (const lt of leaveTypes) {
      // The employee's own rule for this type from their template. Its absence means the
      // template doesn't grant this leave — it shows as not-applicable. (Days, paid/unpaid
      // and eligibility all come from the template now; for anyone on Default these are
      // byte-for-byte the leave_types values.)
      const rule = empRules?.get(lt.id);
      const allowed = allowedByType.get(lt.id);
      const k = key(emp.id, lt.id);
      const ent = entByKey.get(k);
      const taken = takenByKey.get(k) ?? 0;
      const pending = pendingByKey.get(k) ?? 0;
      const defaultDays = rule ? rule.default_days : Number(lt.default_days || 0);
      const allocated = ent ? Number(ent.total_days) : defaultDays;
      out.push({
        employee_id: emp.id,
        leave_type_id: lt.id,
        leave_type: lt.name,
        is_paid: rule ? rule.is_paid : !!lt.is_paid,
        // Applicable only if the template includes this type AND (dept rule, unchanged) AND
        // a gender-restricted type (Maternity/Paternity) matches the recorded gender.
        applicable: !!rule
          && (!allowed || (deptId !== null && allowed.has(deptId)))
          && genderAllows(rule ? rule.eligibility : lt.eligibility, emp.gender),
        source: ent ? 'entitlement' : 'default',
        allocated,
        taken,
        pending,
        available: ent ? Number(ent.total_days) - Number(ent.used_days) : allocated - taken - pending,
        used_days: ent ? Number(ent.used_days) : null,
      });
    }
  }
  return out;
}

/** Self-service balances: every type the employee may apply for, allocation row or not. */
export async function getMyBalances(employeeId: number) {
  const period = await getCurrentPeriod();
  const balances = await getEffectiveBalances([employeeId], period.id);
  return balances.filter((b) => b.applicable);
}

/**
 * Admin grid: every active employee x every active leave type, for one period.
 * Types a department can't take report applicable:false with null allocated/available,
 * so the client can render "not applicable" rather than a misleading zero.
 */
export async function getBalancesOverview(filters: {
  period_id?: number; search?: string; branch?: string; dept?: string;
}) {
  const period = filters.period_id
    ? await db('leave_periods').where('id', filters.period_id).first()
    : await getCurrentPeriod();
  if (!period) throw new NotFoundError('Leave period');

  const employeesQuery = db('employees as e')
    .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
    .where('e.is_active', true)
    .select('e.id', 'e.employee_code', 'e.first_name', 'e.last_name', 'e.branch_name', 'e.dept_name', 'jt.title as designation')
    .orderBy('e.first_name');
  if (filters.branch) employeesQuery.where('e.branch_name', filters.branch);
  if (filters.dept) employeesQuery.where('e.dept_name', filters.dept);
  if (filters.search && filters.search.trim()) {
    const term = `%${filters.search.trim()}%`;
    employeesQuery.where(function (this: any) {
      this.where('e.first_name', 'ilike', term)
        .orWhere('e.last_name', 'ilike', term)
        .orWhere('e.employee_code', 'ilike', term)
        .orWhereRaw("(e.first_name || ' ' || e.last_name) ilike ?", [term]);
    });
  }
  const employees = await employeesQuery;

  // Column headers stand alone, so they survive an empty employee list.
  const leaveTypes = await db('leave_types').where('is_active', true)
    .select('id', 'name', 'is_paid').orderBy('name');

  const balances = await getEffectiveBalances(employees.map((e: any) => e.id), period.id);
  const byEmployee = new Map<number, any[]>();
  for (const b of balances) {
    const list = byEmployee.get(b.employee_id) ?? [];
    list.push(b.applicable ? b : { ...b, allocated: null, available: null });
    byEmployee.set(b.employee_id, list);
  }

  return {
    period: {
      id: period.id, name: period.name,
      start_date: period.start_date, end_date: period.end_date, is_current: !!period.is_current,
    },
    leave_types: leaveTypes.map((t: any) => ({ id: t.id, name: t.name, is_paid: !!t.is_paid })),
    employees: employees.map((e: any) => ({ ...e, balances: byEmployee.get(e.id) ?? [] })),
  };
}

// ─── Leave Requests ───

export async function getMyLeaves(employeeId: number, filters: { status?: string; leave_type_id?: string }) {
  const query = db('leave_requests')
    .join('leave_types', 'leave_types.id', 'leave_requests.leave_type_id')
    .leftJoin('employees as approver', 'approver.id', 'leave_requests.approved_by')
    .where('leave_requests.employee_id', employeeId)
    .select(
      'leave_requests.*',
      'leave_types.name as leave_type',
      db.raw("COALESCE(approver.first_name || ' ' || approver.last_name, '') as approved_by_name")
    )
    .orderBy('leave_requests.created_at', 'desc');

  if (filters.status) query.where('leave_requests.status', filters.status);
  if (filters.leave_type_id) query.where('leave_requests.leave_type_id', filters.leave_type_id);

  return query;
}

/** Whole days from today to a start date (negative if in the past). */
function daysUntilStart(startDate: string): number {
  const t = new Date();
  const t0 = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
  const [y, m, d] = startDate.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - t0) / 86400000);
}
function shiftDate(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * Enforces the admin-configured policy rules for a leave type on one request.
 * Throws a specific ValidationError on the first rule that fails; returns any
 * non-blocking warnings. Runs for both employee-apply and HR apply-on-behalf.
 */
async function checkLeavePolicy(
  employeeId: number, employee: any, leaveType: any, rule: LeaveRule, start: string, end: string, days: number,
): Promise<string[]> {
  const warnings: string[] = [];
  const name = leaveType.name;

  // Every scalar rule now comes from the employee's TEMPLATE row (`rule`), not the
  // company-wide leave_types row — so two employees on different plans are gated
  // differently. The leave_types row still supplies the display name + the department
  // rule (kept a catalog property, since templates don't carry departments).
  if (rule.min_days_per_request && days < rule.min_days_per_request) {
    throw new ValidationError(`${name} must be a continuous block of at least ${rule.min_days_per_request} day(s).`);
  }
  if (rule.max_days_per_request && days > rule.max_days_per_request) {
    throw new ValidationError(`${name} can be at most ${rule.max_days_per_request} day(s) per request.`);
  }
  if (rule.advance_notice_days && daysUntilStart(start) < rule.advance_notice_days) {
    throw new ValidationError(`${name} must be applied at least ${rule.advance_notice_days} day(s) before it starts.`);
  }
  if (!rule.half_day_allowed && !Number.isInteger(days)) {
    throw new ValidationError(`Half-day ${name} is not allowed.`);
  }
  // Gender eligibility — strict, like the department rule below: a gender-restricted
  // type needs the gender ON RECORD to match, so an employee with no gender recorded
  // is blocked rather than waved through. Probation, just below, stays lenient (it
  // can't be enforced against an unknown probation date without denying everyone).
  if (!genderAllows(rule.eligibility, employee?.gender)) {
    throw new ValidationError(employee?.gender
      ? `${name} can only be taken by ${rule.eligibility} employees.`
      : `${name} can only be taken by ${rule.eligibility} employees, and no gender is recorded for you. Ask HR to update your profile.`);
  }
  if (rule.after_probation_only && employee?.probation_end_date
    && new Date().toISOString().slice(0, 10) < String(employee.probation_end_date).slice(0, 10)) {
    throw new ValidationError(`${name} is available only after your probation period ends.`);
  }
  // Department applicability — no rows configured means every department. Unlike the
  // gender/probation rules above this one is strict: a restricted type stays blocked
  // when the employee's department is missing or unrecognised, so a typo in dept_name
  // can never widen access.
  const allowedDeptIds: number[] = await db('leave_type_departments').where('leave_type_id', leaveType.id).pluck('department_id');
  if (allowedDeptIds.length) {
    const empDeptId = await departmentIdByName(employee?.dept_name);
    if (empDeptId === null || !allowedDeptIds.includes(empDeptId)) {
      const allowed: string[] = await db('departments').whereIn('id', allowedDeptIds).orderBy('name').pluck('name');
      throw new ValidationError(employee?.dept_name
        ? `${name} isn't available to the ${employee.dept_name} department. It applies to: ${allowed.join(', ')}.`
        : `${name} applies only to specific departments (${allowed.join(', ')}), and no department is set on this employee.`);
    }
  }
  // Cannot be clubbed with — adjacent (±1 day) or overlapping request of a conflicting type.
  // The conflict set now comes from the employee's template row, not leave_type_conflicts.
  const conflicts: number[] = rule.conflicts ?? [];
  if (conflicts.length) {
    const clash = await db('leave_requests as lr')
      .join('leave_types as lt', 'lt.id', 'lr.leave_type_id')
      .where('lr.employee_id', employeeId)
      .whereIn('lr.status', ['pending', 'approved'])
      .whereIn('lr.leave_type_id', conflicts)
      .where('lr.start_date', '<=', shiftDate(end, 1))
      .where('lr.end_date', '>=', shiftDate(start, -1))
      .select('lt.name').first();
    if (clash) {
      throw new ValidationError(`${name} can't be combined with ${clash.name} (you have ${clash.name} on an adjacent or overlapping day).`);
    }
  }
  if (rule.document_required_after_days && days > rule.document_required_after_days) {
    warnings.push(`${name} beyond ${rule.document_required_after_days} day(s) needs a supporting document — please keep it ready.`);
  }
  return warnings;
}

export async function applyLeave(employeeId: number, data: {
  leave_type_id: number;
  start_date: string;
  end_date: string;
  reason: string;
}) {
  const { leave_type_id, start_date, end_date, reason } = data;

  if (new Date(start_date) > new Date(end_date)) {
    throw new ValidationError('Start date must be before or equal to end date');
  }

  const leaveType = await db('leave_types').where('id', leave_type_id).first();
  if (!leaveType) throw new NotFoundError('Leave type');

  // The employee's rule for this leave type comes from their assigned template. If the
  // template doesn't include this type, their plan doesn't grant it.
  const rule = await getEmployeeLeaveRule(employeeId, leave_type_id);
  if (!rule) throw new ValidationError(`${leaveType.name} is not part of your leave plan.`);

  // Sandwich policy: when ON, holidays/weekly-offs between leave days count too
  // (all calendar days); default OFF counts only the employee's working days (one
  // calendar everywhere — so leave balance and payroll LOP agree).
  const days = rule.count_sandwich_days
    ? enumerateDates(start_date, end_date).length
    : await countWorkingDaysInRange(employeeId, start_date, end_date);
  if (days <= 0) throw new ValidationError('Leave must be at least 1 day for this employee');

  const period = await getCurrentPeriod();
  const employee = await db('employees').where('id', employeeId)
    .select('first_name', 'last_name', 'reporting_manager_id', 'gender', 'probation_end_date', 'dept_name').first();
  if (!employee) throw new NotFoundError('Employee');

  // Balance (rule 1): an explicit allocation wins; otherwise the leave type's
  // "Default days per year" is the balance, less what's already taken this period.
  // getEffectiveBalances is the single definition — see its doc comment.
  // Check-then-insert must be atomic PER EMPLOYEE. PostgreSQL is MVCC, so two requests submitted at
  // the same time would each see the same balance and no overlap, and both insert — overspending the
  // balance or double-booking the dates. (SQLite's single-writer rule hid this; there was no
  // transaction here at all.) The advisory lock serialises applications for this employee, so the
  // reads below — including the helpers that use the shared `db` handle — see a settled state.
  const { id, policyWarnings } = await db.transaction(async (trx) => {
    await advisoryXactLock(trx, LOCK.LEAVE_APPLY, employeeId);

    const [balance] = await getEffectiveBalances([employeeId], period.id, { leaveTypeIds: [leave_type_id] });
    const available = balance ? balance.available : 0;
    if (days > available) {
      throw new ValidationError(`Insufficient ${leaveType.name} balance. Available: ${available} day(s), requested: ${days} day(s).`);
    }

    const overlap = await trx('leave_requests')
      .where('employee_id', employeeId)
      .whereIn('status', ['pending', 'approved'])
      .where(function () {
        this.where('start_date', '<=', end_date).andWhere('end_date', '>=', start_date);
      })
      .first();
    if (overlap) throw new ValidationError('You already have a leave request overlapping these dates');

    // Configurable policy rules (min/max/notice/half-day/eligibility/probation/clubbing).
    const warnings = await checkLeavePolicy(employeeId, employee, leaveType, rule, start_date, end_date, days);

    const [{ id: newId }] = await trx('leave_requests').insert({
      employee_id: employeeId,
      leave_type_id,
      start_date,
      end_date,
      days,
      reason,
      status: 'pending',
    }).returning('id');

    return { id: newId, policyWarnings: warnings };
  });

  // Alert the approver (reporting manager) that a request awaits action.
  if (employee.reporting_manager_id) {
    await notifyEmployee(employee.reporting_manager_id, {
      type: 'leave_requested',
      title: 'Leave request to review',
      message: `${employee.first_name} ${employee.last_name} requested ${days} day(s) leave (${start_date} to ${end_date}).`,
      link: '/leaves/my?tab=approvals',
    });
  }

  const created = await db('leave_requests')
    .join('leave_types', 'leave_types.id', 'leave_requests.leave_type_id')
    .where('leave_requests.id', id)
    .select('leave_requests.*', 'leave_types.name as leave_type')
    .first();
  return { ...created, warnings: policyWarnings };
}

export async function cancelLeave(requestId: number, employeeId: number) {
  const leave = await db('leave_requests').where('id', requestId).first();
  if (!leave) throw new NotFoundError('Leave request');
  if (leave.employee_id !== employeeId) throw new ForbiddenError('Not your leave request');
  if (leave.status !== 'pending') throw new ValidationError('Can only cancel pending requests');

  await db('leave_requests').where('id', requestId).update({ status: 'cancelled', updated_at: db.fn.now() });
  return { message: 'Leave request cancelled' };
}

// ─── Approvals ───

export async function getPendingApprovals(approverId: number, roleName: string) {
  const query = db('leave_requests')
    .join('employees', 'employees.id', 'leave_requests.employee_id')
    .join('leave_types', 'leave_types.id', 'leave_requests.leave_type_id')
    .where('leave_requests.status', 'pending')
    .select(
      'leave_requests.*',
      'employees.first_name',
      'employees.last_name',
      'employees.employee_code',
      'leave_types.name as leave_type',
      'employees.dept_name',
      'employees.branch_name'
    )
    .orderBy('leave_requests.created_at', 'asc');

  if (['admin', 'chro', 'hr'].includes(roleName)) {
    return query;
  }

  return query.where('employees.reporting_manager_id', approverId);
}

export async function getAllLeaves(filters: { status?: string; employee_id?: string; branch_name?: string }) {
  const query = db('leave_requests')
    .join('employees', 'employees.id', 'leave_requests.employee_id')
    .join('leave_types', 'leave_types.id', 'leave_requests.leave_type_id')
    .leftJoin('employees as approver', 'approver.id', 'leave_requests.approved_by')
    .select(
      'leave_requests.*',
      'employees.first_name',
      'employees.last_name',
      'employees.employee_code',
      'leave_types.name as leave_type',
      'employees.dept_name',
      'employees.branch_name',
      db.raw("COALESCE(approver.first_name || ' ' || approver.last_name, '') as approved_by_name")
    )
    .orderBy('leave_requests.created_at', 'desc');

  if (filters.status) query.where('leave_requests.status', filters.status);
  if (filters.employee_id) query.where('leave_requests.employee_id', filters.employee_id);
  if (filters.branch_name) query.where('employees.branch_name', filters.branch_name);

  return query;
}

export async function approveLeave(requestId: number, approverId: number, roleName: string) {
  const leave = await db('leave_requests')
    .join('employees', 'employees.id', 'leave_requests.employee_id')
    .where('leave_requests.id', requestId)
    .select('leave_requests.*', 'employees.reporting_manager_id')
    .first();

  if (!leave) throw new NotFoundError('Leave request');
  if (leave.status !== 'pending') throw new ValidationError('Only pending requests can be approved');

  if (!['admin', 'chro', 'hr'].includes(roleName) && leave.reporting_manager_id !== approverId) {
    throw new ForbiddenError('Only the reporting manager or HR can approve this request');
  }

  const period = await getCurrentPeriod();

  // Atomic: approve, consume entitlement, and reflect the days on attendance together.
  await db.transaction(async (trx) => {
    await trx('leave_requests').where('id', requestId).update({
      status: 'approved',
      approved_by: approverId,
      updated_at: trx.fn.now(),
    });

    await trx('leave_entitlements')
      .where({
        employee_id: leave.employee_id,
        leave_type_id: leave.leave_type_id,
        leave_period_id: period.id,
      })
      .increment('used_days', leave.days);

    await markLeaveDaysOnAttendance(trx, leave.employee_id, leave.start_date, leave.end_date);
  });

  await notifyEmployee(leave.employee_id, {
    type: 'leave_approved',
    title: 'Leave approved',
    message: `Your leave request for ${leave.days} day(s) (${leave.start_date} to ${leave.end_date}) has been approved.`,
    link: '/attendance',
  });

  return { message: 'Leave approved' };
}

export async function rejectLeave(requestId: number, approverId: number, roleName: string, rejectionReason: string) {
  const leave = await db('leave_requests')
    .join('employees', 'employees.id', 'leave_requests.employee_id')
    .where('leave_requests.id', requestId)
    .select('leave_requests.*', 'employees.reporting_manager_id')
    .first();

  if (!leave) throw new NotFoundError('Leave request');
  if (leave.status !== 'pending') throw new ValidationError('Only pending requests can be rejected');

  if (!['admin', 'chro', 'hr'].includes(roleName) && leave.reporting_manager_id !== approverId) {
    throw new ForbiddenError('Only the reporting manager or HR can reject this request');
  }

  await db('leave_requests').where('id', requestId).update({
    status: 'rejected',
    approved_by: approverId,
    rejection_reason: rejectionReason || null,
    updated_at: db.fn.now(),
  });

  await notifyEmployee(leave.employee_id, {
    type: 'leave_rejected',
    title: 'Leave rejected',
    message: rejectionReason
      ? `Your leave request (${leave.start_date} to ${leave.end_date}) was rejected. Reason: ${rejectionReason}`
      : `Your leave request (${leave.start_date} to ${leave.end_date}) was rejected.`,
    link: '/attendance',
  });

  return { message: 'Leave rejected' };
}

// ─── Regions (Admin) ───
// Properties are grouped into user-defined regions; an employee's region is derived
// from their property (employees.branch_name = properties.name).

export async function listRegions() {
  const regions = await db('regions').select('*').orderBy('name');
  const propCounts = await db('properties').whereNotNull('region_id')
    .select('region_id').count({ c: '*' }).groupBy('region_id');
  const holCounts = await db('holidays').whereNotNull('region_id')
    .select('region_id').count({ c: '*' }).groupBy('region_id');
  const pMap = new Map<number, number>(propCounts.map((r: any) => [r.region_id, Number(r.c)]));
  const hMap = new Map<number, number>(holCounts.map((r: any) => [r.region_id, Number(r.c)]));
  return regions.map((r: any) => ({ ...r, property_count: pMap.get(r.id) || 0, holiday_count: hMap.get(r.id) || 0 }));
}

export async function createRegion(data: { name: string; description?: string }) {
  const name = String(data.name || '').trim();
  if (!name) throw new ValidationError('Region name is required.');
  const existing = await db('regions').whereRaw('LOWER(name) = ?', [name.toLowerCase()]).first();
  if (existing) throw new ValidationError('A region with this name already exists.');
  const [{ id }] = await db('regions').insert({ name, description: String(data.description || '').trim() || null }).returning('id');
  return db('regions').where('id', id).first();
}

export async function updateRegion(id: number, data: { name?: string; description?: string }) {
  const region = await db('regions').where('id', id).first();
  if (!region) throw new NotFoundError('Region');
  const patch: any = { updated_at: db.fn.now() };
  if (data.name !== undefined) {
    const name = String(data.name).trim();
    if (!name) throw new ValidationError('Region name is required.');
    const dup = await db('regions').whereRaw('LOWER(name) = ?', [name.toLowerCase()]).whereNot('id', id).first();
    if (dup) throw new ValidationError('A region with this name already exists.');
    patch.name = name;
  }
  if (data.description !== undefined) patch.description = String(data.description || '').trim() || null;
  await db('regions').where('id', id).update(patch);
  return db('regions').where('id', id).first();
}

export async function deleteRegion(id: number) {
  const region = await db('regions').where('id', id).first();
  if (!region) throw new NotFoundError('Region');
  const props = await db('properties').where('region_id', id).count({ c: '*' }).first();
  if (Number(props?.c || 0) > 0) throw new ValidationError('This region has properties assigned. Reassign them before deleting.');
  const hols = await db('holidays').where('region_id', id).count({ c: '*' }).first();
  if (Number(hols?.c || 0) > 0) throw new ValidationError('This region has holidays. Delete or move them before deleting the region.');
  await db('regions').where('id', id).delete();
  return { message: 'Region deleted' };
}

// ─── Property ↔ region mapping (Admin) ───

export async function listPropertiesWithRegion() {
  return db('properties as p')
    .leftJoin('regions as r', 'r.id', 'p.region_id')
    .select('p.id', 'p.name', 'p.city', 'p.state', 'p.region_id', 'r.name as region_name')
    .orderBy('p.name');
}

export async function setPropertyRegion(propertyId: number, regionId: number | null) {
  const p = await db('properties').where('id', propertyId).first();
  if (!p) throw new NotFoundError('Property');
  if (regionId != null) {
    const r = await db('regions').where('id', regionId).first();
    if (!r) throw new NotFoundError('Region');
  }
  await db('properties').where('id', propertyId).update({ region_id: regionId ?? null, updated_at: db.fn.now() });
  return db('properties as p').leftJoin('regions as r', 'r.id', 'p.region_id')
    .where('p.id', propertyId).select('p.id', 'p.name', 'p.region_id', 'r.name as region_name').first();
}

/**
 * Resolve an employee's holiday scope via their property (branch_name =
 * properties.name): the property's state decides which state holidays apply.
 */
export async function getEmployeeRegion(employeeId: number) {
  const emp = await db('employees').where('id', employeeId).select('branch_name').first();
  if (!emp?.branch_name) return null;
  const prop = await db('properties as p')
    .where('p.name', emp.branch_name)
    .select('p.id as property_id', 'p.name as property_name', 'p.state as state').first();
  if (!prop) return null;
  return { property_id: prop.property_id, property_name: prop.property_name, state: prop.state || null };
}

// ─── Holidays (national + per-state) ───

function normalizeDateStr(raw: string): string {
  const s = String(raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return s;
}

function holidayBase() {
  return db('holidays as h').select('h.*');
}

/** Admin view: every holiday; optional scope (national|state) / state / year filters. */
export async function getHolidays(filters: { state?: string; scope?: string; year?: string } = {}) {
  const q = holidayBase().orderBy('h.date');
  if (filters.scope === 'national') q.where('h.is_national', true);
  else if (filters.scope === 'state') q.where('h.is_national', false).whereNotNull('h.state');
  if (filters.state) q.where('h.state', filters.state);
  if (filters.year) q.whereRaw("substr(h.date, 1, 4) = ?", [String(filters.year)]);
  return q;
}

/** Employee view: national holidays + the holidays for the employee's state. */
export async function getMyHolidays(employeeId: number, year?: string) {
  const region = await getEmployeeRegion(employeeId);
  const q = holidayBase().orderBy('h.date');
  q.where(function (this: any) {
    this.where('h.is_national', true);
    if (region?.state) this.orWhere('h.state', region.state);
  });
  if (year) q.whereRaw("substr(h.date, 1, 4) = ?", [String(year)]);
  const holidays = await q;
  return { region, holidays };
}

function normalizeHolidayInput(data: any) {
  const name = String(data.name || '').trim();
  if (!name) throw new ValidationError('Holiday name is required.');
  const date = normalizeDateStr(String(data.date || ''));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ValidationError('A valid date is required (YYYY-MM-DD or DD-MM-YYYY).');
  const is_national = !!data.is_national;
  let state: string | null = null;
  if (!is_national) {
    state = data.state ? String(data.state).trim() : null;
    if (!state) throw new ValidationError('Select a state, or mark the holiday as national.');
    if (!INDIAN_STATES.includes(state)) throw new ValidationError('Unknown state.');
  }
  return { name, date, is_national, state, is_recurring: !!data.is_recurring };
}

export async function createHoliday(data: any) {
  const payload = normalizeHolidayInput(data);
  const [{ id }] = await db('holidays').insert(payload).returning('id');
  return holidayBase().where('h.id', id).first();
}

export async function updateHoliday(id: number, data: any) {
  const existing = await db('holidays').where('id', id).first();
  if (!existing) throw new NotFoundError('Holiday');
  const payload = normalizeHolidayInput(data);
  await db('holidays').where('id', id).update({ ...payload, updated_at: db.fn.now() });
  return holidayBase().where('h.id', id).first();
}

/**
 * Bulk import from CSV (columns: Holiday Name, Date). Targets one scope — national
 * or one state — and REPLACES only that scope's holidays (never a global wipe).
 */
export async function uploadHolidaysCSV(csvText: string, scope: { is_national?: boolean; state?: string }) {
  const is_national = !!scope.is_national;
  let state: string | null = null;
  if (!is_national) {
    state = scope.state ? String(scope.state).trim() : null;
    if (!state) throw Object.assign(new Error('Choose a target: National or a specific state.'), { status: 400 });
    if (!INDIAN_STATES.includes(state)) throw Object.assign(new Error('Unknown state.'), { status: 400 });
  }

  const lines = csvText.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw Object.assign(new Error('CSV must have a header row and at least one data row'), { status: 400 });

  const rows: { name: string; date: string; is_national: boolean; state: string | null }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 2 || !cols[0] || !cols[1]) continue;
    const date = normalizeDateStr(cols[1]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    rows.push({ name: cols[0], date, is_national, state });
  }
  if (rows.length === 0) throw Object.assign(new Error('No valid holiday rows found in CSV'), { status: 400 });

  await db.transaction(async (trx) => {
    if (is_national) await trx('holidays').where('is_national', true).del();
    else await trx('holidays').where('state', state).del();
    await trx('holidays').insert(rows);
  });

  return { inserted: rows.length, scope: is_national ? 'national' : state };
}

export async function deleteHoliday(id: number) {
  const holiday = await db('holidays').where('id', id).first();
  if (!holiday) throw new NotFoundError('Holiday');
  await db('holidays').where('id', id).delete();
}

// ─── Helpers ───
// Leave-day counting now lives in payableDays.countWorkingDaysInRange so leave
// and payroll share one per-employee calendar (Phase 3).
