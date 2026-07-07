import db from '../config/database';
import { AppError, NotFoundError, ValidationError } from '../utils/errors';
import {
  payDateFor, monthName,
  type PayslipBreakdown, type AttendanceContext, type StructureLineInput,
} from './payslip.calc';
import {
  getAssignment, getStructureByJobTitle, getStructureRow, computeForStructure,
} from './salaryStructure.service';
import { getEmployeeState, getMinimumWageFor } from './statutory.service';
import { getPaySchedule } from './paySchedule.service';
import { computePayableDays, getMonthlyHours, getOvertimeHours } from './payableDays.service';
import { notifyEmployee } from './notification.service';

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
export async function getMonthlyBreakdown(
  employeeId: number, month?: number, year?: number,
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
      lop_days: days.lop_days,
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
      const hourlyRate = hourly
        ? base * (multiplier - 1)
        : (attendance.working_days > 0 ? (base / (attendance.working_days * 8)) * multiplier : 0);
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
        attendance.payment_days = Math.max(0, attendance.working_days - attendance.lop_days);
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

  return computeForStructure(structure, base, attendance, extraLines, {
    state,
    month: hasPeriod ? month! : null,
  });
}

export async function computeForEmployee(
  employeeId: number, month: number, year: number,
): Promise<ComputedPayslip> {
  assertValidPeriod(month, year);

  const emp = await employeeOrThrow(employeeId);
  const breakdown = await getMonthlyBreakdown(employeeId, month, year);
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

// ─── Generation + history ───

/** Upserts a payslip_history row from a computed payslip. Returns the row id. */
async function writePayslipRecord(
  computed: ComputedPayslip, runId: number | null, generatedBy?: number | null,
): Promise<number> {
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
  };

  const existing = await db('payslip_history')
    .where({ employee_id: computed.employee.id, month: computed.month, year: computed.year }).first();
  if (existing) {
    await db('payslip_history').where('id', existing.id).update({ ...record, updated_at: db.fn.now() });
    return existing.id;
  }
  const [id] = await db('payslip_history').insert(record);
  return id;
}

export async function generatePayslip(
  employeeId: number, month: number, year: number, generatedBy?: number | null,
) {
  // Once a month's payroll is locked, payslips are immutable — return the stored
  // snapshot rather than recomputing/overwriting.
  const run = await getRun(month, year);
  if (run?.status === 'locked') {
    const existing = await db('payslip_history')
      .where({ employee_id: employeeId, month, year }).first();
    if (existing) return { id: existing.id, ...parseSnapshot(existing.snapshot) };
    throw new AppError('Payroll for this month is locked. Please contact HR.', 409);
  }

  const computed = await computeForEmployee(employeeId, month, year);
  const id = await writePayslipRecord(computed, run?.id ?? null, generatedBy);

  await notifyEmployee(employeeId, {
    type: 'payslip_ready',
    title: 'Payslip ready',
    message: `Your payslip for ${computed.monthLabel} is now available (net ₹${Math.round(computed.breakdown.net_pay).toLocaleString('en-IN')}).`,
    link: '/payroll',
  });

  return { id, ...computed };
}

export async function listPayslipHistory(employeeId: number) {
  return db('payslip_history')
    .where('employee_id', employeeId)
    .select('id', 'month', 'year', 'pay_date', 'gross_earnings',
      'total_deduction', 'net_pay', 'ctc', 'created_at')
    .orderBy([{ column: 'year', order: 'desc' }, { column: 'month', order: 'desc' }]);
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

/** Returns the stored snapshot for a history row (for exact re-download). */
export async function getPayslipSnapshot(id: number, employeeId?: number): Promise<ComputedPayslip & { id: number }> {
  const q = db('payslip_history').where('id', id);
  if (employeeId !== undefined) q.andWhere('employee_id', employeeId);
  const row = await q.first();
  if (!row) throw new NotFoundError('Payslip');
  return { id: row.id, ...parseSnapshot(row.snapshot) };
}

// ─── Payroll runs (bulk generation + lock) ───

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
  if (!run) {
    const [id] = await db('payroll_runs').insert({
      month, year, status: 'draft', generated_by: userId ?? null,
    });
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
  for (const emp of employees) {
    let breakdown: PayslipBreakdown | null = null;
    let reason = 'No salary structure assigned';
    try {
      breakdown = await getMonthlyBreakdown(emp.id);
    } catch (err: any) {
      reason = err?.message || reason;
    }
    if (!breakdown) {
      skipped.push({ employee_code: emp.employee_code, name: `${emp.first_name} ${emp.last_name}`, reason });
      continue;
    }
    const computed = await computeForEmployee(emp.id, month, year);
    await writePayslipRecord(computed, run.id, userId);
    generated += 1;
    totalNet += computed.breakdown.net_pay;
    totalCtc += computed.breakdown.ctc;
  }

  await db('payroll_runs').where('id', run.id).update({
    employee_count: generated,
    total_net: totalNet,
    total_ctc: totalCtc,
    generated_by: userId ?? run.generated_by ?? null,
    updated_at: db.fn.now(),
  });

  return {
    run_id: run.id,
    month,
    year,
    generated,
    skipped,
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
  const computed = await computeForEmployee(employeeId, month, year);
  if (run) {
    await writePayslipRecord(computed, run.id, userId);
    await refreshRunTotals(run.id, month, year);
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
    const minWage = r.work_state ? minWageByState.get(r.work_state) ?? null : null;
    let fullBasic: number | null = basic > 0 ? basic : null;
    if (fullBasic !== null && days && num(days.payment_days) > 0 && num(days.working_days) > 0) {
      fullBasic = Math.round(fullBasic * num(days.working_days) / num(days.payment_days));
    }
    const below_min_wage = minWage !== null && fullBasic !== null && fullBasic < minWage;

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

  return { run: run ?? null, slips, skipped };
}

const csvCell = (v: any) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Salary register for the bank hand-off: one CSV row per generated slip with
 * days, net pay, and bank account details where available.
 */
export async function getSalaryRegister(month: number, year: number): Promise<string> {
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

export async function lockRun(month: number, year: number, userId?: number | null) {
  assertValidPeriod(month, year);
  const run = await getRun(month, year);
  if (!run) throw new AppError('No payroll run to lock. Run payroll for this month first.', 400);
  if (run.status === 'locked') return run;

  const countRow = await db('payslip_history').where({ month, year }).count('id as c').first();
  if (!Number(countRow?.c ?? 0)) {
    throw new AppError('No payslips generated for this month yet.', 400);
  }

  await db('payroll_runs').where('id', run.id).update({
    status: 'locked',
    locked_by: userId ?? null,
    locked_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return getRun(month, year);
}

export async function unlockRun(month: number, year: number) {
  const run = await getRun(month, year);
  if (!run) throw new NotFoundError('Payroll run');
  await db('payroll_runs').where('id', run.id).update({
    status: 'draft',
    locked_by: null,
    locked_at: null,
    updated_at: db.fn.now(),
  });
  return getRun(month, year);
}
