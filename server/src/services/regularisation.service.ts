import db from '../config/database';
import { NotFoundError, ValidationError, ForbiddenError } from '../utils/errors';
import { notifyEmployee } from './notification.service';

// ─── Attendance regularisation ───
//
// Self-service correction of a wrongly-recorded day, on the standard HRMS model
// (greytHR / Keka / Zoho): HR uploads daily attendance; an employee who sees a
// wrong day picks WHAT THE DAY SHOULD BE (a status type) over a date range with a
// mandatory reason; the reporting manager (or HR) approves; on approval every date
// in the range is upserted onto attendance_records with the chosen status and
// flagged is_regularised — so payroll pays the right days and the calendar can
// mark the day "R". Guardrails: a monthly cap and a hard block once the pay
// period is locked.

const STAFF_ROLES = ['admin', 'chro', 'hr'];

// Max regularisation REQUESTS an employee may raise for a given attendance month
// (pending + approved). A request may span a date range, so we cap requests, not
// days — without a cap every wrong day gets regularised.
const MONTHLY_LIMIT = 3;

// The longest range one request may cover (keeps a single request from rewriting a
// whole quarter and bounds the per-date loop).
const MAX_RANGE_DAYS = 31;

// Regularisation types the employee may pick, and how each maps onto the attendance
// status vocabulary the payable-days engine understands. "No Punch" (np) is paid as
// a full-day LOP, exactly like Absent — so no new payroll status is needed.
const REG_TYPES = ['np', 'mp', 'sp', 'absent', 'present'] as const;
type RegType = typeof REG_TYPES[number];
const TYPE_TO_STATUS: Record<RegType, string> = {
  present: 'present', absent: 'absent', np: 'absent', mp: 'miss_punch', sp: 'short_punch',
};
const TYPE_LABELS: Record<RegType, string> = {
  present: 'Present', absent: 'Absent', np: 'No Punch', mp: 'Miss Punch', sp: 'Short Punch',
};

const isStaff = (roleName: string) => STAFF_ROLES.includes(roleName);
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Inclusive list of YYYY-MM-DD strings from start to end (UTC-based, so no TZ drift). */
function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  const [ys, ms, ds] = start.split('-').map(Number);
  const [ye, me, de] = end.split('-').map(Number);
  const cur = new Date(Date.UTC(ys, ms - 1, ds));
  const last = new Date(Date.UTC(ye, me - 1, de));
  while (cur <= last) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/** Blocks regularising a date whose payroll month is already locked. */
async function assertMonthUnlocked(date: string) {
  const [year, month] = date.split('-').map(Number);
  const run = await db('payroll_runs').where({ month, year }).first();
  if (run?.status === 'locked') {
    throw new ValidationError(`Payroll for ${String(month).padStart(2, '0')}/${year} is locked. Ask HR to unlock it before regularising these dates.`);
  }
}

/** A request's date range as a display string. */
function rangeLabel(start: string, end?: string | null) {
  return end && end !== start ? `${start} to ${end}` : start;
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
  start_date: string;
  end_date: string;
  requested_status: string;   // one of REG_TYPES
  reason: string;
}

