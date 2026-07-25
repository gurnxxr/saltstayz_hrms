import db from '../config/database';
import { AppError, NotFoundError, ValidationError } from '../utils/errors';
import {
  payDateFor, monthName,
  type PayslipBreakdown, type AttendanceContext, type StructureLineInput,
} from './payslip.calc';
import {
  getAssignment, getStructureByJobTitle, getStructureRow, computeForStructure,
} from './salaryStructure.service';
import { getEmployeeState, getMinimumWageFor, getStatutoryRates } from './statutory.service';
import { getPaySchedule } from './paySchedule.service';
import { computePayableDays, getMonthlyHours, getOvertimeHours } from './payableDays.service';
import { notifyEmployee } from './notification.service';
import { csvCell } from '../utils/csv';

function num(v: any): number {
  return v === null || v === undefined ? 0 : Number(v);
}

/** Validates month/year and rejects any period later than the current month. */
function assertValidPeriod(month: number, year: number) {
  if (!month || month < 1 || month > 12) throw new ValidationError('Invalid month');
  if (!year || year < 2000 || year > 2100) throw new ValidationError('Invalid year');
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  if (year > currentYear || (year === currentYear && month > currentMonth)) {
    throw new ValidationError('Cannot generate a payslip for a future month');
  }
}

async function employeeOrThrow(employeeId: number) {
  const emp = await db('employees as e')
    .leftJoin('job_titles as j', 'j.id', 'e.job_title_id')
    .where('e.id', employeeId)
    .select(
      'e.id', 'e.employee_code', 'e.first_name', 'e.last_name',
      'e.dept_name', 'e.branch_name', 'e.job_title_id', 'j.title as designation_name',
    )
    .first();
  if (!emp) throw new NotFoundError('Employee');
  return emp;
}

// ─── Computation ───

export interface ComputedPayslip {
  employee: {
    id: number;
    employee_code: string;
    name: string;
    designation: string;
    department: string;
    branch: string;
  };
  month: number;
  year: number;
  monthLabel: string;
  payDate: string;
  breakdown: PayslipBreakdown;
}

/**
 * Resolves an employee's monthly salary breakdown from their per-employee setup
 * and/or designation structure. Returns null if neither is configured. Shared by
 * payslip generation and the offboarding Full & Final settlement.
 */
/** HR review-step corrections for one employee in one run. */
export async function getAdjustment(employeeId: number, month: number, year: number) {
  return db('payroll_adjustments').where({ employee_id: employeeId, month, year }).first();
}

/**
 * Resolves an employee's payslip breakdown. With a month/year the slip is
 * ATTENDANCE-DRIVEN: the payable-days engine turns attendance + approved
 * leaves + regional holidays into LOP, and pay is prorated (monthly) or
 * computed from hours (hourly). Without a period (offboarding F&F) it is a
 * plain full-month breakdown.
 */
/** ESI contribution period for a pay month: Apr–Sep = H1, Oct–Mar = H2. */
function esiPeriodKey(month: number, year: number): string {
  if (month >= 4 && month <= 9) return `${year}-H1`;
  // The Oct–Mar period starts in October; Jan–Mar belong to the prior year's H2.
  return `${month >= 10 ? year : year - 1}-H2`;
}

