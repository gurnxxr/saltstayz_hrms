import db from '../config/database';
import { NotFoundError, ValidationError, ForbiddenError } from '../utils/errors';
import { notifyEmployee } from './notification.service';
import { getPaySchedule } from './paySchedule.service';
import { overnightHours, toMinutes, deriveAttendanceStatus } from './attendance.calc';

// ─── Attendance regularisation ───
//
// Self-service correction of a missing / mis-punched day, on the standard HRMS
// model (greytHR / Keka / Zoho): the employee raises a dated request with the
// correct punches + a mandatory reason; the reporting manager (or HR) approves;
// on approval the attendance record for that date is upserted and its status is
// re-derived from the punches — so payroll pays the right days. Guardrails: a
// monthly cap, and a hard block once the pay period is locked.

const STAFF_ROLES = ['admin', 'chro', 'hr'];

// Max regularisations an employee may raise for a given attendance month
// (pending + approved). Without a cap, every absent day gets regularised.
const MONTHLY_LIMIT = 3;

const isStaff = (roleName: string) => STAFF_ROLES.includes(roleName);

/** Blocks regularising a date whose payroll month is already locked. */
async function assertMonthUnlocked(date: string) {
  const [year, month] = date.split('-').map(Number);
  const run = await db('payroll_runs').where({ month, year }).first();
  if (run?.status === 'locked') {
    throw new ValidationError(`Payroll for ${String(month).padStart(2, '0')}/${year} is locked. Ask HR to unlock it before regularising this date.`);
  }
}

/**
 * Expected shift length (hours) for an employee on a date: dated roster wins,
 * else the standing shift assignment — same resolution the CSV upload uses, so a
 * regularised day is classified exactly as an uploaded one would be. 0 when none.
 */
async function resolveShiftHours(employeeId: number, date: string): Promise<number> {
  const roster = await db('shift_rosters as r')
    .join('shift_types as st', 'st.id', 'r.shift_type_id')
    .where({ 'r.employee_id': employeeId, 'r.date': date })
    .select('st.start_time', 'st.end_time')
    .first();
  const shift = roster ?? await db('employee_shift_assignments as a')
    .join('shift_types as st', 'st.id', 'a.shift_type_id')
    .where('a.employee_id', employeeId)
    .select('st.start_time', 'st.end_time')
    .first();
  return shift ? overnightHours(shift.start_time, shift.end_time) : 0;
}

/** Single request with the approver's name, for the "my requests" list. */
async function getRegularisation(id: number) {
  return db('attendance_regularisations as ar')
    .leftJoin('employees as approver', 'approver.id', 'ar.approved_by')
    .where('ar.id', id)
    .select('ar.*', db.raw("COALESCE(approver.first_name || ' ' || approver.last_name, '') as approved_by_name"))
    .first();
}

export interface RegularisationInput {
  date: string;
  check_in: string;   // HH:MM
  check_out: string;  // HH:MM
  reason: string;
}

