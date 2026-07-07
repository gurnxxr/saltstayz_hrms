import type { Knex } from 'knex';
import db from '../config/database';
import { NotFoundError, ValidationError, ForbiddenError } from '../utils/errors';
import { notifyEmployee } from './notification.service';
import { countWorkingDaysInRange } from './payableDays.service';

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

// ─── Leave Types ───

export async function getLeaveTypes() {
  return db('leave_types').where('is_active', true).orderBy('name');
}

/** All leave types incl. inactive — for the Control Panel. */
export async function getAllLeaveTypes() {
  return db('leave_types').orderBy('name');
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
  const [id] = await db('leave_types').insert({
    name, default_days: defaultDays,
    is_paid: data.is_paid === undefined ? true : !!data.is_paid,
    is_encashable: !!data.is_encashable,
    is_active: true,
  });
  return db('leave_types').where('id', id).first();
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
  await db('leave_types').where('id', id).update({ ...patch, updated_at: db.fn.now() });
  return db('leave_types').where('id', id).first();
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
  const [id] = await db('leave_periods').insert({
    name, start_date: data.start_date, end_date: data.end_date, is_current: false,
  });
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
      this.where('e.first_name', 'like', term)
        .orWhere('e.last_name', 'like', term)
        .orWhere('e.employee_code', 'like', term)
        .orWhereRaw("(e.first_name || ' ' || e.last_name) like ?", [term]);
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

export async function getMyBalances(employeeId: number) {
  const period = await getCurrentPeriod();
  return db('leave_entitlements')
    .join('leave_types', 'leave_types.id', 'leave_entitlements.leave_type_id')
    .where('leave_entitlements.employee_id', employeeId)
    .where('leave_entitlements.leave_period_id', period.id)
    .select(
      'leave_entitlements.*',
      'leave_types.name as leave_type',
      'leave_types.is_paid'
    )
    .orderBy('leave_types.name');
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

  // One calendar everywhere (Phase 3): count leave days on the employee's own
  // roster/work-week calendar, so leave balance and payroll LOP agree.
  const days = await countWorkingDaysInRange(employeeId, start_date, end_date);
  if (days <= 0) throw new ValidationError('Leave must be at least 1 working day for this employee');

  const period = await getCurrentPeriod();
  const entitlement = await db('leave_entitlements')
    .where({ employee_id: employeeId, leave_type_id, leave_period_id: period.id })
    .first();

  if (entitlement) {
    const remaining = entitlement.total_days - entitlement.used_days;
    if (days > remaining) {
      throw new ValidationError(`Insufficient ${leaveType.name} balance. Available: ${remaining} days, Requested: ${days} days`);
    }
  }

  const overlap = await db('leave_requests')
    .where('employee_id', employeeId)
    .whereIn('status', ['pending', 'approved'])
    .where(function () {
      this.where('start_date', '<=', end_date).andWhere('end_date', '>=', start_date);
    })
    .first();

  if (overlap) throw new ValidationError('You already have a leave request overlapping these dates');

  const [id] = await db('leave_requests').insert({
    employee_id: employeeId,
    leave_type_id,
    start_date,
    end_date,
    days,
    reason,
    status: 'pending',
  });

  // Alert the approver (reporting manager) that a request awaits action.
  const emp = await db('employees').where('id', employeeId)
    .select('first_name', 'last_name', 'reporting_manager_id').first();
  if (emp?.reporting_manager_id) {
    await notifyEmployee(emp.reporting_manager_id, {
      type: 'leave_requested',
      title: 'Leave request to review',
      message: `${emp.first_name} ${emp.last_name} requested ${days} day(s) leave (${start_date} to ${end_date}).`,
      link: '/attendance/leave/approvals',
    });
  }

  return db('leave_requests')
    .join('leave_types', 'leave_types.id', 'leave_requests.leave_type_id')
    .where('leave_requests.id', id)
    .select('leave_requests.*', 'leave_types.name as leave_type')
    .first();
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
  const [id] = await db('regions').insert({ name, description: String(data.description || '').trim() || null });
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

/** Resolve an employee's region via their property (branch_name = properties.name). */
export async function getEmployeeRegion(employeeId: number) {
  const emp = await db('employees').where('id', employeeId).select('branch_name').first();
  if (!emp?.branch_name) return null;
  const prop = await db('properties as p').leftJoin('regions as r', 'r.id', 'p.region_id')
    .where('p.name', emp.branch_name)
    .select('p.id as property_id', 'p.name as property_name', 'p.region_id', 'r.name as region_name').first();
  if (!prop) return null;
  return {
    property_id: prop.property_id, property_name: prop.property_name,
    region_id: prop.region_id || null, region_name: prop.region_name || null,
  };
}

// ─── Holidays (national + region-specific) ───

function normalizeDateStr(raw: string): string {
  const s = String(raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return s;
}

function holidayBase() {
  return db('holidays as h')
    .leftJoin('regions as r', 'r.id', 'h.region_id')
    .select('h.*', 'r.name as region_name');
}

/** Admin view: every holiday, with region name + scope; optional scope/region/year filters. */
export async function getHolidays(filters: { region_id?: string; scope?: string; year?: string } = {}) {
  const q = holidayBase().orderBy('h.date');
  if (filters.scope === 'national') q.where('h.is_national', true);
  else if (filters.scope === 'regional') q.where('h.is_national', false).whereNotNull('h.region_id');
  if (filters.region_id) q.where('h.region_id', Number(filters.region_id));
  if (filters.year) q.whereRaw("strftime('%Y', h.date) = ?", [String(filters.year)]);
  return q;
}

/** Employee view: national holidays + the holidays of the employee's region. */
export async function getMyHolidays(employeeId: number, year?: string) {
  const region = await getEmployeeRegion(employeeId);
  const q = holidayBase().orderBy('h.date');
  q.where(function () {
    this.where('h.is_national', true);
    if (region?.region_id) this.orWhere('h.region_id', region.region_id);
  });
  if (year) q.whereRaw("strftime('%Y', h.date) = ?", [String(year)]);
  const holidays = await q;
  return { region, holidays };
}

function normalizeHolidayInput(data: any) {
  const name = String(data.name || '').trim();
  if (!name) throw new ValidationError('Holiday name is required.');
  const date = normalizeDateStr(String(data.date || ''));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ValidationError('A valid date is required (YYYY-MM-DD or DD-MM-YYYY).');
  const is_national = !!data.is_national;
  let region_id: number | null = null;
  if (!is_national) {
    region_id = data.region_id != null && data.region_id !== '' ? Number(data.region_id) : null;
    if (!region_id) throw new ValidationError('Select a region, or mark the holiday as national.');
  }
  return { name, date, is_national, region_id, is_recurring: !!data.is_recurring };
}

export async function createHoliday(data: { name: string; date: string; is_national?: boolean; region_id?: number; is_recurring?: boolean }) {
  const payload = normalizeHolidayInput(data);
  if (payload.region_id) {
    const r = await db('regions').where('id', payload.region_id).first();
    if (!r) throw new NotFoundError('Region');
  }
  const [id] = await db('holidays').insert(payload);
  return holidayBase().where('h.id', id).first();
}

export async function updateHoliday(id: number, data: { name: string; date: string; is_national?: boolean; region_id?: number; is_recurring?: boolean }) {
  const existing = await db('holidays').where('id', id).first();
  if (!existing) throw new NotFoundError('Holiday');
  const payload = normalizeHolidayInput(data);
  if (payload.region_id) {
    const r = await db('regions').where('id', payload.region_id).first();
    if (!r) throw new NotFoundError('Region');
  }
  await db('holidays').where('id', id).update({ ...payload, updated_at: db.fn.now() });
  return holidayBase().where('h.id', id).first();
}

/**
 * Bulk import from CSV (columns: Holiday Name, Date). Applies to a single scope —
 * national or one region — and REPLACES only that scope's holidays (never a global wipe).
 */
export async function uploadHolidaysCSV(csvText: string, scope: { is_national?: boolean; region_id?: number }) {
  const is_national = !!scope.is_national;
  let region_id: number | null = null;
  if (!is_national) {
    region_id = scope.region_id != null ? Number(scope.region_id) : null;
    if (!region_id) throw Object.assign(new Error('Choose a target: National or a specific region.'), { status: 400 });
    const r = await db('regions').where('id', region_id).first();
    if (!r) throw new NotFoundError('Region');
  }

  const lines = csvText.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw Object.assign(new Error('CSV must have a header row and at least one data row'), { status: 400 });

  const rows: { name: string; date: string; is_national: boolean; region_id: number | null }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 2 || !cols[0] || !cols[1]) continue;
    const date = normalizeDateStr(cols[1]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    rows.push({ name: cols[0], date, is_national, region_id });
  }
  if (rows.length === 0) throw Object.assign(new Error('No valid holiday rows found in CSV'), { status: 400 });

  await db.transaction(async (trx) => {
    if (is_national) await trx('holidays').where('is_national', true).del();
    else await trx('holidays').where('region_id', region_id).del();
    await trx('holidays').insert(rows);
  });

  return { inserted: rows.length, scope: is_national ? 'national' : `region ${region_id}` };
}

export async function deleteHoliday(id: number) {
  const holiday = await db('holidays').where('id', id).first();
  if (!holiday) throw new NotFoundError('Holiday');
  await db('holidays').where('id', id).delete();
}

// ─── Helpers ───
// Leave-day counting now lives in payableDays.countWorkingDaysInRange so leave
// and payroll share one per-employee calendar (Phase 3).