export async function getMonthlyBreakdown(
  employeeId: number, month?: number, year?: number,
  opts: { persistEsiPeriod?: boolean } = {},
): Promise<PayslipBreakdown | null> {
  // Explicit assignment wins; employees without one fall back to their
  // designation's structure at its default base (new hires keep working).
  const assignment = await getAssignment(employeeId);
  let structure: any = null;
  let base = 0;
  if (assignment) {
    structure = await getStructureRow(assignment.structure_id);
    base = num(assignment.base);
  } else {
    const emp = await db('employees').where('id', employeeId).select('job_title_id').first();
    if (emp?.job_title_id) structure = await getStructureByJobTitle(emp.job_title_id);
    base = structure ? num(structure.default_base) : 0;
  }
  if (!structure || base <= 0) return null;

  // Work-Location State (Phase 1): statutory rates come from the employee's
  // property state, never from the structure's city field.
  const state = await getEmployeeState(employeeId);

  const hourly = structure.payment_basis === 'hourly';
  const hasPeriod = month !== undefined && year !== undefined;
  if (hourly && !hasPeriod) {
    throw new AppError('Hourly-rated pay needs an attendance period — generate a monthly payslip instead.', 422);
  }

  let attendance: AttendanceContext | null = null;
  const extraLines: StructureLineInput[] = [];
  if (hasPeriod) {
    const days = await computePayableDays(employeeId, month!, year!);
    attendance = {
      period_days: days.period_days,
      working_days: days.working_days,
      scheduled_working_days: days.scheduled_working_days,
      lop_days: days.lop_days,
      not_employed_days: days.not_employed_days,
      payment_days: days.payment_days,
      counts: days.counts as any,
    };
    if (hourly) attendance.hours = await getMonthlyHours(employeeId, month!, year!);

    // Manual TDS (entered by Finance on the assignment) — a plain deduction line.
    const tds = assignment ? num(assignment.tds_amount) : 0;
    if (tds > 0) {
      extraLines.push({
        component_id: null, name: 'TDS', category: 'deduction',
        calculation_type: 'flat', value: tds,
        consider_epf: 'no', consider_esi: false, pro_rata: false,
      });
    }

    // Overtime — hours beyond shift length on an overtime-enabled shift type.
    // Monthly-rated hourly rate = base / (working days × 8h standard day);
    // hourly-rated employees already earn their base per hour, so overtime
    // pays only the premium on top ((multiplier − 1) × rate).
    const otHours = await getOvertimeHours(employeeId, month!, year!);
    if (otHours > 0) {
      const schedule = await getPaySchedule();
      const multiplier = Math.max(1, num((schedule as any).overtime_multiplier) || 2);
      const stdDayHours = Math.max(1, num((schedule as any).standard_day_hours) || 8);
      const hourlyRate = hourly
        ? base * (multiplier - 1)
        : (attendance.working_days > 0 ? (base / (attendance.working_days * stdDayHours)) * multiplier : 0);
      const amount = Math.round(otHours * hourlyRate);
      if (amount > 0) {
        extraLines.push({
          component_id: null, name: `Overtime (${otHours}h)`, category: 'earning',
          calculation_type: 'flat', value: amount, earning_type: 'variable',
          consider_epf: 'no', consider_esi: false, pro_rata: false,
        });
      }
    }

    // Review-step corrections: LOP override and/or a manual adjustment line.
    const adjustment = await getAdjustment(employeeId, month!, year!);
    if (adjustment) {
      if (adjustment.lop_override !== null && adjustment.lop_override !== undefined) {
        attendance.lop_days = num(adjustment.lop_override);
        // Re-project the employed-and-paid share onto the denominator, so an
        // override behaves correctly under fixed_days and partial employment.
        const scheduled = num(attendance.scheduled_working_days) || attendance.working_days;
        const paidRatio = scheduled > 0
          ? Math.max(0, scheduled - num(attendance.not_employed_days) - attendance.lop_days) / scheduled
          : 0;
        attendance.payment_days = Math.round(attendance.working_days * paidRatio * 100) / 100;
        attendance.lop_overridden = true;
      }
      const amount = num(adjustment.adjustment_amount);
      if (amount !== 0) {
        extraLines.push({
          component_id: null,
          name: adjustment.adjustment_label || 'Adjustment',
          category: amount > 0 ? 'earning' : 'deduction',
          calculation_type: 'flat',
          value: Math.abs(amount),
          earning_type: 'variable',
          consider_epf: 'no',
          consider_esi: false,
          pro_rata: false,
        });
      }
    }
  }

  // ESI contribution period (Phase 5): reuse the period's persisted coverage
  // decision; on first encounter this month's contracted wage sets it, so a
  // mid-period raise across the ceiling can't drop coverage until the next period.
  //
  // Only a REAL payroll write (opts.persistEsiPeriod) may set the decision — a read-only
  // preview (F&F, leave-encashment rate, staff draft view) must never freeze coverage,
  // since it can run for an arbitrary month and would lock the period from the wrong one.
  let esiCoveredOverride: boolean | null = null;
  let esiPeriodToPersist: string | null = null;
  if (hasPeriod) {
    const periodKey = esiPeriodKey(month!, year!);
    const existing = await db('employee_esi_periods').where({ employee_id: employeeId, period_key: periodKey }).first();
    if (existing) esiCoveredOverride = !!existing.covered;
    else if (opts.persistEsiPeriod) esiPeriodToPersist = periodKey;
  }

  const breakdown = await computeForStructure(structure, base, attendance, extraLines, {
    state,
    month: hasPeriod ? month! : null,
    esiCoveredOverride,
  });

  if (esiPeriodToPersist && breakdown) {
    const ceiling = (await getStatutoryRates(state)).esi.wageCeiling;
    const wage = num((breakdown as any).esi_wage_full);
    const covered = ceiling <= 0 || wage <= ceiling;
    await db('employee_esi_periods')
      .insert({ employee_id: employeeId, period_key: esiPeriodToPersist, covered: covered ? true : false })
      .onConflict(['employee_id', 'period_key']).ignore();
  }

  return breakdown;
}

