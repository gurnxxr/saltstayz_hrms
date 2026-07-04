import db from '../config/database';
import { AppError, NotFoundError, ValidationError } from '../utils/errors';
import { payDateFor, monthName, type PayslipBreakdown } from './payslip.calc';
import {
  getAssignment, getStructureByJobTitle, getStructureRow, computeForStructure,
} from './salaryStructure.service';
import { getPaySchedule } from './paySchedule.service';
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
export async function getMonthlyBreakdown(employeeId: number): Promise<PayslipBreakdown | null> {
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

  if (structure.payment_basis === 'hourly') {
    throw new AppError('This employee is on an hourly-rated structure — hourly payroll arrives with the payable-days engine (Phase 3).', 422);
  }

  return computeForStructure(structure, base);
}

export async function computeForEmployee(
  employeeId: number, month: number, year: number,
): Promise<ComputedPayslip> {
  assertValidPeriod(month, year);

  const emp = await employeeOrThrow(employeeId);
  const breakdown = await getMonthlyBreakdown(employeeId);
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
