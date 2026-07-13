import db from '../config/database';
import { NotFoundError, ValidationError, ForbiddenError } from '../utils/errors';
import { notifyEmployee } from './notification.service';

const TABLE = 'employee_shift_change_requests';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HR_ROLES = ['admin', 'chro', 'hr'];
const hhmm = (t: any) => (t ? String(t).slice(0, 5) : null);
const today = () => new Date().toISOString().slice(0, 10);

// ─── Employee self-service ───

/** The employee's own upcoming published shifts (their roster from today on). */
export async function getMyUpcomingShifts(employeeId: number) {
  const rows = await db('shift_rosters as r')
    .leftJoin('shift_types as st', 'st.id', 'r.shift_type_id')
    .where('r.employee_id', employeeId)
    .where('r.is_published', true)
    .where('r.date', '>=', today())
    .orderBy('r.date')
    .limit(28)
    .select('r.date', 'r.day_type', 'r.shift_type_id', 'st.name as shift_name', 'st.start_time', 'st.end_time');
  return rows.map((r: any) => ({
    date: String(r.date).slice(0, 10),
    day_type: r.day_type,
    shift_type_id: r.shift_type_id,
    shift_name: r.shift_name,
    start_time: hhmm(r.start_time),
    end_time: hhmm(r.end_time),
  }));
}

/** Active shift types, minimal — powers the "request a change" picker (auth-only). */
export async function listActiveShiftTypes() {
  const rows = await db('shift_types').where('is_active', true).orderBy('name')
    .select('id', 'name', 'start_time', 'end_time');
  return rows.map((s: any) => ({ id: s.id, name: s.name, start_time: hhmm(s.start_time), end_time: hhmm(s.end_time) }));
}

/** The employee's own change requests, newest first. */
export async function listMyChangeRequests(employeeId: number) {
  return db(`${TABLE} as cr`)
    .leftJoin('shift_types as fs', 'fs.id', 'cr.from_shift_type_id')
    .leftJoin('shift_types as ts', 'ts.id', 'cr.to_shift_type_id')
    .where('cr.employee_id', employeeId)
    .orderBy('cr.created_at', 'desc')
    .select('cr.*', 'fs.name as from_shift_name', 'ts.name as to_shift_name');
}

/** Raise a change request for one of the employee's own rostered days. */
export async function createChangeRequest(employeeId: number, data: any) {
  const date = String(data.date || '');
  if (!ISO_DATE.test(date)) throw new ValidationError('A valid date is required.');
  if (date < today()) throw new ValidationError('You can only request a change for a current or future day.');

  const toDayType = data.to_day_type === 'weekly_off' ? 'weekly_off' : 'working';
  let toShiftTypeId: number | null = null;
  if (toDayType === 'working') {
    toShiftTypeId = Number(data.to_shift_type_id) || 0;
    if (!toShiftTypeId) throw new ValidationError('Choose the shift you would like.');
    const st = await db('shift_types').where('id', toShiftTypeId).first();
    if (!st) throw new ValidationError('Unknown shift.');
  }

  const emp = await db('employees').where('id', employeeId).first();
  if (!emp) throw new NotFoundError('Employee');

  const dup = await db(TABLE).where({ employee_id: employeeId, date, status: 'pending' }).first();
  if (dup) throw new ValidationError('You already have a pending change request for this day.');

  // Snapshot what the employee is currently rostered for that day (if anything).
  const cell = await db('shift_rosters').where({ employee_id: employeeId, date }).first();

  const [id] = await db(TABLE).insert({
    employee_id: employeeId,
    date,
    from_shift_type_id: cell?.shift_type_id ?? null,
    from_day_type: cell?.day_type ?? 'working',
    to_shift_type_id: toShiftTypeId,
    to_day_type: toDayType,
    reason: data.reason ? String(data.reason).trim() : null,
    status: 'pending',
  });

  // Notify the reporting manager (an employee id) if one exists.
  if (emp.reporting_manager_id) {
    await notifyEmployee(emp.reporting_manager_id, {
      type: 'shift_change_requested',
      title: 'Shift change request to review',
      message: `${emp.first_name} ${emp.last_name} requested a shift change for ${date}.`,
      link: '/shifts/change-requests',
    });
  }

  const rows = await listMyChangeRequests(employeeId);
  return rows.find((r: any) => r.id === id);
}