export async function computeForEmployee(
  employeeId: number, month: number, year: number,
  opts: { persistEsiPeriod?: boolean } = {},
): Promise<ComputedPayslip> {
  assertValidPeriod(month, year);

  const emp = await employeeOrThrow(employeeId);
  const breakdown = await getMonthlyBreakdown(employeeId, month, year, opts);
  if (!breakdown) {
    throw new AppError('Salary not configured for this employee or their designation. Please contact HR.', 422);
  }

  // Pay date honours the Pay Schedule settings (last day vs fixed day of next month).
  const schedule = await getPaySchedule();

  return {
    employee: {
      id: emp.id,
      employee_code: emp.employee_code,
      name: `${emp.first_name} ${emp.last_name}`,
      designation: emp.designation_name || '-',
      department: emp.dept_name || '-',
      branch: emp.branch_name || '-',
    },
    month,
    year,
    monthLabel: `${monthName(month)} ${year}`,
    payDate: payDateFor(month, year, schedule),
    breakdown,
  };
}

/**
 * The rules version the current code produces. A payslip stored under an older version was
 * calculated by rules that no longer exist in this codebase, so it can never be reproduced
 * by recomputing — it is always served from its stored snapshot instead. See migration 002.
 */
// v3: attendance-code pay is now driven by the configurable Attendance Pay Rules table
// (payableDays.service) rather than hardcoded fractions, and an approved regularisation pays the
// day in full. Months paid under v2 keep their stored snapshots and are never recomputed.
export const CALC_VERSION = 3;

/** The stored snapshot for a locked month, or null when the month isn't locked. */
async function lockedSnapshot(employeeId: number, month: number, year: number): Promise<ComputedPayslip | null> {
  const run = await getRun(month, year);
  if (run?.status !== 'locked') return null;
  const row = await db('payslip_history').where({ employee_id: employeeId, month, year }).first();
  return row ? parseSnapshot(row.snapshot) : null;
}

/**
 * The stored snapshot when a payslip must not be recomputed, or null when computing live is
 * correct. Frozen in two cases: an older rules version (unreproducible), or a locked month
 * (immutable by policy). A current-version draft still computes live, so the payroll review
 * screen keeps reflecting the latest attendance.
 */
async function frozenSnapshot(employeeId: number, month: number, year: number): Promise<ComputedPayslip | null> {
  const row = await db('payslip_history').where({ employee_id: employeeId, month, year }).first();
  if (!row) return null;
  if (Number(row.calc_version) < CALC_VERSION) return parseSnapshot(row.snapshot);
  const run = await getRun(month, year);
  return run?.status === 'locked' ? parseSnapshot(row.snapshot) : null;
}

/**
 * Staff view: a frozen month (older rules, or locked) serves the byte-identical stored
 * snapshot; a current draft month computes live so the review reflects the latest inputs.
 */
export async function getPayslipForStaff(employeeId: number, month: number, year: number): Promise<ComputedPayslip> {
  return (await frozenSnapshot(employeeId, month, year)) ?? computeForEmployee(employeeId, month, year);
}

/**
 * Self-service view: an employee only ever sees a LOCKED month, and only the
 * stored snapshot. A draft (or un-run) month is not yet published to them — freezing an old
 * month for reproducibility must not also publish it, so this deliberately keeps using the
 * lock check rather than frozenSnapshot.
 */
export async function getSelfServicePayslip(employeeId: number, month: number, year: number): Promise<ComputedPayslip> {
  assertValidPeriod(month, year);
  const snap = await lockedSnapshot(employeeId, month, year);
  if (!snap) throw new AppError('Your payslip for this month is not published yet.', 404);
  return snap;
}

// ─── Generation + history ───

/**
 * Throws if any payslip in this month was calculated under the previous rules.
 *
 * Deliberately scoped to the month rather than to one employee's row. A month is frozen as a
 * whole: its run totals are an aggregate over every slip in it, so writing a single new slip
 * into a frozen month moves figures for a month that has already been paid — even when that
 * particular employee had no slip of their own to protect.
 */
async function assertMonthNotFrozen(month: number, year: number, consequence: string): Promise<void> {
  const frozen = await db('payslip_history')
    .where({ month, year }).where('calc_version', '<', CALC_VERSION).count('id as c').first();
  if (Number(frozen?.c ?? 0) > 0) {
    throw new AppError(
      `${monthName(month)} ${year} was calculated under the previous rules and is frozen — ${consequence}.`,
      409,
    );
  }
}

