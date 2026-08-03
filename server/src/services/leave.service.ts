import type { Knex } from 'knex';
import db from '../config/database';
import { NotFoundError, ValidationError, ForbiddenError } from '../utils/errors';
import { notifyEmployee, emit } from './notification.service';
import { buildWorkCalendar, countWorkingDaysInRange, leaveDatesFor } from './payableDays.service';
import { findBreak } from './holidayBreak';   // date shifting uses this file's own shiftDate
import { audienceOf, scopeHolidaysTo } from './holidayScope';
import { LOCK, advisoryXactLock } from '../utils/locks';
import { businessToday } from '../utils/businessDate';
import { INDIAN_STATES } from './statutory.service';
import {
  getTemplateRulesForEmployees, getEmployeeLeaveRule, ensureDefaultTemplate, type LeaveRule,
} from './leaveTemplate.service';
// accrual.service does NOT import this file — see its header. The dependency is one-way on purpose.
import { accrualRuleOf, isAccruing } from './accrual.service';
import { buildSchedule, round6, spendableDays } from './accrualEngine';

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
 * Reflects approved leave on the attendance calendar, on the dates the request actually covers.
 *
 * It takes the dates rather than a range on purpose. It used to walk every calendar day between
 * start and end while the balance was debited only for working days, so a Friday-to-Monday leave
 * took 2 days off the balance and wrote 4 "on leave" marks — two of them on a weekend the
 * employee never asked for. Both sides now come from `leaveDatesFor`, so they cannot disagree.
 */
