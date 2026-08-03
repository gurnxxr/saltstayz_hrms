import db from '../config/database';
import { NotFoundError, ValidationError, ForbiddenError } from '../utils/errors';
import { notifyEmployee, emit } from './notification.service';
import {
  assignShift, resolveShiftForEmployee, getEmployeeShiftHistory, currentShiftView,
} from './shift.service';

/**
 * Shift change requests.
 *
 * A request used to be "give me a different shift on this one date", written into a weekly
 * roster cell. With the grid gone it is "move me onto a different shift from this date", and
 * approving it writes a dated assignment — the same thing HR does from the assignments screen,
 * just with an approval trail in front of it.
 */

const TABLE = 'employee_shift_change_requests';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HR_ROLES = ['admin', 'chro', 'hr'];
const hhmm = (t: any) => (t ? String(t).slice(0, 5) : null);
const today = () => new Date().toISOString().slice(0, 10);

// ─── Employee self-service ───

/** The employee's own shift: what they're on now, and anything already lined up. */
export async function getMyShiftOverview(employeeId: number) {
  const current = await resolveShiftForEmployee(employeeId, today());
  const history = await getEmployeeShiftHistory(employeeId);
  const now = today();
  return {
    // Built by the shared view so this and the dashboard card cannot drift apart again.
    current: currentShiftView(current),
    upcoming: history
      .filter((h: any) => String(h.effective_from).slice(0, 10) > now)
      .map((h: any) => ({
        effective_from: String(h.effective_from).slice(0, 10),
        shift_name: h.shift_name,
        start_time: hhmm(h.start_time),
        end_time: hhmm(h.end_time),
      }))
      .reverse(),
  };
}

/** Active shift types, minimal — powers the "request a change" picker (auth-only). */
export async function listActiveShiftTypes() {
  const rows = await db('shift_types').where('is_active', true).orderBy('name')
    .select('id', 'name', 'start_time', 'end_time', 'ends_next_day', 'weekly_off_days');
  return rows.map((s: any) => ({
    id: s.id,
    name: s.name,
    start_time: hhmm(s.start_time),
    end_time: hhmm(s.end_time),
    ends_next_day: !!s.ends_next_day,
    weekly_off_days: Array.isArray(s.weekly_off_days) ? s.weekly_off_days : [],
  }));
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

/** Ask to be moved onto a different shift from a date. */
export async function createChangeRequest(employeeId: number, data: any) {
  const date = String(data.date || '');
  if (!ISO_DATE.test(date)) throw new ValidationError('A valid date is required.');
  if (date < today()) throw new ValidationError('You can only request a change from today onwards.');

  const toShiftTypeId = Number(data.to_shift_type_id) || 0;
  if (!toShiftTypeId) throw new ValidationError('Choose the shift you would like.');
  const target = await db('shift_types').where('id', toShiftTypeId).first();
  if (!target) throw new ValidationError('Unknown shift.');
  if (!target.is_active) throw new ValidationError('That shift is no longer in use.');

  const emp = await db('employees').where('id', employeeId).first();
  if (!emp) throw new NotFoundError('Employee');

  const current = await resolveShiftForEmployee(employeeId, date);
  if (current?.id === toShiftTypeId) {
    throw new ValidationError('You are already on that shift from this date.');
  }

  const dup = await db(TABLE).where({ employee_id: employeeId, status: 'pending' }).first();
  if (dup) throw new ValidationError('You already have a change request waiting to be reviewed.');

  const [{ id }] = await db(TABLE).insert({
    employee_id: employeeId,
    date,
    from_shift_type_id: current?.id ?? null,
    to_shift_type_id: toShiftTypeId,
    reason: data.reason ? String(data.reason).trim() : null,
    status: 'pending',
  }).returning('id');

  // Configured on Admin → Notifications; the reporting manager is ticked out of the box, and
  // HR catches it when the employee has no manager on file.
  await emit('shift.change_requested', {
    employeeId,
    actorEmployeeId: employeeId,
    payload: {
      type: 'shift_change_requested',
      title: 'Shift change request to review',
      message: `${emp.first_name} ${emp.last_name} asked to move to ${target.name} from ${date}.`,
      link: '/shifts/change-requests',
    },
  });

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
      'ts.start_time as to_start_time', 'ts.end_time as to_end_time',
    );
  if (status) q.where('cr.status', status);
  if (!HR_ROLES.includes(roleName)) q.where('e.reporting_manager_id', approverEmployeeId ?? -1);
  return q;
}

/** Approve or reject. Approving writes the employee's shift assignment from the date. */
export async function decideChangeRequest(
  id: number,
  approver: { employeeId: number | null; userId: number; roleName: string },
  approve: boolean,
  note?: string,
) {
  const cr = await db(`${TABLE} as cr`)
    .join('employees as e', 'e.id', 'cr.employee_id')
    .where('cr.id', id)
    .select('cr.*', 'e.reporting_manager_id')
    .first();
  if (!cr) throw new NotFoundError('Shift change request');
  if (cr.status !== 'pending') throw new ValidationError('This request has already been decided.');
  // Fail closed when the approver has no employee record: without this, an approver
  // whose employeeId is null and a request whose reporting_manager_id is also null
  // slip through (null !== null is false), letting a non-manager decide the request.
  if (!HR_ROLES.includes(approver.roleName) &&
      (approver.employeeId == null || cr.reporting_manager_id !== approver.employeeId)) {
    throw new ForbiddenError('Only the reporting manager or HR can decide this request.');
  }

  const noteVal = note ? String(note).trim() : null;
  const date = String(cr.date).slice(0, 10);

  if (!approve) {
    await db(TABLE).where('id', id).update({
      status: 'rejected', reviewed_by: approver.userId, review_note: noteVal, updated_at: db.fn.now(),
    });
    await notifyEmployee(cr.employee_id, {
      type: 'shift_change_rejected',
      title: 'Shift change not approved',
      message: `Your request to change shift from ${date} was not approved.`,
      link: '/shifts/my',
    });
    return { message: 'Request rejected' };
  }

  // assignShift refuses a locked payroll month and an inactive or not-yet-effective shift,
  // so the request is marked approved only once the change has actually been made.
  await assignShift(
    { employee_id: cr.employee_id, shift_type_id: cr.to_shift_type_id, effective_from: date },
    approver.userId,
  );
  await db(TABLE).where('id', id).update({
    status: 'approved', reviewed_by: approver.userId, review_note: noteVal, updated_at: db.fn.now(),
  });

  await notifyEmployee(cr.employee_id, {
    type: 'shift_change_approved',
    title: 'Shift change approved',
    message: `Your shift change takes effect from ${date}.`,
    link: '/shifts/my',
  });
  await emit('shift.change_decided', {
    employeeId: cr.employee_id,
    actorUserId: approver.userId,
    payload: {
      type: 'shift_change_approved_fyi',
      title: 'Shift change approved',
      message: `${cr.first_name || 'An employee'} ${cr.last_name || ''}`.trim()
        + ` moves to a new shift from ${date}.`,
      link: '/shifts/change-requests',
    },
  });
  return { message: 'Request approved' };
}
