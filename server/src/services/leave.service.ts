import type { Knex } from 'knex';
import db from '../config/database';
import { NotFoundError, ValidationError, ForbiddenError } from '../utils/errors';
import { notifyEmployee } from './notification.service';

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

// ─── Leave Periods ───

export async function getLeavePeriods() {
  return db('leave_periods').orderBy('start_date', 'desc');
}

export async function getCurrentPeriod() {
  const period = await db('leave_periods').where('is_current', true).first();
  if (!period) throw new NotFoundError('Current leave period');
  return period;
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

  const days = calculateLeaveDays(start_date, end_date);
  if (days <= 0) throw new ValidationError('Leave must be at least 1 day');

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

// ─── Holidays ───

export async function getHolidays(propertyId?: string) {
  const query = db('holidays')
    .leftJoin('properties', 'properties.id', 'holidays.property_id')
    .select('holidays.*', 'properties.name as property_name')
    .orderBy('holidays.date');

  if (propertyId) query.where('holidays.property_id', propertyId);

  return query;
}

export async function createHoliday(data: { name: string; date: string; property_id?: number; is_recurring?: boolean }) {
  const [id] = await db('holidays').insert(data);
  return db('holidays').where('id', id).first();
}

export async function uploadHolidaysCSV(csvText: string) {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw Object.assign(new Error('CSV must have a header row and at least one data row'), { status: 400 });

  const holidays: { name: string; date: string }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 2 || !cols[0] || !cols[1]) continue;

    const name = cols[0];
    let date = cols[1];
    const dmyMatch = date.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
    if (dmyMatch) {
      date = `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
    }

    holidays.push({ name, date });
  }

  if (holidays.length === 0) throw Object.assign(new Error('No valid holiday rows found in CSV'), { status: 400 });

  await db('holidays').del();
  await db('holidays').insert(holidays);

  return { inserted: holidays.length };
}

export async function deleteHoliday(id: number) {
  const holiday = await db('holidays').where('id', id).first();
  if (!holiday) throw new NotFoundError('Holiday');
  await db('holidays').where('id', id).delete();
}

// ─── Helpers ───

function calculateLeaveDays(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  let days = 0;
  const current = new Date(start);
  while (current <= end) {
    const day = current.getDay();
    if (day !== 0) days++; // exclude Sundays
    current.setDate(current.getDate() + 1);
  }
  return days;
}