async function markLeaveDaysOnAttendance(
  trx: Knex.Transaction, employeeId: number, dates: string[],
) {
  for (const date of dates) {
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

/**
 * Rolls unused accrued leave from one period into the next, up to each type's carry-forward limit.
 *
 * Only for types whose plan says they accrue — everything else still gets its allocation the way it
 * always did. What is left after the limit LAPSES, which is the decision taken: an employee sitting
 * on three years of untaken casual leave is a liability nobody agreed to.
 *
 * The opening row is written on the new period's start date with source `'opening'`, the SAME
 * source the backfill uses. That is not a coincidence — the unique key makes whichever runs first
 * win and the second a no-op, so a rollover cannot be followed by a backfill that grants the limit
 * a second time.
 *
 * Unused is measured from `getEffectiveBalances`, so it is the same number the employee was being
 * shown the day before the period turned over — not a second definition that could differ from it.
 */
async function carryForwardInto(from: any, to: any): Promise<number> {
  const employees = await db('employees').where('is_active', true).pluck('id');
  if (!employees.length) return 0;

  const [balances, rules] = await Promise.all([
    getEffectiveBalances(employees, from.id),
    getTemplateRulesForEmployees(employees),
  ]);

  const rows: any[] = [];
  for (const b of balances) {
    if (b.source !== 'accrual') continue;
    const rule = rules.get(b.employee_id)?.get(b.leave_type_id);
    const limit = rule?.carry_forward_max;
    if (limit == null || limit <= 0) continue;             // null = nothing carries
    // The exact accrued figure less what was spent, NOT the floored `available` — rounding down
    // twice (once to show it, once to carry it) would quietly lose most of a day every year.
    const unused = round6(Number(b.accrued ?? 0) - b.taken - b.pending);
    if (unused <= 0) continue;
    const carried = round6(Math.min(unused, limit));
    rows.push({
      employee_id: b.employee_id,
      leave_type_id: b.leave_type_id,
      leave_period_id: to.id,
      credited_on: to.start_date,
      days: carried,
      source: 'opening',
      note: `Carried forward from ${from.name ?? from.id} (${unused} unused, limit ${limit})`,
    });
  }
  if (!rows.length) return 0;

  // Bare ON CONFLICT DO NOTHING — the unique index is partial, which Postgres cannot infer from a
  // column list. See migration 034 and accrual.service.writeAccruals.
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const inserted = await db('leave_accruals').insert(rows.slice(i, i + 500))
      .onConflict().ignore().returning('id');
    written += inserted.length;
  }
  return written;
}

/**
 * Makes one period current (exactly one at a time), carrying accrued leave forward into it.
 *
 * The carry-forward runs only when the new period genuinely FOLLOWS the outgoing one. An admin
 * flipping back to last year to look at it is not a rollover, and writing opening balances into a
 * closed period on the strength of that would be very hard to notice and very hard to undo.
 *
 * It runs after the flip rather than inside the transaction because it reads through the shared
 * connection (`getEffectiveBalances`), which cannot see an uncommitted one — the same reason
 * `approveLeave` resolves its work calendar before opening its transaction.
 */
export async function setCurrentPeriod(id: number) {
  const period = await db('leave_periods').where('id', id).first();
  if (!period) throw new NotFoundError('Leave period');
  const previous = await db('leave_periods').where('is_current', true).first();

  await db.transaction(async (trx) => {
    await trx('leave_periods').update({ is_current: false });
    await trx('leave_periods').where('id', id).update({ is_current: true, updated_at: trx.fn.now() });
  });

  const isRollover = previous && previous.id !== id && previous.end_date < period.start_date;
  const carried = isRollover ? await carryForwardInto(previous, period) : 0;
  if (carried) console.log(`[leave] carried accrued leave forward into ${period.name}: ${carried} opening balance(s)`);

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

/**
 * Refuses to hand-allocate a leave type the employee's plan says they EARN.
 *
 * Two stores for one balance is how `used_days` and `taken` came to disagree, and this would be
 * the same mistake with more at stake: the balance screen would show the ledger while an admin
 * looked at the allocation grid and saw a number that changed nothing. There is a way to grant
 * days on an accruing type — an `adjustment` row in the ledger — and the message names it.
 */
async function refuseIfAccruing(employeeId: number, leaveTypeId: number, leaveTypeName: string) {
  const rule = await getEmployeeLeaveRule(employeeId, leaveTypeId);
  if (isAccruing(rule)) {
    throw new ValidationError(
      `${leaveTypeName} is earned monthly on this employee's leave plan, so its balance comes from `
      + 'the accrual ledger and a fixed allocation would be ignored. Adjust the ledger instead, or '
      + 'turn accrual off for this type on Leave → Control Panel → Templates.',
    );
  }
}

/** Sets one employee's allocation for a leave type in a period. */
export async function upsertEntitlement(data: {
  employee_id: number; leave_type_id: number; leave_period_id: number; total_days: number;
}) {
  const employee = await db('employees').where('id', Number(data.employee_id)).first();
  if (!employee) throw new NotFoundError('Employee');
  const leaveType = await db('leave_types').where('id', Number(data.leave_type_id)).first();
  if (!leaveType) throw new NotFoundError('Leave type');
  await refuseIfAccruing(employee.id, leaveType.id, leaveType.name);
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

  // Which of the selected employees EARN this type rather than being granted it. Resolved before
  // the transaction and per employee, because accrual is a property of the leave template they are
  // on — half a selection can be accruing and half not. Skipped with a reason rather than failing
  // the whole batch: refusing to allocate to twenty people because one of them accrues would be a
  // worse answer than telling the admin which one.
  const uniqueIds = [...new Set(data.employee_ids.map(Number))];
  const rulesByEmployee = await getTemplateRulesForEmployees(uniqueIds);
  const accruingIds = new Set<number>(
    uniqueIds.filter((id) => isAccruing(rulesByEmployee.get(id)?.get(leaveType.id))),
  );

  await db.transaction(async (trx) => {
    for (const rawId of data.employee_ids) {
      const employeeId = Number(rawId);
      if (accruingIds.has(employeeId)) {
        skipped.push(`employee ${employeeId}: ${leaveType.name} is earned monthly on their leave plan — the accrual ledger holds the balance`);
        continue;
      }
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

export type BalanceSource = 'entitlement' | 'default' | 'accrual';

export interface EffectiveBalance {
  employee_id: number;
  leave_type_id: number;
  leave_type: string;
  is_paid: boolean;
  /** False when the type is restricted to departments this employee isn't in (migration 070). */
  applicable: boolean;
  /** Where `allocated` came from: the accrual ledger, an explicit entitlement row, or default_days. */
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
  /** Accruing types only: days earned so far this period, fractions and all. Null otherwise. */
  accrued: number | null;
  /** Accruing types only: the next anniversary that credits. Null otherwise. */
  next_credit_on: string | null;
}

/**
 * The one definition of "leave balance". applyLeave, getMyBalances and the admin
 * balances overview all read this — there is no second copy.
 *
 * `available` reproduces applyLeave's gate exactly, which means it is deliberately
 * asymmetric, because the underlying data is:
 *
 *   - ACCRUAL (the template row says the type is earned over time, migration 034)
 *     → floor(days credited to the ledger this period) − (approved + pending).
 *     Consumption comes from leave_requests, not the `used_days` counter — see below
 *     for why that is the safer of the two, and note the ledger WINS over an
 *     entitlement row: `upsertEntitlement` refuses to write one for an accruing type
 *     precisely so the two can never both be true at once.
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
 * The accrual branch reads leave_requests for the same reason: `used_days` is bumped
 * against `getCurrentPeriod()` regardless of which period the leave itself falls in
 * (approveLeave), so a January leave already debits the wrong year's counter. Summing
 * the requests in the period's own window sidesteps that entirely.
 *
 * Bulk by construction: a fixed number of queries regardless of how many employees
 * are passed in. The per-employee accrual schedule is pure arithmetic, no I/O.
 */
export async function getEffectiveBalances(
  employeeIds: number[],
  periodId: number,
  opts: { leaveTypeIds?: number[] } = {},
): Promise<EffectiveBalance[]> {
  if (!employeeIds.length) return [];
  const period = await db('leave_periods').where('id', periodId).first();
  if (!period) throw new NotFoundError('Leave period');
  const today = businessToday();

  // No leaveTypeIds = the types an employee could actually apply for (active only).
  // applyLeave passes an explicit id so it keeps gating inactive types as it always has.
  const typesQuery = db('leave_types').select('id', 'name', 'is_paid', 'default_days', 'eligibility').orderBy('name');
  if (opts.leaveTypeIds) typesQuery.whereIn('id', opts.leaveTypeIds);
  else typesQuery.where('is_active', true);

  const [employees, departments, leaveTypes, restrictions, entitlements, booked, templateRules, accrued] = await Promise.all([
    db('employees').whereIn('id', employeeIds).select('id', 'dept_name', 'gender', 'date_of_joining'),
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
    // The accrual ledger for this period. Summed in Postgres because `days` is `numeric` and its
    // sum is exact decimal there — twelve credits of 7/12 added as JavaScript floats come to
    // 6.999999999999999, which floors to 6 and shows an employee a day less than they earned.
    db('leave_accruals').where('leave_period_id', periodId).whereIn('employee_id', employeeIds)
      .groupBy('employee_id', 'leave_type_id')
      .select('employee_id', 'leave_type_id').sum({ total: 'days' }),
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
  const accruedByKey = new Map<string, number>();
  for (const a of accrued as any[]) accruedByKey.set(key(a.employee_id, a.leave_type_id), Number(a.total || 0));

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

      // Accrual, when the employee's plan says this type is earned rather than granted. The
      // ledger is the allocation; `default_days` has become the ANNUAL RATE it credits at, and an
      // entitlement row (if some older data has one) is ignored rather than blended in.
      const accruing = isAccruing(rule);
      const earned = accruing ? (accruedByKey.get(k) ?? 0) : 0;
      // Only for `next_credit_on` — the balance itself comes from the ledger, never from a
      // recomputation, so a rate change cannot move days somebody has already spent against.
      const schedule = accruing
        ? buildSchedule({
          dateOfJoining: String(emp.date_of_joining ?? '').slice(0, 10),
          rule: accrualRuleOf(rule!),
          periodStart: period.start_date,
          periodEnd: period.end_date,
          asOf: today,
        })
        : null;

      const allocated = accruing ? spendableDays(earned) : (ent ? Number(ent.total_days) : defaultDays);
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
        source: accruing ? 'accrual' : (ent ? 'entitlement' : 'default'),
        allocated,
        taken,
        pending,
        available: accruing || !ent
          ? allocated - taken - pending
          : Number(ent.total_days) - Number(ent.used_days),
        // Meaningless on an accruing type: the counter is not what the balance is read from, and
        // showing a half-maintained number beside the real one is how the two drift unnoticed.
        used_days: !accruing && ent ? Number(ent.used_days) : null,
        accrued: accruing ? earned : null,
        next_credit_on: schedule?.next_credit_on ?? null,
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
  const days = (await leaveDatesFor(employeeId, start_date, end_date, rule.count_sandwich_days)).length;
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

  // Who hears about this is configured on Admin → Notifications. Out of the box that is the
  // reporting manager, as before; HR can now also route it to the property manager who will be
  // short-staffed, or to admin who wants to see the volume.
  await emit('leave.applied', {
    employeeId,
    actorEmployeeId: employeeId,
    payload: {
      type: 'leave_requested',
      title: 'Leave request to review',
      message: `${employee.first_name} ${employee.last_name} requested ${days} day(s) leave (${start_date} to ${end_date}).`,
      link: '/leaves/my?tab=approvals',
    },
  });

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
    .select('leave_requests.*', 'employees.reporting_manager_id',
      'employees.first_name', 'employees.last_name')
    .first();

  if (!leave) throw new NotFoundError('Leave request');
  if (leave.status !== 'pending') throw new ValidationError('Only pending requests can be approved');

  if (!['admin', 'chro', 'hr'].includes(roleName) && leave.reporting_manager_id !== approverId) {
    throw new ForbiddenError('Only the reporting manager or HR can approve this request');
  }

  const period = await getCurrentPeriod();

  // Which dates this leave actually covers — resolved BEFORE the transaction opens, deliberately.
  // The work calendar reads through the module-level connection, not `trx`, so building it inside
  // would run on a second pooled connection while this one holds locks. Nothing it reads is
  // written here today, but resolving it first removes the hazard rather than documenting it.
  const rule = await getEmployeeLeaveRule(leave.employee_id, leave.leave_type_id);
  const dates = await leaveDatesFor(
    leave.employee_id, String(leave.start_date).slice(0, 10), String(leave.end_date).slice(0, 10),
    !!rule?.count_sandwich_days,
  );

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

    await markLeaveDaysOnAttendance(trx, leave.employee_id, dates);
  });

  // The employee always hears about their own leave — that is not configurable.
  await notifyEmployee(leave.employee_id, {
    type: 'leave_approved',
    title: 'Leave approved',
    message: `Your leave request for ${leave.days} day(s) (${leave.start_date} to ${leave.end_date}) has been approved.`,
    link: '/attendance',
  });

  // Anyone else who needs to know a shift now needs covering.
  await emit('leave.approved', {
    employeeId: leave.employee_id,
    actorEmployeeId: approverId,
    payload: {
      type: 'leave_approved_fyi',
      title: 'Leave approved — cover needed',
      message: `${leave.first_name || 'An employee'} ${leave.last_name || ''}`.trim()
        + ` is on leave for ${leave.days} day(s) (${leave.start_date} to ${leave.end_date}).`,
      link: '/leaves',
    },
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

  await emit('leave.rejected', {
    employeeId: leave.employee_id,
    actorEmployeeId: approverId,
    payload: {
      type: 'leave_rejected_fyi',
      title: 'Leave rejected',
      message: `${leave.first_name || 'An employee'} ${leave.last_name || ''}`.trim()
        + `'s leave (${leave.start_date} to ${leave.end_date}) was rejected.`,
      link: '/leaves',
    },
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
 * Why an employee's holiday scope came out the way it did.
 *
 * A bare `null` region collapses three different problems into one, and they need three
 * different things said to the person looking at an empty list: nobody recorded where they
 * work, or they work somewhere that isn't a configured property, or the property exists but
 * has no state. Only the last one is really "the data is fine, there's just nothing here".
 */
export type HolidayScopeStatus =
  | 'ok'                     // property matched and carries a state
  | 'no_state_on_property'   // matched, but properties.state is null — only national can apply
  | 'branch_not_matched'     // branch_name set, no properties.name equals it
  | 'no_branch_on_profile';  // employees.branch_name empty

/**
 * The department axis, reported separately from the property axis rather than as more values on
 * the enum above.
 *
 * One enum can only report one problem, and a person can easily have both a work location that
 * matches nothing AND a department that matches nothing — each losing them a DIFFERENT set of
 * holidays. Collapsed into one status, HR fixes the first, reloads, and meets the second.
 */
export type HolidayDeptStatus =
  | 'ok'                         // dept_name matched a departments row
  | 'no_department_on_profile'   // employees.dept_name empty
  | 'department_not_matched';    // set, but no departments.name equals it

export interface HolidayScope {
  status: HolidayScopeStatus;
  dept_status: HolidayDeptStatus;
  /** Echoed back so the UI can quote the offending value rather than say "something is wrong". */
  branch_name: string | null;
  dept_name: string | null;
  region: { property_id: number; property_name: string; state: string | null } | null;
  department: { department_id: number; department_name: string } | null;
}

/**
 * Everything about an employee that decides which holidays reach them: their property (and so
 * their state) and their department.
 *
 * Both links are name matches, not foreign keys — `branch_name` → `properties.name` and
 * `dept_name` → `departments.name`. The asymmetry between them is deliberate and load-bearing:
 * the property match is case-SENSITIVE because that is what it has always been and it decides
 * which state's holidays and statutory rates apply, while the department match is
 * case-insensitive, matching `departmentIdByName` above. Quietly making the property match
 * case-insensitive here would move people between states, which is a different change.
 */
export async function resolveHolidayScope(employeeId: number): Promise<HolidayScope> {
  const row = await db('employees as e')
    .leftJoin('properties as p', 'p.name', 'e.branch_name')
    .leftJoin('departments as d', db.raw('lower(d.name) = lower(e.dept_name)'))
    .where('e.id', employeeId)
    .select(
      'e.branch_name', 'e.dept_name',
      'p.id as property_id', 'p.name as property_name', 'p.state as state',
      'd.id as department_id', 'd.name as department_name',
    )
    .first();

  const branch_name = row?.branch_name ? String(row.branch_name).trim() : null;
  const dept_name = row?.dept_name ? String(row.dept_name).trim() : null;

  const region = row?.property_id
    ? { property_id: row.property_id, property_name: row.property_name, state: row.state || null }
    : null;
  const status: HolidayScopeStatus = !branch_name ? 'no_branch_on_profile'
    : !region ? 'branch_not_matched'
    : region.state ? 'ok' : 'no_state_on_property';

  const department = row?.department_id
    ? { department_id: row.department_id, department_name: row.department_name }
    : null;
  const dept_status: HolidayDeptStatus = !dept_name ? 'no_department_on_profile'
    : !department ? 'department_not_matched'
    : 'ok';

  return { status, dept_status, branch_name, dept_name, region, department };
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

/**
 * Admin view: every holiday with the audience it was given to, plus how many active employees
 * that audience actually reaches.
 *
 * The reach count is what makes the opt-in rule safe to live with. "Front Desk at Gurgaon" is a
 * perfectly valid setting that reaches nobody if Gurgaon has no front desk staff, and no
 * client-side check can spot that — only counting real employees can.
 */
export async function getHolidays(filters: { state?: string; scope?: string; year?: string } = {}) {
  const q = holidayBase().orderBy('h.date');
  if (filters.scope === 'national') q.where('h.is_national', true);
  else if (filters.scope === 'state') q.where('h.is_national', false).whereNotNull('h.state');
  if (filters.state) q.where('h.state', filters.state);
  if (filters.year) q.whereRaw("substr(h.date, 1, 4) = ?", [String(filters.year)]);
  const rows = await q;
  if (!rows.length) return rows;

  const ids = rows.map((r: any) => r.id);
  // Two grouped reads rather than a query per row.
  const [deptLinks, propLinks] = await Promise.all([
    db('holiday_departments as hd').join('departments as d', 'd.id', 'hd.department_id')
      .whereIn('hd.holiday_id', ids).select('hd.holiday_id', 'd.id', 'd.name').orderBy('d.name'),
    db('holiday_properties as hp').join('properties as p', 'p.id', 'hp.property_id')
      .whereIn('hp.holiday_id', ids).select('hp.holiday_id', 'p.id', 'p.name').orderBy('p.name'),
  ]);
  const byHoliday = (links: any[]) => {
    const m = new Map<number, Array<{ id: number; name: string }>>();
    for (const l of links) {
      if (!m.has(l.holiday_id)) m.set(l.holiday_id, []);
      m.get(l.holiday_id)!.push({ id: l.id, name: l.name });
    }
    return m;
  };
  const depts = byHoliday(deptLinks);
  const props = byHoliday(propLinks);

  return Promise.all(rows.map(async (r: any) => {
    const departments = depts.get(r.id) ?? [];
    const properties = props.get(r.id) ?? [];
    return {
      ...r,
      departments,
      properties,
      department_ids: departments.map((d) => d.id),
      property_ids: properties.map((p) => p.id),
      reaches_count: await countHolidayReach({
        is_national: !!r.is_national,
        state: r.state ?? null,
        all_departments: !!r.all_departments,
        department_ids: departments.map((d) => d.id),
        all_properties: !!r.all_properties,
        property_ids: properties.map((p) => p.id),
      }),
    };
  }));
}

export interface HolidayReachScope {
  is_national: boolean;
  state: string | null;
  all_departments: boolean;
  department_ids: number[];
  all_properties: boolean;
  property_ids: number[];
}

/**
 * How many ACTIVE employees a scope reaches — counted from the employee side, applying all
 * three axes, so the answer is a fact about people rather than about rows.
 *
 * Deliberately a second implementation of the rule, computed from the opposite direction: a DB
 * test cross-checks it against `getMyHolidays`, so the two disagreeing is a caught failure
 * rather than a silent one.
 */
export async function countHolidayReach(scope: HolidayReachScope): Promise<number> {
  const q = db('employees as e')
    .leftJoin('properties as p', 'p.name', 'e.branch_name')
    .leftJoin('departments as d', db.raw('lower(d.name) = lower(e.dept_name)'))
    .where('e.is_active', true);
  if (!scope.is_national) q.where('p.state', scope.state ?? '');
  // Knex renders an empty array as `1 = 0`, which is exactly the opt-in answer: nobody.
  if (!scope.all_departments) q.whereIn('d.id', scope.department_ids);
  if (!scope.all_properties) q.whereIn('p.id', scope.property_ids);
  const row: any = await q.count('e.id as c').first();
  return Number(row?.c ?? 0);
}

/** The reach of a holiday already saved. */
export async function getHolidayReach(id: number): Promise<number> {
  const h = await db('holidays').where('id', id).first();
  if (!h) throw new NotFoundError('Holiday');
  const [department_ids, property_ids] = await Promise.all([
    db('holiday_departments').where('holiday_id', id).pluck('department_id'),
    db('holiday_properties').where('holiday_id', id).pluck('property_id'),
  ]);
  return countHolidayReach({
    is_national: !!h.is_national,
    state: h.state ?? null,
    all_departments: !!h.all_departments,
    department_ids,
    all_properties: !!h.all_properties,
    property_ids,
  });
}

export interface MyHoliday {
  id: number;
  name: string;
  date: string;
  is_national: boolean;
  state: string | null;
  /**
   * How the date lands on THIS employee's roster. `weekly_off` means they were already off,
   * so the holiday gains them nothing — the same verdict the payroll engine reaches, because
   * it comes from the same calendar.
   */
  falls_on: 'working' | 'weekly_off';
  /** The policy that decided the day: their shift, their leave template, or the work week. */
  decided_by_name: string;
  break_days: number;
  break_start: string;
  break_end: string;
  break_bounded: boolean;
  in_employment: boolean;
  employment_note: string | null;
}

export interface MyHolidaysResult {
  year: string;
  /**
   * `no_holidays_for_you` is the opt-in case: the calendar IS published, none of it has been
   * given to this person's department or property yet. Telling them nothing was published would
   * send them to the wrong person with the wrong question.
   */
  scope_status: HolidayScopeStatus | 'no_holidays_published' | 'no_holidays_for_you';
  dept_status: HolidayDeptStatus;
  branch_name: string | null;
  dept_name: string | null;
  region: HolidayScope['region'];
  department: HolidayScope['department'];
  available_years: number[];
  counts: {
    total: number;
    remaining: number;
    this_month: number;
    rest_day_clashes: number;
    long_weekends: number;
  };
  holidays: MyHoliday[];
}

/**
 * Employee view: national holidays + the holidays for the employee's state, each annotated with
 * how it lands on that person's own roster.
 *
 * The annotation comes from `buildWorkCalendar` — the same calendar payroll uses to decide how
 * many days to pay — rather than a second implementation of the off-day rules. That is the point:
 * the list a person reads and the payslip they receive cannot disagree about whether Diwali was
 * a day off for them.
 */
export async function getMyHolidays(employeeId: number, year?: string): Promise<MyHolidaysResult> {
  const y = year !== undefined && year !== null && String(year).trim() !== ''
    ? String(year).trim()
    : new Date().toISOString().slice(0, 4);
  // Without this a typo silently returns nothing, which then reads as "your HR team hasn't
  // published anything" — blaming the data for a bad request.
  if (!/^\d{4}$/.test(y)) {
    throw new ValidationError('Year must be a four-digit year, for example 2026.');
  }

  const scope = await resolveHolidayScope(employeeId);
  // The one shared definition of who a holiday reaches — region, department and property.
  // payableDays.service (buildWorkCalendar) and attendance.service (getMyCalendar) call the
  // same function, so the list, the calendar and the payslip cannot disagree.
  const audience = audienceOf(scope);
  const scoped = (q: any) => scopeHolidaysTo(q, audience, 'h');

  // Bounded by the same predicate as the list itself, or the year arrows would offer a year
  // that then renders "your HR team hasn't published a calendar" when it has — just not for
  // this person.
  const yearRows = await scoped(db('holidays as h'))
    .select(db.raw('DISTINCT substr(h.date, 1, 4) as yr'))
    .orderBy('yr');
  const available_years = yearRows.map((r: any) => Number(r.yr)).filter((n: number) => n > 0);

  const rows = await scoped(holidayBase())
    .whereRaw('substr(h.date, 1, 4) = ?', [y])
    // Two rows can share a date (a national and a state holiday both on 26 Jan). Ordering by
    // date alone leaves that pair in whatever order Postgres happens to return, so the list
    // reshuffles between requests.
    .orderBy([{ column: 'h.date' }, { column: 'h.is_national', order: 'desc' }, { column: 'h.id' }]);

  const empty = { total: 0, remaining: 0, this_month: 0, rest_day_clashes: 0, long_weekends: 0 };
  if (rows.length === 0) {
    // An empty list has three different causes now, and they send the reader to three different
    // places. Only ask the extra question on the already-empty path.
    const anyPublished = await db('holidays').whereRaw('substr(date, 1, 4) = ?', [y]).first();
    const emptyStatus: MyHolidaysResult['scope_status'] = !anyPublished
      ? 'no_holidays_published'                       // nothing exists for this year at all
      : scope.status !== 'ok' ? scope.status          // their profile is what is blocking it
      : scope.dept_status !== 'ok' ? 'no_holidays_for_you'
      : 'no_holidays_for_you';                        // published, just not given to them yet
    return {
      year: y,
      scope_status: emptyStatus,
      dept_status: scope.dept_status,
      branch_name: scope.branch_name,
      dept_name: scope.dept_name,
      region: scope.region,
      department: scope.department,
      available_years,
      counts: empty,
      holidays: [],
    };
  }

  // Pad the window by a week so a break straddling 31 Dec / 1 Jan is measured rather than clipped.
  // buildWorkCalendar issues the same queries regardless of range width, so the pad is free.
  const windowStart = shiftDate(`${y}-01-01`, -7);
  const windowEnd = shiftDate(`${y}-12-31`, 7);
  const cal = await buildWorkCalendar(employeeId, windowStart, windowEnd);

  const seen = new Map<string, ReturnType<typeof cal.classify>>();
  const info = (d: string) => {
    let v = seen.get(d);
    if (!v) { v = cal.classify(d); seen.set(d, v); }
    return v;
  };
  // A day outside the employment span ends a run exactly as a working day does. `base` is
  // computed independently of `employed`, so without the second half a leaver's last holiday
  // reports a break running to the edge of the window.
  const isBreakDay = (d: string) => {
    const i = info(d);
    return i.base !== 'working' && i.employed;
  };

  const today = new Date().toISOString().slice(0, 10);
  const holidays: MyHoliday[] = rows.map((h: any) => {
    const date = String(h.date).slice(0, 10);
    const day = info(date);
    const inEmployment = day.employed;
    const brk = inEmployment
      ? findBreak(date, isBreakDay, windowStart, windowEnd)
      : { start: date, end: date, days: 0, bounded: false };

    return {
      id: h.id,
      name: h.name,
      date,
      is_national: !!h.is_national,
      state: h.state ?? null,
      falls_on: day.base === 'weekly_off' ? 'weekly_off' : 'working',
      decided_by_name: day.sourceName,
      break_days: brk.days,
      break_start: brk.start,
      break_end: brk.end,
      break_bounded: brk.bounded,
      in_employment: inEmployment,
      employment_note: day.employmentNote ?? null,
    };
  });

  // Counts are over distinct DATES, not rows: a national and a state holiday sharing 26 Jan is
  // one day off, not two.
  const dates = new Set(holidays.map((h) => h.date));
  const remaining = new Set(
    holidays.filter((h) => h.date >= today && h.in_employment).map((h) => h.date),
  );
  const monthPrefix = today.slice(0, 7);
  const thisMonth = new Set(
    holidays.filter((h) => h.date.slice(0, 7) === monthPrefix).map((h) => h.date),
  );
  const clashes = new Set(holidays.filter((h) => h.falls_on === 'weekly_off').map((h) => h.date));
  // Deduped by the run they belong to, or two holidays inside one long weekend count it twice.
  const breaks = new Set(
    holidays.filter((h) => h.break_days >= 3 && !h.break_bounded).map((h) => h.break_start),
  );

  return {
    year: y,
    scope_status: scope.status,
    dept_status: scope.dept_status,
    branch_name: scope.branch_name,
    dept_name: scope.dept_name,
    region: scope.region,
    department: scope.department,
    available_years,
    counts: {
      total: dates.size,
      remaining: remaining.size,
      this_month: thisMonth.size,
      rest_day_clashes: clashes.size,
      long_weekends: breaks.size,
    },
    holidays,
  };
}

export interface NormalizedHoliday {
  row: {
    name: string; date: string; is_national: boolean; state: string | null;
    is_recurring: boolean; all_departments: boolean; all_properties: boolean;
  };
  department_ids: number[];
  property_ids: number[];
}

export function normalizeHolidayInput(data: any): NormalizedHoliday {
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

  const ids = (raw: any): number[] => [...new Set(
    (Array.isArray(raw) ? raw : []).map(Number).filter((n) => Number.isInteger(n) && n > 0),
  )];

  // Opt-in, enforced at the door. "Everyone" is a tick; neither a tick nor a list is a REFUSAL,
  // not a saved holiday that quietly reaches nobody. No admin ever wants the second thing, and
  // the cost of finding out is a person turning up to work on Diwali.
  //
  // The column defaults stay `false` so any path that bypasses this function still fails safe.
  // The two rules do different jobs: this one refuses the null choice, the schema catches the
  // writes that never made a choice at all.
  const all_departments = !!data.all_departments;
  const department_ids = all_departments ? [] : ids(data.department_ids);
  if (!all_departments && department_ids.length === 0) {
    throw new ValidationError(
      'Choose the departments this holiday applies to, or tick "Every department". A holiday with neither reaches nobody.',
    );
  }
  const all_properties = !!data.all_properties;
  const property_ids = all_properties ? [] : ids(data.property_ids);
  if (!all_properties && property_ids.length === 0) {
    throw new ValidationError(
      'Choose the properties this holiday applies to, or tick "Every property". A holiday with neither reaches nobody.',
    );
  }

  return {
    row: { name, date, is_national, state, is_recurring: !!data.is_recurring, all_departments, all_properties },
    department_ids,
    property_ids,
  };
}

/**
 * Replace a holiday's audience rows.
 *
 * Unknown ids are REJECTED rather than dropped. `setDepartments` above can afford to drop them
 * because that list is opt-out and dropping one only widens access; here it is opt-in, so a
 * silently dropped id narrows the audience without telling anyone who did it.
 */
async function writeHolidayScope(
  trx: Knex.Transaction, holidayId: number, n: NormalizedHoliday,
): Promise<void> {
  await trx('holiday_departments').where('holiday_id', holidayId).del();
  await trx('holiday_properties').where('holiday_id', holidayId).del();

  if (n.department_ids.length) {
    const valid: number[] = await trx('departments').whereIn('id', n.department_ids).pluck('id');
    if (valid.length !== n.department_ids.length) {
      throw new ValidationError('One of the selected departments no longer exists.');
    }
    await trx('holiday_departments')
      .insert(valid.map((department_id) => ({ holiday_id: holidayId, department_id })))
      .onConflict(['holiday_id', 'department_id']).ignore();
  }
  if (n.property_ids.length) {
    const valid: number[] = await trx('properties').whereIn('id', n.property_ids).pluck('id');
    if (valid.length !== n.property_ids.length) {
      throw new ValidationError('One of the selected properties no longer exists.');
    }
    await trx('holiday_properties')
      .insert(valid.map((property_id) => ({ holiday_id: holidayId, property_id })))
      .onConflict(['holiday_id', 'property_id']).ignore();
  }
}

/** One holiday with its audience attached, the shape the admin screen renders. */
export async function getHolidayWithScope(id: number) {
  const row = await holidayBase().where('h.id', id).first();
  if (!row) return null;
  const [departments, properties] = await Promise.all([
    db('holiday_departments as hd').join('departments as d', 'd.id', 'hd.department_id')
      .where('hd.holiday_id', id).select('d.id', 'd.name').orderBy('d.name'),
    db('holiday_properties as hp').join('properties as p', 'p.id', 'hp.property_id')
      .where('hp.holiday_id', id).select('p.id', 'p.name').orderBy('p.name'),
  ]);
  return {
    ...row,
    departments,
    properties,
    department_ids: departments.map((d: any) => d.id),
    property_ids: properties.map((p: any) => p.id),
  };
}

export async function createHoliday(data: any) {
  const n = normalizeHolidayInput(data);
  const id = await db.transaction(async (trx) => {
    const [{ id: newId }] = await trx('holidays').insert(n.row).returning('id');
    await writeHolidayScope(trx, newId, n);
    return newId as number;
  });
  return getHolidayWithScope(id);
}

export async function updateHoliday(id: number, data: any) {
  const existing = await db('holidays').where('id', id).first();
  if (!existing) throw new NotFoundError('Holiday');
  const n = normalizeHolidayInput(data);
  await db.transaction(async (trx) => {
    await trx('holidays').where('id', id).update({ ...n.row, updated_at: trx.fn.now() });
    await writeHolidayScope(trx, id, n);
  });
  return getHolidayWithScope(id);
}

/**
 * A holiday's audience as one comparable string, so "same audience" is a cheap equality check.
 * Pure, so it can be unit-tested without a database.
 */
export function holidayAudienceKey(
  row: { all_departments: boolean; all_properties: boolean },
  departmentIds: number[], propertyIds: number[],
): string {
  const d = row.all_departments ? 'D:*' : `D:${[...departmentIds].sort((a, b) => a - b).join(',')}`;
  const p = row.all_properties ? 'P:*' : `P:${[...propertyIds].sort((a, b) => a - b).join(',')}`;
  return `${d}|${p}`;
}

export interface HolidayCsvScope {
  is_national?: boolean;
  state?: string;
  all_departments?: boolean;
  department_ids?: number[];
  all_properties?: boolean;
  property_ids?: number[];
  /** 'append' (default) adds rows and deletes nothing. 'replace' clears the same audience first. */
  mode?: 'append' | 'replace';
}

/**
 * Bulk import from CSV (columns: Holiday Name, Date), stamping one audience on every row.
 *
 * TWO changes from the version this replaces, both about not destroying work:
 *
 *  • It defaults to APPENDING. The old behaviour deleted a whole scope every time, with no
 *    confirmation, which is a lot of authority for a file picker.
 *  • "Replace" now deletes only rows with the SAME audience as the upload. The old predicate was
 *    `where state = 'Karnataka'` with no other qualifier, so re-uploading the Karnataka list
 *    would take out the Karnataka-for-Management holiday somebody set up by hand last week.
 */
export async function uploadHolidaysCSV(csvText: string, scope: HolidayCsvScope) {
  const is_national = !!scope.is_national;
  let state: string | null = null;
  if (!is_national) {
    state = scope.state ? String(scope.state).trim() : null;
    if (!state) throw new ValidationError('Choose a target: National or a specific state.');
    if (!INDIAN_STATES.includes(state)) throw new ValidationError('Unknown state.');
  }

  // Same opt-in rules as the single-holiday form — an import that reaches nobody is the worst
  // version of this mistake, because it is 20 holidays at once.
  const audience = normalizeHolidayInput({
    name: 'csv', date: '2000-01-01', is_national, state,
    all_departments: scope.all_departments, department_ids: scope.department_ids,
    all_properties: scope.all_properties, property_ids: scope.property_ids,
  });

  const lines = csvText.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new ValidationError('CSV must have a header row and at least one data row.');

  const parsed: { name: string; date: string }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 2 || !cols[0] || !cols[1]) continue;
    const date = normalizeDateStr(cols[1]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    parsed.push({ name: cols[0], date });
  }
  if (parsed.length === 0) throw new ValidationError('No valid holiday rows found in the CSV.');

  const mode = scope.mode === 'replace' ? 'replace' : 'append';
  const uploadKey = holidayAudienceKey(
    { all_departments: audience.row.all_departments, all_properties: audience.row.all_properties },
    audience.department_ids, audience.property_ids,
  );

  let replaced = 0;
  await db.transaction(async (trx) => {
    if (mode === 'replace') {
      // Candidates by region, then keep only those whose audience matches this upload's.
      const candidates = await trx('holidays')
        .modify((q) => { if (is_national) q.where('is_national', true); else q.where('state', state); })
        .select('id', 'all_departments', 'all_properties');
      const ids = candidates.map((c: any) => c.id);
      const [dLinks, pLinks] = ids.length
        ? await Promise.all([
          trx('holiday_departments').whereIn('holiday_id', ids).select('holiday_id', 'department_id'),
          trx('holiday_properties').whereIn('holiday_id', ids).select('holiday_id', 'property_id'),
        ])
        : [[], []];
      const group = (rows: any[], key: string) => {
        const m = new Map<number, number[]>();
        for (const r of rows) {
          if (!m.has(r.holiday_id)) m.set(r.holiday_id, []);
          m.get(r.holiday_id)!.push(r[key]);
        }
        return m;
      };
      const dMap = group(dLinks, 'department_id');
      const pMap = group(pLinks, 'property_id');
      const doomed = candidates
        .filter((c: any) => holidayAudienceKey(
          { all_departments: !!c.all_departments, all_properties: !!c.all_properties },
          dMap.get(c.id) ?? [], pMap.get(c.id) ?? [],
        ) === uploadKey)
        .map((c: any) => c.id);
      if (doomed.length) {
        replaced = await trx('holidays').whereIn('id', doomed).del();
      }
    }

    for (const p of parsed) {
      const [{ id }] = await trx('holidays').insert({
        name: p.name, date: p.date,
        is_national, state,
        is_recurring: false,
        all_departments: audience.row.all_departments,
        all_properties: audience.row.all_properties,
      }).returning('id');
      await writeHolidayScope(trx, id, audience);
    }
  });

  return {
    inserted: parsed.length,
    replaced,
    mode,
    scope: is_national ? 'national' : state,
    reaches: await countHolidayReach({
      is_national, state,
      all_departments: audience.row.all_departments,
      department_ids: audience.department_ids,
      all_properties: audience.row.all_properties,
      property_ids: audience.property_ids,
    }),
  };
}

export async function deleteHoliday(id: number) {
  const holiday = await db('holidays').where('id', id).first();
  if (!holiday) throw new NotFoundError('Holiday');
  await db('holidays').where('id', id).delete();
}

// ─── Helpers ───
// Leave-day counting now lives in payableDays.countWorkingDaysInRange so leave
// and payroll share one per-employee calendar (Phase 3).
