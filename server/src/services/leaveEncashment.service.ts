import db from '../config/database';
import { NotFoundError, ValidationError } from '../utils/errors';
import { getCurrentPeriod } from './leave.service';
import { getMonthlyBreakdown } from './payslip.service';

// ─────────────────────────────────────────────────────────────────────────────
// Leave Encashment (record-only by design): HR encashes unused leave days for
// an employee. Approving deducts the days from the entitlement (used_days),
// exactly like taking the leave would — the remaining balance drops everywhere
// (self-service balances, F&F). Finance pays the amount outside payroll; no
// payslip line is created.
//
// Rate = current Basic ÷ 30 (the offboarding F&F convention), captured on the
// record at request time so later structure edits don't change history.
//
// Lives in its own file (not leave.service) because it needs the payslip
// engine for Basic, and leave.service is upstream of payslip.service via
// payableDays — importing back would create a cycle.
// ─────────────────────────────────────────────────────────────────────────────

const num = (v: any) => (v === null || v === undefined || v === '' ? 0 : Number(v));

export async function listEncashments(filters: { status?: string } = {}) {
  const query = db('leave_encashments as le')
    .join('employees as e', 'e.id', 'le.employee_id')
    .join('leave_types as lt', 'lt.id', 'le.leave_type_id')
    .join('leave_periods as lp', 'lp.id', 'le.leave_period_id')
    .leftJoin('users as rb', 'rb.id', 'le.requested_by')
    .leftJoin('users as ab', 'ab.id', 'le.approved_by')
    .select(
      'le.*',
      'e.employee_code', 'e.first_name', 'e.last_name', 'e.branch_name',
      'lt.name as leave_type', 'lp.name as period_name',
      'rb.email as requested_by_email', 'ab.email as approved_by_email',
    )
    .orderBy('le.created_at', 'desc');
  if (filters.status) query.where('le.status', filters.status);
  return query;
}

export async function createEncashment(
  data: { employee_id: number; leave_type_id: number; days: number; note?: string },
  userId?: number | null,
) {
  const employeeId = Number(data.employee_id);
  const leaveTypeId = Number(data.leave_type_id);
  const days = num(data.days);

  const employee = await db('employees').where('id', employeeId).first();
  if (!employee) throw new NotFoundError('Employee');
  const leaveType = await db('leave_types').where('id', leaveTypeId).first();
  if (!leaveType) throw new NotFoundError('Leave type');
  if (!leaveType.is_encashable) throw new ValidationError(`${leaveType.name} is not encashable`);
  if (!Number.isFinite(days) || days <= 0 || days > 100) throw new ValidationError('Days must be a positive number');

  const period = await getCurrentPeriod();
  const entitlement = await db('leave_entitlements')
    .where({ employee_id: employeeId, leave_type_id: leaveTypeId, leave_period_id: period.id })
    .first();
  if (!entitlement) throw new ValidationError('No entitlement for this leave type in the current period');
  const balance = num(entitlement.total_days) - num(entitlement.used_days);
  if (days > balance) {
    throw new ValidationError(`Only ${balance} day(s) remaining — cannot encash ${days}`);
  }

  // Rate = current Basic ÷ 30 (full-month breakdown; F&F convention).
  const breakdown = await getMonthlyBreakdown(employeeId);
  if (!breakdown || !breakdown.basic) {
    throw new ValidationError('No salary structure configured for this employee — cannot compute the encashment rate');
  }
  const perDayRate = Math.round((breakdown.basic / 30) * 100) / 100;
  const amount = Math.round(days * perDayRate);

  const [{ id }] = await db('leave_encashments').insert({
    employee_id: employeeId,
    leave_type_id: leaveTypeId,
    leave_period_id: period.id,
    days,
    per_day_rate: perDayRate,
    amount,
    status: 'pending',
    note: data.note ? String(data.note).trim() : null,
    requested_by: userId ?? null,
  }).returning('id');
  const rows = await listEncashments();
  return rows.find((r: any) => r.id === id);
}

export async function approveEncashment(id: number, userId?: number | null) {
  const enc = await db('leave_encashments').where('id', id).first();
  if (!enc) throw new NotFoundError('Encashment');
  if (enc.status !== 'pending') throw new ValidationError('This encashment has already been processed');

  await db.transaction(async (trx) => {
    // Re-check the balance inside the transaction (leave may have been taken since).
    const entitlement = await trx('leave_entitlements')
      .where({
        employee_id: enc.employee_id,
        leave_type_id: enc.leave_type_id,
        leave_period_id: enc.leave_period_id,
      })
      .first();
    if (!entitlement) throw new ValidationError('Entitlement no longer exists');
    const balance = num(entitlement.total_days) - num(entitlement.used_days);
    if (num(enc.days) > balance) {
      throw new ValidationError(`Only ${balance} day(s) remaining — cannot encash ${num(enc.days)}`);
    }
    await trx('leave_entitlements').where('id', entitlement.id).increment('used_days', num(enc.days));
    await trx('leave_encashments').where('id', id).update({
      status: 'approved', approved_by: userId ?? null,
      approved_at: trx.fn.now(), updated_at: trx.fn.now(),
    });
  });
  const rows = await listEncashments();
  return rows.find((r: any) => r.id === id);
}

export async function rejectEncashment(id: number, userId?: number | null, reason?: string) {
  const enc = await db('leave_encashments').where('id', id).first();
  if (!enc) throw new NotFoundError('Encashment');
  if (enc.status !== 'pending') throw new ValidationError('This encashment has already been processed');

  await db('leave_encashments').where('id', id).update({
    status: 'rejected', approved_by: userId ?? null,
    rejection_reason: reason ? String(reason).trim() : null,
    approved_at: db.fn.now(), updated_at: db.fn.now(),
  });
  const rows = await listEncashments();
  return rows.find((r: any) => r.id === id);
}
