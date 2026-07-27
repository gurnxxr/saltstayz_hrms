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
  overtime_multiplier: number; // OT rate = hourly rate × this (shift must allow OT)
  // Attendance policy (Phase 2) — drives Present / Short Punch / Miss Punch:
  grace_minutes: number;        // early-exit tolerance before a day is a short punch
  standard_day_hours: number;   // fallback shift length when no shift is assigned
  miss_punch_allowance: number; // miss punches/month treated as present
  miss_punch_lop: number;       // LOP per miss punch beyond the allowance
  short_punch_lop: number;      // LOP per short punch
  // Coverage gate (Phase 3): max % of working-day cells that may be unmarked
  // before locking a payroll month requires an explicit confirmation.
  attendance_gate_pct: number;
  // The first date a work pattern may decide. Patterns are configured today but evaluated over
  // history, so this stops one saved this morning re-pricing a month already paid. Set once, by
  // migration 020, to the first month whose payroll had not started. NULL = nothing to protect.
  work_pattern_effective_from: string | null;
}

const DEFAULTS: PaySchedule = {
  work_week: [1, 2, 3, 4, 5], // Mon–Fri
  salary_calculation_method: 'actual_days',
  fixed_working_days: 30,
  pay_date_type: 'last_day',
  pay_date_day: 1,
  unmarked_day_policy: 'present',
  holidays_paid: true,
  overtime_multiplier: 2,
  grace_minutes: 15,
  standard_day_hours: 8,
  miss_punch_allowance: 3,
  miss_punch_lop: 0.5,
  short_punch_lop: 0.5,
  attendance_gate_pct: 10,
  work_pattern_effective_from: null,
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
    overtime_multiplier: Number(row.overtime_multiplier) || 2,
    grace_minutes: row.grace_minutes == null ? DEFAULTS.grace_minutes : Number(row.grace_minutes),
    standard_day_hours: Number(row.standard_day_hours) || DEFAULTS.standard_day_hours,
    miss_punch_allowance: row.miss_punch_allowance == null ? DEFAULTS.miss_punch_allowance : Number(row.miss_punch_allowance),
    miss_punch_lop: row.miss_punch_lop == null ? DEFAULTS.miss_punch_lop : Number(row.miss_punch_lop),
    short_punch_lop: row.short_punch_lop == null ? DEFAULTS.short_punch_lop : Number(row.short_punch_lop),
    attendance_gate_pct: row.attendance_gate_pct == null ? DEFAULTS.attendance_gate_pct : Number(row.attendance_gate_pct),
    work_pattern_effective_from: row.work_pattern_effective_from
      ? String(row.work_pattern_effective_from).slice(0, 10) : null,
    updated_by: row.updated_by,
    updated_at: row.updated_at,
  };
}

export async function getPaySchedule() {
  const row = await db(TABLE).orderBy('id').first();
  return parseRow(row);
}

