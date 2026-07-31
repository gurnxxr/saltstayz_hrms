import db from '../config/database';
import { ValidationError } from '../utils/errors';

// Per-attendance-code pay rules (Admin → Payroll → Attendance Pay Rules). One row per code in
// `attendance_pay_rules`, keyed by the value stored in `attendance_records.status`. The payroll
// engine (payableDays.service) reads these at run time to decide how much each day pays.

const TABLE = 'attendance_pay_rules';

export interface AttendancePayRule {
  code: string;
  label: string;
  pay_fraction: number;           // 0..1 — share of a day's pay the code earns
  counts_in_denominator: boolean; // is the day a working day for the salary divisor?
  deducts_leave_fraction: number; // 0..1 — leave balance the code uses (Half Day = 0.5)
  config: Record<string, any>;    // extras — miss-punch { allowance, beyond_pay_fraction }
}

// Canonical codes + defaults (mirrors migration 017). Stored rows override these; a missing row
// still resolves to its default so payroll never sees an undefined rule.
export const DEFAULT_RULES: Record<string, AttendancePayRule> = {
  present:     { code: 'present',     label: 'Present',          pay_fraction: 1,   counts_in_denominator: true,  deducts_leave_fraction: 0,   config: {} },
  // A missing biometric record pays NOTHING until someone reviews it. Paying it in full would
  // mean a broken fingerprint reader silently pays a whole property for days nobody can evidence.
  // The employee's remedy is to raise a regularisation, which pays the day in full once approved.
  no_punch:    { code: 'no_punch',    label: 'No Punch',         pay_fraction: 0,   counts_in_denominator: true,  deducts_leave_fraction: 0,   config: {} },
  absent:      { code: 'absent',      label: 'Absent',           pay_fraction: 0,   counts_in_denominator: true,  deducts_leave_fraction: 0,   config: {} },
  half_day:    { code: 'half_day',    label: 'Half Day',         pay_fraction: 0.5, counts_in_denominator: true,  deducts_leave_fraction: 0.5, config: {} },
  short_punch: { code: 'short_punch', label: 'Short Present',    pay_fraction: 0.5, counts_in_denominator: true,  deducts_leave_fraction: 0,   config: {} },
  miss_punch:  { code: 'miss_punch',  label: 'Missed Punch',     pay_fraction: 1,   counts_in_denominator: true,  deducts_leave_fraction: 0,   config: { allowance: 3, beyond_pay_fraction: 0.5 } },
  hhd:         { code: 'hhd',         label: 'Half-Day Holiday', pay_fraction: 0.5, counts_in_denominator: true,  deducts_leave_fraction: 0,   config: {} },
  weekly_off:  { code: 'weekly_off',  label: 'Weekly Off',       pay_fraction: 1,   counts_in_denominator: false, deducts_leave_fraction: 0,   config: {} },
};

// The order shown in the Admin screen: worked → partial → not-worked → off.
const DISPLAY_ORDER = ['present', 'no_punch', 'half_day', 'short_punch', 'miss_punch', 'hhd', 'absent', 'weekly_off'];

function parseRow(row: any): AttendancePayRule {
  const dflt = DEFAULT_RULES[row.code] || { code: row.code, label: row.code, pay_fraction: 1, counts_in_denominator: true, deducts_leave_fraction: 0, config: {} };
  let config: Record<string, any> = {};
  try { config = row.config ? JSON.parse(row.config) : {}; } catch { config = {}; }
  return {
    code: row.code,
    label: row.label || dflt.label,
    pay_fraction: row.pay_fraction == null ? dflt.pay_fraction : Number(row.pay_fraction),
    counts_in_denominator: row.counts_in_denominator == null ? dflt.counts_in_denominator : !!row.counts_in_denominator,
    deducts_leave_fraction: row.deducts_leave_fraction == null ? dflt.deducts_leave_fraction : Number(row.deducts_leave_fraction),
    config: { ...dflt.config, ...config },
  };
}

/** Every code as a `Map<code, rule>` — stored rows override defaults. Read at payroll time. */
export async function getAttendancePayRules(): Promise<Map<string, AttendancePayRule>> {
  const rows = await db(TABLE).select('*');
  const map = new Map<string, AttendancePayRule>();
  for (const code of Object.keys(DEFAULT_RULES)) map.set(code, { ...DEFAULT_RULES[code] });
  for (const r of rows) map.set(r.code, parseRow(r));
  return map;
}

/** Ordered list for the Admin screen. */
export async function listAttendancePayRules(): Promise<AttendancePayRule[]> {
  const map = await getAttendancePayRules();
  const ordered = DISPLAY_ORDER.filter((c) => map.has(c)).map((c) => map.get(c)!);
  const extras = [...map.values()].filter((r) => !DISPLAY_ORDER.includes(r.code));
  return [...ordered, ...extras];
}

const fracIn = (v: any, name: string, dflt: number): number => {
  if (v == null) return dflt;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new ValidationError(`${name} must be between 0 and 1.`);
  return Math.round(n * 100) / 100;
};

/** Validate + upsert one code's rule (merge — omitted fields keep their stored value). */
export async function updateAttendancePayRule(code: string, input: any, userId?: number): Promise<AttendancePayRule> {
  if (!DEFAULT_RULES[code]) throw new ValidationError('Unknown attendance code.');
  const existing = await db(TABLE).where('code', code).first();
  const current = existing ? parseRow(existing) : DEFAULT_RULES[code];

  const pay_fraction = fracIn(input.pay_fraction, 'Pay fraction', current.pay_fraction);
  const deducts_leave_fraction = fracIn(input.deducts_leave_fraction, 'Leave deduction', current.deducts_leave_fraction);
  const counts_in_denominator = input.counts_in_denominator === undefined ? current.counts_in_denominator : !!input.counts_in_denominator;

  let config: Record<string, any> = { ...current.config };
  if (input.config && typeof input.config === 'object') config = { ...config, ...input.config };
  if (config.allowance != null) {
    const a = Number(config.allowance);
    if (!Number.isInteger(a) || a < 0 || a > 31) throw new ValidationError('Allowance must be a whole number between 0 and 31.');
    config.allowance = a;
  }
  if (config.beyond_pay_fraction != null) {
    config.beyond_pay_fraction = fracIn(config.beyond_pay_fraction, 'Beyond-allowance pay', current.config.beyond_pay_fraction ?? 0.5);
  }

  const patch = {
    code,
    label: input.label != null ? String(input.label).slice(0, 60) : current.label,
    pay_fraction,
    counts_in_denominator,
    deducts_leave_fraction,
    config: JSON.stringify(config),
    updated_by: userId || null,
    updated_at: db.fn.now(),
  };
  if (existing) await db(TABLE).where('id', existing.id).update(patch);
  else await db(TABLE).insert(patch);

  return parseRow(await db(TABLE).where('code', code).first());
}