/** Upserts a payslip_history row from a computed payslip. Returns the row id. */
async function writePayslipRecord(
  computed: ComputedPayslip, runId: number | null, generatedBy?: number | null,
): Promise<number> {
  // Locked months are immutable — re-check right before the write so a run that
  // started before a concurrent lock cannot overwrite a finalized payslip.
  const lockCheck = await getRun(computed.month, computed.year);
  if (lockCheck?.status === 'locked') {
    throw new AppError('Payroll for this month is locked — payslips are immutable.', 409);
  }

  const b = computed.breakdown;
  const record = {
    employee_id: computed.employee.id,
    month: computed.month,
    year: computed.year,
    pay_date: computed.payDate,
    gross_earnings: b.gross_earnings,
    total_deduction: b.total_deduction,
    net_pay: b.net_pay,
    ctc: b.ctc,
    snapshot: JSON.stringify(computed),
    run_id: runId,
    generated_by: generatedBy ?? null,
    calc_version: CALC_VERSION,
  };

  // A month calculated under the older rules can't be reproduced by today's code. The check
  // is on the MONTH, not on this employee's row: someone skipped by that run (no salary
  // structure at the time) has no row to find, and inserting a fresh one for them would let
  // refreshRunTotals re-aggregate and move the headline figures of a month people were paid.
  await assertMonthNotFrozen(computed.month, computed.year, 'its payslips can\'t be regenerated');

  const existing = await db('payslip_history')
    .where({ employee_id: computed.employee.id, month: computed.month, year: computed.year }).first();
  if (existing) {
    await db('payslip_history').where('id', existing.id).update({ ...record, updated_at: db.fn.now() });
    return existing.id;
  }
  const [{ id }] = await db('payslip_history').insert(record).returning('id');
  return id;
}

export async function generatePayslip(
  employeeId: number, month: number, year: number, generatedBy?: number | null,
) {
  // Once a month's payroll is locked, payslips are immutable — return the stored
  // snapshot rather than recomputing/overwriting.
  const run = await getRun(month, year);
  const stored = await db('payslip_history').where({ employee_id: employeeId, month, year }).first();

  // Frozen either way — a locked month is immutable by policy, and an older-rules month
  // can't be reproduced. Both return what was actually issued rather than recomputing.
  if (stored && Number(stored.calc_version) < CALC_VERSION) {
    return { id: stored.id, ...parseSnapshot(stored.snapshot) };
  }
  if (run?.status === 'locked') {
    if (stored) return { id: stored.id, ...parseSnapshot(stored.snapshot) };
    throw new AppError('Payroll for this month is locked. Please contact HR.', 409);
  }

  const computed = await computeForEmployee(employeeId, month, year, { persistEsiPeriod: true });
  const id = await writePayslipRecord(computed, run?.id ?? null, generatedBy);

  await notifyEmployee(employeeId, {
    type: 'payslip_ready',
    title: 'Payslip ready',
    message: `Your payslip for ${computed.monthLabel} is now available (net ₹${Math.round(computed.breakdown.net_pay).toLocaleString('en-IN')}).`,
    link: '/salary',
  });

  return { id, ...computed };
}

export async function listPayslipHistory(employeeId: number) {
  // Employees only see months whose payroll has been locked (published).
  return db('payslip_history as ph')
    .join('payroll_runs as r', function (this: any) { this.on('r.month', 'ph.month').andOn('r.year', 'ph.year'); })
    .where('ph.employee_id', employeeId)
    .where('r.status', 'locked')
    .select('ph.id', 'ph.month', 'ph.year', 'ph.pay_date', 'ph.gross_earnings',
      'ph.total_deduction', 'ph.net_pay', 'ph.ctc', 'ph.created_at')
    .orderBy([{ column: 'ph.year', order: 'desc' }, { column: 'ph.month', order: 'desc' }]);
}

/** Safely parses a stored payslip snapshot, failing with a clean error if corrupt. */
function parseSnapshot(raw: unknown): ComputedPayslip {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new AppError('Payslip data is unavailable. Please regenerate the payslip.', 500);
  }
  try {
    return JSON.parse(raw) as ComputedPayslip;
  } catch {
    throw new AppError('Payslip data is corrupted and cannot be read. Please regenerate the payslip.', 500);
  }
}

/**
 * Returns the stored snapshot for a history row (for exact re-download).
 * requireLocked (self-service) only serves rows whose month's run is locked.
 */
export async function getPayslipSnapshot(id: number, employeeId?: number, requireLocked = false): Promise<ComputedPayslip & { id: number }> {
  const q = db('payslip_history').where('id', id);
  if (employeeId !== undefined) q.andWhere('employee_id', employeeId);
  const row = await q.first();
  if (!row) throw new NotFoundError('Payslip');
  if (requireLocked) {
    const run = await getRun(row.month, row.year);
    if (run?.status !== 'locked') throw new AppError('Your payslip for this month is not published yet.', 404);
  }
  return { id: row.id, ...parseSnapshot(row.snapshot) };
}

