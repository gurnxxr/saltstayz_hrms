import db from '../config/database';
import { NotFoundError, ValidationError, ForbiddenError } from '../utils/errors';
import { notifyEmployee } from './notification.service';
import { monthWriteState } from './payrollMonth.service';
import { refreshPayslipAfterAttendanceChange, type RefreshResult } from './payslip.service';
import { getRegularisationSettings, cutoffDateFor } from './regularisationSettings.service';

// ─── Attendance regularisation ───
//
// Self-service correction of a wrongly-recorded day, on the standard HRMS model
// (greytHR / Keka / Zoho): HR uploads daily attendance; an employee who sees a
// wrong day picks WHAT THE DAY SHOULD BE (a status type) over a date range with a
// mandatory reason; the reporting manager (or HR) approves; on approval every date
// in the range is upserted onto attendance_records with the chosen status and
// flagged is_regularised — so payroll pays the right days and the calendar can
// mark the day "R". Guardrails: a correction deadline, a monthly cap, and a hard
// block once the pay period is locked. The first three are configurable — see
// regularisationSettings.service; the lock is not negotiable.

const STAFF_ROLES = ['admin', 'chro', 'hr'];

// How each regularisation type maps onto the attendance status vocabulary the payable-days engine
// understands. "No Punch" (np) is its own status (no_punch) — a biometric record was simply
// missing, which is distinct from a genuine Absent and is priced by its own configurable rule.
// Note that an *approved* regularisation is paid in full regardless of the stored status
// (payableDays reads is_regularised first); the status below is what the calendar and reports
// record.
//
// WHICH of these an employee may pick is configuration (regularisation_settings.allowed_types);
// this map is the complete vocabulary and must keep a mapping for every code in that service's
// SELECTABLE_TYPES. It deliberately stays complete even when the admin narrows the offered list,
// because a request raised while a type was on offer must still be approvable after it is
// withdrawn — the rules that applied when someone asked are the rules their request is judged by.
//
// "Absent" is deliberately NOT here. Asking to be marked absent is not a correction, and since an
// approved regularisation pays the day in full (see payableDays.service), it was a route to being
// paid for a day you yourself declared you did not work. Every remaining type describes a day the
// employee says they DID work, which is what makes the full-pay-on-approval rule sound.
const TYPE_TO_STATUS = {
  present: 'present', np: 'no_punch', mp: 'miss_punch', sp: 'short_punch',
} as const;
type RegType = keyof typeof TYPE_TO_STATUS;
const TYPE_LABELS: Record<RegType, string> = {
  present: 'Present', np: 'No Punch', mp: 'Miss Punch', sp: 'Short Punch',
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

/**
 * Blocks regularising a date whose payroll month can no longer be re-priced.
 *
 * This used to test `run.status === 'locked'` and nothing else, which left a real trap: a month
 * holding legacy payslips (calc_version 1) is frozen even when it was never locked, so a request
 * could be filed and approved into it, the attendance would change, the employee would be told it
 * was corrected — and every write path that could have paid it refuses. The correction could never
 * reach money, and nobody was told. Payroll already had the wider test; regularisation had its own
 * narrower one. They now share `monthWriteState`.
 *
 * Applied at REQUEST time as well as approval: failing in front of the person who can still do
 * something about it, today, beats failing in front of an approver a week later.
 */
async function assertMonthCorrectable(date: string) {
  const [year, month] = date.split('-').map(Number);
  const state = await monthWriteState(month, year);
  if (state.writable) return;
  const remedy = state.reason === 'locked'
    ? 'Ask HR to unlock it before regularising these dates.'
    : 'Its payslips cannot be re-priced, so this correction could never reach pay. Raise it with Finance as a manual correction instead.';
  throw new ValidationError(`${state.message}. ${remedy}`);
}

/**
 * Blocks regularising a date whose correction window has closed.
 *
 * Applied ONLY when a request is raised — never at approval. That asymmetry is the point, and it
 * is the opposite of assertMonthCorrectable's, which deliberately runs at both. The two ask
 * different questions:
 *
 *   • "can this month still be re-priced?" is about the system, can change while a request sits
 *     in the queue, and must be re-asked before writing — hence both points; and
 *   • "did the employee ask in time?" is about the employee, and was settled the moment they
 *     pressed submit.
 *
 * Re-checking the deadline at approval would mean a manager who took a week to look at their
 * queue silently destroys a correction that was filed properly and on time — punishing the
 * employee for the approver's delay, with no way to tell afterwards that it had ever been valid.
 *
 * `today` is passed in rather than read here so the whole range is judged against one instant; a
 * request submitted at midnight must not have its first date judged by yesterday and its last by
 * today. Both are YYYY-MM-DD, and comparing them as strings is exact.
 */
function assertWithinCutoff(date: string, cutoffDays: number | null, today: string) {
  if (cutoffDays == null) return; // no deadline configured — corrections stay open indefinitely
  const closes = cutoffDateFor(date, cutoffDays);
  if (today <= closes) return; // inclusive: a request raised ON the closing date is in time
  throw new ValidationError(
    `Attendance for ${date.slice(0, 7)} can no longer be regularised — corrections for that month closed on ${closes}. Ask HR to correct it for you.`,
  );
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

  const settings = await getRegularisationSettings();

  const type = String(data.requested_status || '') as RegType;
  if (!settings.allowed_types.includes(type)) throw new ValidationError('Choose a valid regularisation type');

  const reason = String(data.reason || '').trim();
  if (!reason) throw new ValidationError('A reason is required');

  const dates = eachDate(start, end);
  if (dates.length > settings.max_range_days) {
    throw new ValidationError(`A single request can cover at most ${settings.max_range_days} days`);
  }

  // Per date, because one request can straddle two months and they can close on different days:
  // the payroll month must still be open to a re-price, and the correction window must not have
  // shut. The deadline is checked HERE and nowhere else — see assertWithinCutoff.
  for (const d of dates) {
    await assertMonthCorrectable(d);
    assertWithinCutoff(d, settings.cutoff_days_after_month_end, today);
  }

  // No overlapping open request for any date in the range.
  const overlap = await db('attendance_regularisations')
    .where({ employee_id: employeeId, status: 'pending' })
    .whereRaw('date <= ? AND COALESCE(end_date, date) >= ?', [end, start])
    .first();
  if (overlap) throw new ValidationError('You already have a pending regularisation overlapping these dates');

  // Monthly cap (pending + approved requests) — enforced for EVERY month the requested
  // range touches, not just its start month. Otherwise a request whose dates spill into
  // a trailing month slips past that month's limit.
  //
  // Checking only the two ENDPOINT months is sound solely because a request can span at most 31
  // days and therefore at most two months. That is why max_range_days is capped at 31 in
  // regularisationSettings.service rather than left open — raise the ceiling without rewriting
  // this to walk every month in between and the middle months would skip their cap in silence.
  const months = [...new Set([start.slice(0, 7), end.slice(0, 7)])];
  for (const m of months) {
    const mStart = `${m}-01`;
    const mEnd = `${m}-31`; // lexical upper bound — safe for zero-padded YYYY-MM-DD compares
    const countRow = await db('attendance_regularisations')
      .where('employee_id', employeeId)
      .whereIn('status', ['pending', 'approved'])
      // count any existing request whose own range overlaps month m
      .whereRaw('date <= ? AND COALESCE(end_date, date) >= ?', [mEnd, mStart])
      .count({ c: 'id' }).first();
    if (Number((countRow as any)?.c || 0) >= settings.monthly_request_limit) {
      throw new ValidationError(`You have reached the monthly regularisation limit (${settings.monthly_request_limit}) for ${m}.`);
    }
  }

  const [{ id }] = await db('attendance_regularisations').insert({
    attendance_id: null,
    employee_id: employeeId,
    date: start,
    end_date: end,
    requested_status: type,
    reason,
    status: 'pending',
  }).returning('id');

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
  for (const d of dates) await assertMonthCorrectable(d);

  const skipped: string[] = [];
  let applied = 0;
  let firstAttendanceId: number | null = null;

  await db.transaction(async (trx) => {
    // Claim the request atomically before applying anything: only a still-pending request
    // can be approved. loadForDecision's check ran outside the transaction, so two
    // concurrent approvals could both reach here — the status-conditioned UPDATE lets
    // exactly one win; the loser matches no row and aborts (rolling back its writes).
    const claimed = await trx('attendance_regularisations')
      .where({ id, status: 'pending' })
      .update({ status: 'approved', approved_by: approverId, decided_at: trx.fn.now(), updated_at: trx.fn.now() });
    if (!claimed) throw new ValidationError('Only pending requests can be actioned');

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
        const [{ id: newId }] = await trx('attendance_records').insert({
          employee_id: reg.employee_id,
          date,
          status,
          is_regularised: true,
        }).returning('id');
        if (firstAttendanceId === null) firstAttendanceId = newId;
      }
      applied += 1;
    }

    await trx('attendance_regularisations').where('id', id).update({
      applied_status: status,
      attendance_id: firstAttendanceId,
      updated_at: trx.fn.now(),
    });
  });

  // ── Make it reach the money ──
  //
  // The attendance transaction has COMMITTED by this point, and that ordering is the whole trick.
  // computeForEmployee and everything under it use the shared connection pool, so a re-price called
  // from inside the transaction above would read on a different connection, never see these rows,
  // and write the PRE-regularisation figure back as though it were the correction — a failure that
  // looks exactly like success. Committing first is what makes the recompute see the change.
  //
  // A request can span two months (max 31 days), so refresh each distinct month once.
  const monthsTouched = [...new Set(dates.map((d) => d.slice(0, 7)))];
  const pay: RefreshResult[] = [];
  for (const ym of monthsTouched) {
    const [y, m] = ym.split('-').map(Number);
    try {
      // No `generatedBy`, deliberately. `approverId` here is an EMPLOYEE id (the controller passes
      // req.user.employeeId), while payslip_history.generated_by is a foreign key to users.id —
      // passing it through would either violate the constraint or, worse, silently attribute the
      // payslip to whichever unrelated user shares that number. The payslip was still generated by
      // the payroll run; this only re-prices it. Who approved the correction is recorded on the
      // regularisation row, which is where it belongs.
      pay.push(await refreshPayslipAfterAttendanceChange(reg.employee_id, m, y));
    } catch (err: any) {
      // A failed re-price must not undo an approval the employee has been told about, and must not
      // be silent either. Record it; the derived staleness check will also flag the month, and the
      // lock gate will refuse until payroll is re-run.
      pay.push({
        outcome: 'blocked', month: m, year: y, reason: err?.message || 'could not be re-priced',
      });
    }
  }

  const worst = pay.find((p) => p.outcome === 'blocked')
    ?? pay.find((p) => p.outcome === 'refreshed')
    ?? pay[0];
  await db('attendance_regularisations').where('id', id).update({
    pay_refresh_status: worst?.outcome ?? null,
    pay_refresh_note: worst?.reason ?? null,
    updated_at: db.fn.now(),
  });

  const skipNote = skipped.length ? ` (${skipped.length} day(s) on approved leave were left unchanged)` : '';
  // Tell the employee what happened to their PAY, not just to the record. "Attendance regularised"
  // on its own is the sentence that made this bug invisible for so long.
  const payNote = worst?.outcome === 'refreshed' ? ' Your payslip for this month has been updated.'
    : worst?.outcome === 'no_payslip' ? ' Payroll for this month has not been run yet — this will be included when it is.'
      : worst?.outcome === 'blocked' ? ' Your payslip could NOT be updated — payroll has been notified.'
        : '';
  await notifyEmployee(reg.employee_id, {
    type: 'regularisation_approved',
    title: 'Attendance regularised',
    message: `Your attendance for ${rangeLabel(start, end)} was marked as ${TYPE_LABELS[type]}${skipNote}.${payNote}`,
    link: '/attendance/regularisation',
  });

  return { message: 'Regularisation approved', status, applied, skipped, pay: worst ?? null };
}

/** Reject: record the mandatory reason and notify the employee. Attendance unchanged. */
export async function rejectRegularisation(id: number, approverId: number, roleName: string, comment: string) {
  const reg = await loadForDecision(id, approverId, roleName);
  const note = String(comment || '').trim();
  if (!note) throw new ValidationError('A reason is required to reject');

  // Status-conditioned update closes the check-then-write race with a concurrent
  // approve/reject: only a still-pending request can be rejected.
  const updated = await db('attendance_regularisations')
    .where({ id, status: 'pending' })
    .update({
      status: 'rejected',
      approved_by: approverId,
      reviewer_comment: note,
      decided_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
  if (!updated) throw new ValidationError('Only pending requests can be actioned');

  await notifyEmployee(reg.employee_id, {
    type: 'regularisation_rejected',
    title: 'Regularisation rejected',
    message: `Your regularisation for ${rangeLabel(String(reg.date).slice(0, 10), reg.end_date && String(reg.end_date).slice(0, 10))} was rejected. Reason: ${note}`,
    link: '/attendance/regularisation',
  });

  return { message: 'Regularisation rejected' };
}