// ─── Manager / HR review ───

/** Requests an approver can act on: HR/admin see all; a manager sees their reports'. */
export async function listChangeRequestsForApprover(approverEmployeeId: number | null, roleName: string, status = 'pending') {
  const q = db(`${TABLE} as cr`)
    .join('employees as e', 'e.id', 'cr.employee_id')
    .leftJoin('shift_types as fs', 'fs.id', 'cr.from_shift_type_id')
    .leftJoin('shift_types as ts', 'ts.id', 'cr.to_shift_type_id')
    .orderBy('cr.created_at', 'desc')
    .select(
      'cr.*',
      'e.first_name', 'e.last_name', 'e.employee_code', 'e.branch_name',
      'fs.name as from_shift_name', 'ts.name as to_shift_name',
    );
  if (status) q.where('cr.status', status);
  if (!HR_ROLES.includes(roleName)) q.where('e.reporting_manager_id', approverEmployeeId ?? -1);
  return q;
}

/** Approve or reject. Approving writes the employee's published roster cell for the date. */
export async function decideChangeRequest(
  id: number,
  approver: { employeeId: number | null; userId: number; roleName: string },
  approve: boolean,
  note?: string,
) {
  const cr = await db(`${TABLE} as cr`)
    .join('employees as e', 'e.id', 'cr.employee_id')
    .where('cr.id', id)
    .select('cr.*', 'e.reporting_manager_id', 'e.branch_name')
    .first();
  if (!cr) throw new NotFoundError('Shift change request');
  if (cr.status !== 'pending') throw new ValidationError('This request has already been decided.');
  if (!HR_ROLES.includes(approver.roleName) && cr.reporting_manager_id !== approver.employeeId) {
    throw new ForbiddenError('Only the reporting manager or HR can decide this request.');
  }

  const noteVal = note ? String(note).trim() : null;

  if (!approve) {
    await db(TABLE).where('id', id).update({ status: 'rejected', reviewed_by: approver.userId, review_note: noteVal, updated_at: db.fn.now() });
    await notifyEmployee(cr.employee_id, {
      type: 'shift_change_rejected',
      title: 'Shift change not approved',
      message: `Your shift change request for ${String(cr.date).slice(0, 10)} was not approved.`,
      link: '/shifts/my',
    });
    return { message: 'Request rejected' };
  }

  // Approving mutates the live roster — block if that month's payroll is locked.
  const date = String(cr.date).slice(0, 10);
  const [year, month] = date.split('-').map(Number);
  const run = await db('payroll_runs').where({ month, year }).first();
  if (run?.status === 'locked') {
    throw new ValidationError(`Payroll for ${date.slice(0, 7)} is locked; unlock it before changing that day's shift.`);
  }
  const prop = await db('properties').where('name', cr.branch_name).first();
  if (!prop) throw new ValidationError('This employee is not linked to a property; assign one before updating their roster.');

  await db.transaction(async (trx) => {
    await trx(TABLE).where('id', id).update({ status: 'approved', reviewed_by: approver.userId, review_note: noteVal, updated_at: trx.fn.now() });
    const key = { employee_id: cr.employee_id, date };
    const payload = {
      shift_type_id: cr.to_day_type === 'working' ? cr.to_shift_type_id : null,
      day_type: cr.to_day_type,
      property_id: prop?.id ?? null,
      assigned_by: approver.userId,
      is_published: true,
      published_at: trx.fn.now(),
      published_by: approver.userId,
      updated_at: trx.fn.now(),
    };
    const existing = await trx('shift_rosters').where(key).first();
    if (existing) await trx('shift_rosters').where('id', existing.id).update(payload);
    else await trx('shift_rosters').insert({ ...key, ...payload });
  });

  await notifyEmployee(cr.employee_id, {
    type: 'shift_change_approved',
    title: 'Shift change approved',
    message: `Your shift change for ${date} was approved and your roster updated.`,
    link: '/shifts/my',
  });
  return { message: 'Request approved' };
}