// ─── Payroll runs (bulk generation + lock) ───

/**
 * Minimal active-employee list for payroll staff to pick from when generating an
 * individual salary slip (no PII — just enough to identify the person).
 */
export async function listPayrollEmployees() {
  return db('employees as e')
    .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
    .where('e.is_active', true)
    .select('e.id', 'e.employee_code', 'e.first_name', 'e.last_name', 'jt.title as designation', 'e.branch_name')
    .orderBy(['e.first_name', 'e.last_name']);
}

export async function getRun(month: number, year: number) {
  return db('payroll_runs').where({ month, year }).first();
}

export async function listRuns() {
  return db('payroll_runs as r')
    .leftJoin('users as gb', 'gb.id', 'r.generated_by')
    .leftJoin('users as lb', 'lb.id', 'r.locked_by')
    .select(
      'r.id', 'r.month', 'r.year', 'r.status', 'r.employee_count',
      'r.total_net', 'r.total_ctc', 'r.locked_at', 'r.created_at', 'r.updated_at',
      'gb.email as generated_by_email', 'lb.email as locked_by_email',
    )
    .orderBy([{ column: 'r.year', order: 'desc' }, { column: 'r.month', order: 'desc' }]);
}

/**
 * Generates payslips for every active employee whose salary is configured
 * (a structure assignment, or a designation structure fallback) for the given
 * period. Creates/refreshes a draft payroll run. Employees whose salary can't
 * be resolved are skipped and reported back. Blocked once the run is locked.
 */
export async function runPayroll(month: number, year: number, userId?: number | null) {
  assertValidPeriod(month, year);

  let run = await getRun(month, year);
  if (run?.status === 'locked') {
    throw new AppError('Payroll for this month is already locked.', 409);
  }

  // Refuse up front rather than failing per-employee: a month calculated under the previous
  // rules can't be reproduced, so re-running it would replace what people were actually paid
  // with whatever today's code computes. This holds even if the month was unlocked.
  await assertMonthNotFrozen(month, year, 'it can\'t be re-run');
  if (!run) {
    const [{ id }] = await db('payroll_runs').insert({
      month, year, status: 'draft', generated_by: userId ?? null,
    }).returning('id');
    run = await db('payroll_runs').where('id', id).first();
  }

  const employees = await db('employees')
    .where('is_active', true)
    .select('id', 'employee_code', 'first_name', 'last_name')
    .orderBy('first_name');

  let generated = 0;
  let totalNet = 0;
  let totalCtc = 0;
  const skipped: Array<{ employee_code: string; name: string; reason: string }> = [];
  const failed: Array<{ employee_code: string; name: string; reason: string }> = [];
  for (const emp of employees) {
    const who = { employee_code: emp.employee_code, name: `${emp.first_name} ${emp.last_name}` };
    try {
      // Period-aware compute so hourly-rated employees are included (a period-less
      // pre-check used to throw for them and silently skip every one). This is a real
      // payroll write, so it may freeze the ESI contribution-period coverage.
      const computed = await computeForEmployee(emp.id, month, year, { persistEsiPeriod: true });
      await writePayslipRecord(computed, run.id, userId);
      generated += 1;
      totalNet += computed.breakdown.net_pay;
      totalCtc += computed.breakdown.ctc;
    } catch (err: any) {
      // A month locked mid-run stops the run; anything else is isolated so one bad
      // record cannot 500 the whole batch.
      if (err?.statusCode === 409) throw err;
      const reason = err?.message || 'Could not compute payslip';
      // 422 = salary not configured (an expected skip); everything else is a failure.
      if (err?.statusCode === 422) skipped.push({ ...who, reason });
      else failed.push({ ...who, reason });
    }
  }

  // Drop slips for employees no longer in the active set (departed since a prior run of
  // this month), so they don't linger in the run details, the salary register (the bank
  // hand-off), or the recomputed totals. Only inactive employees are removed — everyone
  // active was just (re)generated above.
  const activeIds = employees.map((e: any) => e.id);
  const purge = db('payslip_history').where({ month, year });
  if (activeIds.length) purge.whereNotIn('employee_id', activeIds);
  await purge.del();

  await db('payroll_runs').where('id', run.id).update({
    employee_count: generated,
    total_net: totalNet,
    total_ctc: totalCtc,
    generated_by: userId ?? run.generated_by ?? null,
    failure_report: failed.length ? JSON.stringify(failed) : null,
    updated_at: db.fn.now(),
  });

  return {
    run_id: run.id,
    month,
    year,
    generated,
    skipped,
    failed,
    total_net: totalNet,
    total_ctc: totalCtc,
  };
}