/** Employee raises a request to correct one date's attendance. */
export async function requestRegularisation(employeeId: number, data: RegularisationInput) {
  const emp = await db('employees').where('id', employeeId)
    .select('id', 'first_name', 'last_name', 'reporting_manager_id').first();
  if (!emp) throw new NotFoundError('Employee');

  const date = String(data.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ValidationError('A valid date is required');
  const today = new Date().toISOString().slice(0, 10);
  if (date > today) throw new ValidationError('You cannot regularise a future date');

  const reason = String(data.reason || '').trim();
  if (!reason) throw new ValidationError('A reason is required');

  const inMin = toMinutes(data.check_in);
  const outMin = toMinutes(data.check_out);
  if (inMin == null || outMin == null) throw new ValidationError('Enter a valid in-time and out-time (HH:MM)');

  await assertMonthUnlocked(date);

  // An approved leave is HR-authoritative — it can't be overwritten via regularisation.
  const existing = await db('attendance_records').where({ employee_id: employeeId, date }).first();
  if (existing?.status === 'on_leave') {
    throw new ValidationError('This date is marked as approved leave. Cancel the leave before regularising it.');
  }

  // One open request per date.
  const dup = await db('attendance_regularisations')
    .where({ employee_id: employeeId, date, status: 'pending' }).first();
  if (dup) throw new ValidationError('You already have a pending regularisation for this date');

  // Monthly cap (pending + approved) for the attendance month being corrected.
  const monthPrefix = date.slice(0, 7); // YYYY-MM
  const countRow = await db('attendance_regularisations')
    .where('employee_id', employeeId)
    .whereRaw('substr(date, 1, 7) = ?', [monthPrefix])
    .whereIn('status', ['pending', 'approved'])
    .count({ c: 'id' }).first();
  if (Number((countRow as any)?.c || 0) >= MONTHLY_LIMIT) {
    throw new ValidationError(`You have reached the monthly regularisation limit (${MONTHLY_LIMIT}) for ${monthPrefix}.`);
  }

  const [id] = await db('attendance_regularisations').insert({
    attendance_id: existing?.id ?? null,
    employee_id: employeeId,
    date,
    requested_check_in: `${date} ${data.check_in.trim()}:00`,
    requested_check_out: `${date} ${data.check_out.trim()}:00`,
    reason,
    status: 'pending',
  });

  // Alert the reporting manager (the approver) that a request awaits action.
  if (emp.reporting_manager_id) {
    await notifyEmployee(emp.reporting_manager_id, {
      type: 'regularisation_requested',
      title: 'Attendance regularisation to review',
      message: `${emp.first_name} ${emp.last_name} requested to regularise ${date}.`,
      link: '/attendance/regularisation',
    });
  }

  return getRegularisation(id);
}

/** The employee's own requests, newest first. */
export async function getMyRegularisations(employeeId: number) {
  return db('attendance_regularisations as ar')
    .leftJoin('employees as approver', 'approver.id', 'ar.approved_by')
    .where('ar.employee_id', employeeId)
    .select('ar.*', db.raw("COALESCE(approver.first_name || ' ' || approver.last_name, '') as approved_by_name"))
    .orderBy('ar.created_at', 'desc');
}

/** Pending requests an approver may act on: HR/admin see all; a manager sees their reports'. */
export async function getPendingRegularisations(approverId: number, roleName: string) {
  const query = db('attendance_regularisations as ar')
    .join('employees as e', 'e.id', 'ar.employee_id')
    .where('ar.status', 'pending')
    .select(
      'ar.*',
      'e.first_name', 'e.last_name', 'e.employee_code', 'e.dept_name', 'e.branch_name',
    )
    .orderBy('ar.created_at', 'asc');

  if (isStaff(roleName)) return query;
  return query.where('e.reporting_manager_id', approverId);
}

/** Loads a pending request + the requester's manager, enforcing the approver's authority. */
async function loadForDecision(id: number, approverId: number, roleName: string) {
  const reg = await db('attendance_regularisations as ar')
    .join('employees as e', 'e.id', 'ar.employee_id')
    .where('ar.id', id)
    .select('ar.*', 'e.reporting_manager_id')
    .first();
  if (!reg) throw new NotFoundError('Regularisation request');
  if (reg.status !== 'pending') throw new ValidationError('Only pending requests can be actioned');
  if (!isStaff(roleName) && reg.reporting_manager_id !== approverId) {
    throw new ForbiddenError('Only the reporting manager or HR can action this request');
  }
  return reg;
}

/** Approve: correct the attendance record for the date, then close the request. */
export async function approveRegularisation(id: number, approverId: number, roleName: string) {
  const reg = await loadForDecision(id, approverId, roleName);

  // Re-check the lock at decision time (guards a race with a concurrent lock).
  await assertMonthUnlocked(reg.date);

  const existing = await db('attendance_records')
    .where({ employee_id: reg.employee_id, date: reg.date }).first();
  if (existing?.status === 'on_leave') {
    throw new ValidationError('This date is now marked as approved leave and cannot be regularised.');
  }

  // Re-derive the status from the requested punches (HH:MM sliced from the datetimes).
  const inTime = String(reg.requested_check_in).slice(11, 16);
  const outTime = String(reg.requested_check_out).slice(11, 16);
  const worked = overnightHours(inTime, outTime);
  const schedule = await getPaySchedule();
  const shiftHours = await resolveShiftHours(reg.employee_id, reg.date);
  const status = deriveAttendanceStatus({
    hasIn: true,
    hasOut: true,
    workedHours: worked,
    shiftHours: shiftHours || schedule.standard_day_hours,
    graceMinutes: schedule.grace_minutes,
  });

  await db.transaction(async (trx) => {
    let attendanceId: number;
    if (existing) {
      await trx('attendance_records').where('id', existing.id).update({
        check_in: reg.requested_check_in,
        check_out: reg.requested_check_out,
        working_hours: worked,
        status,
        updated_at: trx.fn.now(),
      });
      attendanceId = existing.id;
    } else {
      [attendanceId] = await trx('attendance_records').insert({
        employee_id: reg.employee_id,
        date: reg.date,
        check_in: reg.requested_check_in,
        check_out: reg.requested_check_out,
        working_hours: worked,
        status,
      });
    }
    await trx('attendance_regularisations').where('id', id).update({
      status: 'approved',
      approved_by: approverId,
      applied_status: status,
      attendance_id: attendanceId,
      decided_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    });
  });

  await notifyEmployee(reg.employee_id, {
    type: 'regularisation_approved',
    title: 'Attendance regularised',
    message: `Your attendance for ${reg.date} was regularised to "${status.replace('_', ' ')}".`,
    link: '/attendance/regularisation',
  });

  return { message: 'Regularisation approved', status };
}

/** Reject: record the mandatory reason and notify the employee. Attendance unchanged. */
export async function rejectRegularisation(id: number, approverId: number, roleName: string, comment: string) {
  const reg = await loadForDecision(id, approverId, roleName);
  const note = String(comment || '').trim();
  if (!note) throw new ValidationError('A reason is required to reject');

  await db('attendance_regularisations').where('id', id).update({
    status: 'rejected',
    approved_by: approverId,
    reviewer_comment: note,
    decided_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await notifyEmployee(reg.employee_id, {
    type: 'regularisation_rejected',
    title: 'Regularisation rejected',
    message: `Your regularisation for ${reg.date} was rejected. Reason: ${note}`,
    link: '/attendance/regularisation',
  });

  return { message: 'Regularisation rejected' };
}