export async function updatePaySchedule(input: any, userId?: number) {
  // Work week is no longer user-configurable — payable days are driven by each
  // employee's published roster (see payableDays.service). The stored value is kept
  // only as the fallback for weeks with no published roster, so preserve it (or seed
  // the Mon–Fri default) rather than requiring it on save.
  const existing = await db(TABLE).orderBy('id').first();
  // A save is a MERGE onto the stored settings: any field the form omits keeps its stored
  // value (falling back to DEFAULTS only when there is no row yet). Previously every
  // omitted field silently reset to its DEFAULT — most visibly fixed_working_days, which
  // the UI doesn't expose, so it could never hold anything but 30.
  const current = parseRow(existing);
  let workWeekJson: string = existing?.work_week ?? JSON.stringify(DEFAULTS.work_week);
  if (Array.isArray(input.work_week) && input.work_week.length) {
    const days = Array.from(new Set(input.work_week.map(Number))) as number[];
    if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new ValidationError('Invalid working day.');
    workWeekJson = JSON.stringify(days.sort((a, b) => a - b));
  }

  // ── Salary calculation method ──
  const method = input.salary_calculation_method != null ? String(input.salary_calculation_method) : current.salary_calculation_method;
  if (!CALC_METHODS.includes(method as any)) throw new ValidationError('Invalid salary calculation method.');

  let fixedDays = current.fixed_working_days;
  if (input.fixed_working_days != null) {
    fixedDays = Number(input.fixed_working_days);
    if (!Number.isInteger(fixedDays) || fixedDays < 1 || fixedDays > 31) {
      throw new ValidationError('Fixed working days must be between 1 and 31.');
    }
  }

  // ── Pay date ──
  const payType = input.pay_date_type != null ? String(input.pay_date_type) : current.pay_date_type;
  if (!PAY_DATE_TYPES.includes(payType as any)) throw new ValidationError('Invalid pay date type.');

  let payDay = current.pay_date_day;
  if (payType === 'fixed_day' && input.pay_date_day != null) {
    payDay = Number(input.pay_date_day);
    if (!Number.isInteger(payDay) || payDay < 1 || payDay > 31) {
      throw new ValidationError('Pay date day must be between 1 and 31.');
    }
  }

  // ── Attendance policies (Phase 3) ──
  const unmarkedPolicy = input.unmarked_day_policy != null
    ? (input.unmarked_day_policy === 'absent' ? 'absent' : 'present') : current.unmarked_day_policy;
  const holidaysPaid = input.holidays_paid === undefined ? current.holidays_paid : !!input.holidays_paid;

  // ── Overtime multiplier (Phase 4) ──
  let otMultiplier = current.overtime_multiplier;
  if (input.overtime_multiplier != null) {
    otMultiplier = Number(input.overtime_multiplier);
    if (!Number.isFinite(otMultiplier) || otMultiplier < 1 || otMultiplier > 5) {
      throw new ValidationError('Overtime multiplier must be between 1 and 5.');
    }
  }

  // ── Attendance policy (Phase 2) ── (omitted fields keep their stored value)
  const intIn = (v: any, name: string, min: number, max: number, dflt: number) => {
    if (v == null) return dflt;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new ValidationError(`${name} must be a whole number between ${min} and ${max}.`);
    return n;
  };
  const lopIn = (v: any, name: string, dflt: number) => {
    if (v == null) return dflt;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1) throw new ValidationError(`${name} must be between 0 and 1 day.`);
    return Math.round(n * 10) / 10;
  };
  const graceMinutes = intIn(input.grace_minutes, 'Grace minutes', 0, 240, current.grace_minutes);
  const missAllowance = intIn(input.miss_punch_allowance, 'Miss-punch allowance', 0, 31, current.miss_punch_allowance);
  const missLop = lopIn(input.miss_punch_lop, 'Miss-punch LOP', current.miss_punch_lop);
  const shortLop = lopIn(input.short_punch_lop, 'Short-punch LOP', current.short_punch_lop);
  const attendanceGatePct = intIn(input.attendance_gate_pct, 'Attendance coverage threshold', 0, 100, current.attendance_gate_pct);
  let standardDayHours = current.standard_day_hours;
  if (input.standard_day_hours != null) {
    standardDayHours = Number(input.standard_day_hours);
    if (!Number.isFinite(standardDayHours) || standardDayHours <= 0 || standardDayHours > 24) {
      throw new ValidationError('Standard day hours must be between 0 and 24.');
    }
  }

  const patch = {
    work_week: workWeekJson,
    salary_calculation_method: method,
    fixed_working_days: fixedDays,
    pay_date_type: payType,
    pay_date_day: payDay,
    unmarked_day_policy: unmarkedPolicy,
    holidays_paid: holidaysPaid ? true : false,
    overtime_multiplier: otMultiplier,
    grace_minutes: graceMinutes,
    standard_day_hours: standardDayHours,
    miss_punch_allowance: missAllowance,
    miss_punch_lop: missLop,
    short_punch_lop: shortLop,
    attendance_gate_pct: attendanceGatePct,
    updated_by: userId || null,
    updated_at: db.fn.now(),
  };

  // Singleton upsert (existing fetched above).
  if (existing) await db(TABLE).where('id', existing.id).update(patch);
  else await db(TABLE).insert(patch);

  return getPaySchedule();
}