// ─── Review step: adjustments, details grid, salary register ───

/** Recomputes a run's totals from its stored payslips (after adjustments). */
async function refreshRunTotals(runId: number, month: number, year: number) {
  const agg = await db('payslip_history').where({ month, year })
    .count('id as c').sum({ net: 'net_pay' }).sum({ ctc: 'ctc' }).first();
  await db('payroll_runs').where('id', runId).update({
    employee_count: Number((agg as any)?.c ?? 0),
    total_net: Number((agg as any)?.net ?? 0),
    total_ctc: Number((agg as any)?.ctc ?? 0),
    updated_at: db.fn.now(),
  });
}

/**
 * Saves HR's review-step correction for one employee (LOP override and/or a
 * manual adjustment line, with a note) and regenerates that employee's slip.
 * Blocked once the run is locked.
 */
export async function upsertAdjustment(
  employeeId: number, month: number, year: number,
  data: { lop_override?: number | null; adjustment_amount?: number; adjustment_label?: string; note?: string },
  userId?: number | null,
) {
  assertValidPeriod(month, year);
  await employeeOrThrow(employeeId);
  const run = await getRun(month, year);
  if (run?.status === 'locked') throw new AppError('Payroll for this month is locked.', 409);
  // Check BEFORE writing anything. The regeneration below throws on a frozen month, and the
  // adjustment row is not written in the same transaction — so without this the correction
  // would be recorded against an already-paid month whose figures never moved, leaving the
  // payroll record claiming a correction that was never applied.
  await assertMonthNotFrozen(month, year, 'corrections to it can\'t be applied');

  const lopOverride = data.lop_override === null || data.lop_override === undefined || data.lop_override === ('' as any)
    ? null : Number(data.lop_override);
  if (lopOverride !== null && (!Number.isFinite(lopOverride) || lopOverride < 0 || lopOverride > 31)) {
    throw new ValidationError('LOP override must be between 0 and 31 days');
  }
  const amount = Number(data.adjustment_amount) || 0;
  const note = String(data.note || '').trim();
  if ((lopOverride !== null || amount !== 0) && !note) {
    throw new ValidationError('A note explaining the correction is required');
  }

  const patch = {
    lop_override: lopOverride,
    adjustment_amount: amount,
    adjustment_label: data.adjustment_label ? String(data.adjustment_label).trim() : null,
    note: note || null,
    updated_by: userId ?? null,
    updated_at: db.fn.now(),
  };
  const existing = await getAdjustment(employeeId, month, year);
  if (existing) await db('payroll_adjustments').where('id', existing.id).update(patch);
  else await db('payroll_adjustments').insert({ employee_id: employeeId, month, year, ...patch });

  // Regenerate this employee's slip so the review grid shows the corrected numbers.
  //
  // The regeneration can still be refused — a lock can land between the check above and the
  // write below. If it is, put the adjustment back the way it was: a correction that did not
  // reach the payslip must not survive in the record as though it had.
  let computed;
  try {
    computed = await computeForEmployee(employeeId, month, year, { persistEsiPeriod: !!run });
    if (run) {
      await writePayslipRecord(computed, run.id, userId);
      await refreshRunTotals(run.id, month, year);
    }
  } catch (err) {
    if (existing) {
      await db('payroll_adjustments').where('id', existing.id).update({
        lop_override: existing.lop_override ?? null,
        adjustment_amount: existing.adjustment_amount ?? 0,
        adjustment_label: existing.adjustment_label ?? null,
        note: existing.note ?? null,
        updated_by: existing.updated_by ?? null,
        updated_at: existing.updated_at ?? db.fn.now(),
      });
    } else {
      await db('payroll_adjustments').where({ employee_id: employeeId, month, year }).del();
    }
    throw err;
  }
  return { adjustment: await getAdjustment(employeeId, month, year), breakdown: computed.breakdown };
}

/**
 * The review grid: every generated slip for the period with days/LOP/net plus
 * warnings (unmarked days, LOP overrides, manual adjustments), and the
 * employees that were skipped.
 */
