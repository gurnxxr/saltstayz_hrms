import db from '../config/database';
import { ValidationError } from '../utils/errors';

// Org-wide pay-schedule settings. One singleton row lives in `pay_schedule_settings`.
// work_week is stored as a JSON array of weekday indices (0=Sun … 6=Sat).

const TABLE = 'pay_schedule_settings';
const CALC_METHODS = ['actual_days', 'fixed_days'] as const;
const PAY_DATE_TYPES = ['last_day', 'fixed_day'] as const;

export interface PaySchedule {
  work_week: number[];
  salary_calculation_method: string;
  fixed_working_days: number;
  pay_date_type: string;
  pay_date_day: number;
  unmarked_day_policy: string; // present | absent — what an unmarked working day means
  holidays_paid: boolean;      // regional holidays count as paid working days
}

const DEFAULTS: PaySchedule = {
  work_week: [1, 2, 3, 4, 5], // Mon–Fri
  salary_calculation_method: 'actual_days',
  fixed_working_days: 30,
  pay_date_type: 'last_day',
  pay_date_day: 1,
  unmarked_day_policy: 'present',
  holidays_paid: true,
};

function parseRow(row: any) {
  if (!row) return { ...DEFAULTS };
  let work_week = DEFAULTS.work_week;
  try {
    const parsed = JSON.parse(row.work_week);
    if (Array.isArray(parsed)) work_week = parsed.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  } catch {
    /* keep default */
  }
  return {
    id: row.id,
    work_week,
    salary_calculation_method: row.salary_calculation_method,
    fixed_working_days: Number(row.fixed_working_days),
    pay_date_type: row.pay_date_type,
    pay_date_day: Number(row.pay_date_day),
    unmarked_day_policy: row.unmarked_day_policy === 'absent' ? 'absent' : 'present',
    holidays_paid: row.holidays_paid === undefined || row.holidays_paid === null ? true : !!row.holidays_paid,
    updated_by: row.updated_by,
    updated_at: row.updated_at,
  };
}

export async function getPaySchedule() {
  const row = await db(TABLE).orderBy('id').first();
  return parseRow(row);
}

export async function updatePaySchedule(input: any, userId?: number) {
  // ── Work week: at least one day, all valid 0–6, de-duplicated & sorted ──
  const days: number[] = Array.isArray(input.work_week)
    ? Array.from(new Set(input.work_week.map(Number)))
    : [];
  if (days.length === 0) throw new ValidationError('Select at least one working day.');
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new ValidationError('Invalid working day.');

  // ── Salary calculation method ──
  const method = String(input.salary_calculation_method);
  if (!CALC_METHODS.includes(method as any)) throw new ValidationError('Invalid salary calculation method.');

  let fixedDays = DEFAULTS.fixed_working_days;
  if (input.fixed_working_days != null) {
    fixedDays = Number(input.fixed_working_days);
    if (!Number.isInteger(fixedDays) || fixedDays < 1 || fixedDays > 31) {
      throw new ValidationError('Fixed working days must be between 1 and 31.');
    }
  }

  // ── Pay date ──
  const payType = String(input.pay_date_type);
  if (!PAY_DATE_TYPES.includes(payType as any)) throw new ValidationError('Invalid pay date type.');

  let payDay = DEFAULTS.pay_date_day;
  if (payType === 'fixed_day') {
    payDay = Number(input.pay_date_day);
    if (!Number.isInteger(payDay) || payDay < 1 || payDay > 31) {
      throw new ValidationError('Pay date day must be between 1 and 31.');
    }
  }

  // ── Attendance policies (Phase 3) ──
  const unmarkedPolicy = input.unmarked_day_policy === 'absent' ? 'absent' : 'present';
  const holidaysPaid = input.holidays_paid === undefined ? true : !!input.holidays_paid;

  const patch = {
    work_week: JSON.stringify(days.sort((a, b) => a - b)),
    salary_calculation_method: method,
    fixed_working_days: fixedDays,
    pay_date_type: payType,
    pay_date_day: payDay,
    unmarked_day_policy: unmarkedPolicy,
    holidays_paid: holidaysPaid ? 1 : 0,
    updated_by: userId || null,
    updated_at: db.fn.now(),
  };

  // Singleton upsert.
  const existing = await db(TABLE).orderBy('id').first();
  if (existing) await db(TABLE).where('id', existing.id).update(patch);
  else await db(TABLE).insert(patch);

  return getPaySchedule();
}