/** Employee raises a request to correct a date range's attendance to a chosen status. */
export async function requestRegularisation(employeeId: number, data: RegularisationInput) {
  const emp = await db('employees').where('id', employeeId)
    .select('id', 'first_name', 'last_name', 'reporting_manager_id').first();
  if (!emp) throw new NotFoundError('Employee');

  const start = String(data.start_date || '').slice(0, 10);
  const end = String(data.end_date || start).slice(0, 10);
  if (!isDate(start) || !isDate(end)) throw new ValidationError('A valid start and end date are required');
  if (end < start) throw new ValidationError('The end date cannot be before the start date');
  const today = new Date().toISOString().slice(0, 10);
  if (end > today) throw new ValidationError('You cannot regularise a future date');

  const type = String(data.requested_status || '') as RegType;
  if (!REG_TYPES.includes(type)) throw new ValidationError('Choose a valid regularisation type');

  const reason = String(data.reason || '').trim();
  if (!reason) throw new ValidationError('A reason is required');

  const dates = eachDate(start, end);
  if (dates.length > MAX_RANGE_DAYS) throw new ValidationError(`A single request can cover at most ${MAX_RANGE_DAYS} days`);

  // Every date's payroll month must be unlocked.
  for (const d of dates) await assertMonthUnlocked(d);

  // No overlapping open request for any date in the range.
  const overlap = await db('attendance_regularisations')
    .where({ employee_id: employeeId, status: 'pending' })
    .whereRaw('date <= ? AND COALESCE(end_date, date) >= ?', [end, start])
    .first();
  if (overlap) throw new ValidationError('You already have a pending regularisation overlapping these dates');

  // Monthly cap (pending + approved requests) for the attendance month being corrected.
  const monthPrefix = start.slice(0, 7); // YYYY-MM
  const countRow = await db('attendance_regularisations')
    .where('employee_id', employeeId)
    .whereRaw('substr(date, 1, 7) = ?', [monthPrefix])
    .whereIn('status', ['pending', 'approved'])
    .count({ c: 'id' }).first();
  if (Number((countRow as any)?.c || 0) >= MONTHLY_LIMIT) {
    throw new ValidationError(`You have reached the monthly regularisation limit (${MONTHLY_LIMIT}) for ${monthPrefix}.`);
  }

  const [id] = await db('attendance_regularisations').insert({
    attendance_id: null,
    employee_id: employeeId,
    date: start,
    end_date: end,
    requested_status: type,
    reason,
    status: 'pending',
  });

  // Alert the reporting manager (the approver) that a request awaits action.
  if (emp.reporting_manager_id) {
    await notifyEmployee(emp.reporting_manager_id, {
      type: 'regularisation_requested',
      title: 'Attendance regularisation to review',
      message: `${emp.first_name} ${emp.last_name} requested to mark ${rangeLabel(start, end)} as ${TYPE_LABELS[type]}.`,
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

/**
 * Regularisation log (history): decided (approved/rejected) requests. Scoped like
 * the approvals queue — HR/admin see all; a manager sees their reports'.
 */
export async function getRegularisationLog(approverId: number, roleName: string) {
  const query = db('attendance_regularisations as ar')
    .join('employees as e', 'e.id', 'ar.employee_id')
    .leftJoin('employees as approver', 'approver.id', 'ar.approved_by')
    .whereIn('ar.status', ['approved', 'rejected'])
    .select(
      'ar.*',
      'e.first_name', 'e.last_name', 'e.employee_code', 'e.dept_name', 'e.branch_name',
      db.raw("COALESCE(approver.first_name || ' ' || approver.last_name, '') as approved_by_name"),
    )
    .orderBy('ar.decided_at', 'desc');

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

/** Approve: set every date in the range to the requested status, then close the request. */
export async function approveRegularisation(id: number, approverId: number, roleName: string) {
  const reg = await loadForDecision(id, approverId, roleName);

  const type = reg.requested_status as RegType;
  const status = TYPE_TO_STATUS[type];
  if (!status) throw new ValidationError('This request has no valid regularisation type and cannot be approved.');

  const start = String(reg.date).slice(0, 10);
  const end = String(reg.end_date || reg.date).slice(0, 10);
  const dates = eachDate(start, end);

  // Re-check the lock for every date at decision time (guards a race with a lock).
  for (const d of dates) await assertMonthUnlocked(d);

  const skipped: string[] = [];
  let applied = 0;
  let firstAttendanceId: number | null = null;

  await db.transaction(async (trx) => {
    for (const date of dates) {
      const existing = await trx('attendance_records')
        .where({ employee_id: reg.employee_id, date }).first();

      // Approved leave is HR-authoritative — never overwrite it via regularisation.
      if (existing?.status === 'on_leave') { skipped.push(date); continue; }

      if (existing) {
        await trx('attendance_records').where('id', existing.id).update({
          status,
          is_regularised: true,
          updated_at: trx.fn.now(),
        });
        if (firstAttendanceId === null) firstAttendanceId = existing.id;
      } else {
        const [newId] = await trx('attendance_records').insert({
          employee_id: reg.employee_id,
          date,
          status,
          is_regularised: true,
        });
        if (firstAttendanceId === null) firstAttendanceId = newId;
      }
      applied += 1;
    }

    await trx('attendance_regularisations').where('id', id).update({
      status: 'approved',
      approved_by: approverId,
      applied_status: status,
      attendance_id: firstAttendanceId,
      decided_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    });
  });

  const skipNote = skipped.length ? ` (${skipped.length} day(s) on approved leave were left unchanged)` : '';
  await notifyEmployee(reg.employee_id, {
    type: 'regularisation_approved',
    title: 'Attendance regularised',
    message: `Your attendance for ${rangeLabel(start, end)} was marked as ${TYPE_LABELS[type]}${skipNote}.`,
    link: '/attendance/regularisation',
  });

  return { message: 'Regularisation approved', status, applied, skipped };
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
    message: `Your regularisation for ${rangeLabel(String(reg.date).slice(0, 10), reg.end_date && String(reg.end_date).slice(0, 10))} was rejected. Reason: ${note}`,
    link: '/attendance/regularisation',
  });

  return { message: 'Regularisation rejected' };
}