export async function getRunDetails(month: number, year: number) {
  const run = await getRun(month, year);
  const rows = await db('payslip_history as ph')
    .join('employees as e', 'e.id', 'ph.employee_id')
    .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
    .leftJoin('properties as p', 'p.name', 'e.branch_name')
    .where({ 'ph.month': month, 'ph.year': year })
    .select(
      'ph.employee_id', 'ph.gross_earnings', 'ph.total_deduction', 'ph.net_pay', 'ph.ctc', 'ph.snapshot',
      'e.employee_code', 'e.first_name', 'e.last_name', 'e.branch_name', 'jt.title as designation',
      'p.state as work_state',
    )
    .orderBy('e.first_name');

  const adjustments = await db('payroll_adjustments').where({ month, year });
  const adjByEmployee = new Map<number, any>(adjustments.map((a: any) => [a.employee_id, a]));

  // Minimum-wage validation (Phase 1): flag any slip whose full-month Basic is
  // below the configured minimum wage of the employee's work-location state.
  const states = [...new Set(rows.map((r: any) => r.work_state).filter(Boolean))] as string[];
  const minWageByState = new Map<string, number | null>();
  for (const s of states) minWageByState.set(s, await getMinimumWageFor(s));

  const slips = rows.map((r: any) => {
    let days: any = null;
    let basic = 0;
    try {
      const breakdown = JSON.parse(r.snapshot)?.breakdown;
      days = breakdown?.days ?? null;
      basic = num(breakdown?.basic);
    } catch { /* legacy snapshot */ }
    const adj = adjByEmployee.get(r.employee_id);

    // Scale the (possibly LOP-prorated) Basic back to a full month before the check.
    // Skip hourly slips: their Basic derives from rate × hours, not the days ratio,
    // so a working/payment rescale would produce an arbitrary figure.
    const isHourly = days != null && days.hours != null;
    const minWage = r.work_state ? minWageByState.get(r.work_state) ?? null : null;
    let fullBasic: number | null = basic > 0 ? basic : null;
    if (fullBasic !== null && !isHourly && days && num(days.payment_days) > 0 && num(days.working_days) > 0) {
      fullBasic = Math.round(fullBasic * num(days.working_days) / num(days.payment_days));
    }
    const below_min_wage = !isHourly && minWage !== null && fullBasic !== null && fullBasic < minWage;

    return {
      employee_id: r.employee_id,
      employee_code: r.employee_code,
      name: `${r.first_name} ${r.last_name}`,
      designation: r.designation || null,
      branch: r.branch_name || null,
      work_state: r.work_state || null,
      gross_earnings: num(r.gross_earnings),
      total_deduction: num(r.total_deduction),
      net_pay: num(r.net_pay),
      ctc: num(r.ctc),
      days,
      below_min_wage,
      min_wage: below_min_wage ? minWage : undefined,
      adjustment: adj ? {
        lop_override: adj.lop_override === null ? null : num(adj.lop_override),
        adjustment_amount: num(adj.adjustment_amount),
        adjustment_label: adj.adjustment_label,
        note: adj.note,
      } : null,
    };
  });

  const covered = new Set(rows.map((r: any) => r.employee_id));
  const skipped = (await db('employees')
    .where('is_active', true)
    .select('id', 'employee_code', 'first_name', 'last_name'))
    .filter((e: any) => !covered.has(e.id))
    .map((e: any) => ({ employee_id: e.id, employee_code: e.employee_code, name: `${e.first_name} ${e.last_name}` }));

  // Attendance-coverage gate (Phase 3): share of working-day cells with no
  // attendance record, overall and per property. Locking above the gate needs
  // confirmation so a month cannot be paid on a handful of records.
  const gatePct = num((await getPaySchedule() as any).attendance_gate_pct);
  const coverage = computeCoverage(slips, gatePct);

  return { run: run ?? null, slips, skipped, coverage };
}

const pct = (u: number, w: number) => (w > 0 ? Math.round((u / w) * 1000) / 10 : 0);

// Markable working-day cells for an employee this month: every elapsed working
// day the register could carry a mark. This is the true coverage denominator —
// NOT days.working_days, which is the pay denominator (fixed in fixed_days mode,
// and inflated by paid holidays), so dividing by it understates the unmarked share.
function markableCells(c: any): number {
  if (!c) return 0;
  return num(c.present) + num(c.half_day) + num(c.absent) + num(c.miss_punch)
    + num(c.short_punch) + num(c.paid_leave) + num(c.unpaid_leave) + num(c.unmarked);
}

function computeCoverage(slips: any[], gatePct: number) {
  const byProp = new Map<string, { working: number; unmarked: number }>();
  let totWorking = 0;
  let totUnmarked = 0;
  for (const s of slips) {
    const wd = markableCells(s.days?.counts);
    const um = num(s.days?.counts?.unmarked);
    totWorking += wd;
    totUnmarked += um;
    const key = s.branch || 'Unassigned';
    const cur = byProp.get(key) || { working: 0, unmarked: 0 };
    cur.working += wd;
    cur.unmarked += um;
    byProp.set(key, cur);
  }
  const unmarkedPct = pct(totUnmarked, totWorking);
  return {
    working_days: totWorking,
    unmarked_days: totUnmarked,
    unmarked_pct: unmarkedPct,
    gate_pct: gatePct,
    over_gate: unmarkedPct > gatePct,
    by_property: [...byProp.entries()]
      .map(([branch, v]) => ({ branch, working_days: v.working, unmarked_days: v.unmarked, unmarked_pct: pct(v.unmarked, v.working) }))
      .sort((a, b) => b.unmarked_pct - a.unmarked_pct),
  };
}

/**
 * Salary register for the bank hand-off: one CSV row per generated slip with
 * days, net pay, and bank account details where available.
 */
export async function getSalaryRegister(month: number, year: number): Promise<string> {
  // A locked month serves the register snapshotted at lock, so the hand-off file
  // is reproducible even after structures or rates change.
  const lockedRun = await getRun(month, year);
  if (lockedRun?.status === 'locked' && lockedRun.register_snapshot) return lockedRun.register_snapshot;

  const { slips } = await getRunDetails(month, year);
  const bank = await db('employee_bank_details').select(
    'employee_id', 'account_name', 'bank_account_number', 'ifsc_code', 'payment_mode',
  );
  const bankByEmployee = new Map<number, any>(bank.map((b: any) => [b.employee_id, b]));

  const header = [
    'Employee Code', 'Name', 'Designation', 'Branch',
    'Working Days', 'LOP Days', 'Payment Days',
    'Gross Earnings', 'Total Deductions', 'Net Pay',
    'Account Name', 'Bank Account Number', 'IFSC', 'Payment Mode',
  ];
  const lines = [header.join(',')];
  for (const s of slips) {
    const b = bankByEmployee.get(s.employee_id);
    lines.push([
      s.employee_code, s.name, s.designation ?? '', s.branch ?? '',
      s.days?.working_days ?? '', s.days?.lop_days ?? '', s.days?.payment_days ?? '',
      Math.round(s.gross_earnings), Math.round(s.total_deduction), Math.round(s.net_pay),
      b?.account_name ?? '', b?.bank_account_number ?? '', b?.ifsc_code ?? '', b?.payment_mode ?? '',
    ].map(csvCell).join(','));
  }
  return lines.join('\n');
}

export async function lockRun(month: number, year: number, userId?: number | null, confirm = false) {
  assertValidPeriod(month, year);
  const run = await getRun(month, year);
  if (!run) throw new AppError('No payroll run to lock. Run payroll for this month first.', 400);
  if (run.status === 'locked') return run;

  const countRow = await db('payslip_history').where({ month, year }).count('id as c').first();
  if (!Number(countRow?.c ?? 0)) {
    throw new AppError('No payslips generated for this month yet.', 400);
  }

  // Attendance-coverage gate: block the lock (unless explicitly confirmed) when
  // too many working-day cells are unmarked — the run would pay on thin data.
  const { coverage } = await getRunDetails(month, year);
  if (coverage.over_gate && !confirm) {
    throw new AppError(
      `Attendance is only ${(100 - coverage.unmarked_pct).toFixed(1)}% complete — ${coverage.unmarked_pct}% of working days are unmarked (gate: ${coverage.gate_pct}%). Review coverage, then confirm to lock anyway.`,
      409,
    );
  }

  // Snapshot the salary register onto the run while it's still draft (computed
  // live), so the locked month's hand-off file survives later input changes.
  const register = await getSalaryRegister(month, year);

  await db('payroll_runs').where('id', run.id).update({
    status: 'locked',
    locked_by: userId ?? null,
    locked_at: db.fn.now(),
    register_snapshot: register,
    updated_at: db.fn.now(),
  });
  return getRun(month, year);
}

export async function unlockRun(month: number, year: number, userId?: number | null, reason?: string) {
  if (!reason || !reason.trim()) throw new AppError('An unlock reason is required.', 400);
  const run = await getRun(month, year);
  if (!run) throw new NotFoundError('Payroll run');
  // Only a locked run can be unlocked — otherwise a still-draft run gets bogus unlock
  // provenance for a lock that never happened.
  if (run.status !== 'locked') throw new AppError('This payroll run is not locked.', 400);
  // Preserve lock provenance (locked_by / locked_at) — record who unlocked and why.
  await db('payroll_runs').where('id', run.id).update({
    status: 'draft',
    unlocked_by: userId ?? null,
    unlocked_at: db.fn.now(),
    unlock_reason: reason.trim(),
    updated_at: db.fn.now(),
  });
  return getRun(month, year);
}
