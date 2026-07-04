import db from '../config/database';
import { AppError, NotFoundError, ValidationError } from '../utils/errors';
import {
  computePayslip, payDateFor, monthName,
  type PayslipBreakdown, type SalaryInputs,
} from './payslip.calc';
import { getStructureRow, structureToInputs } from './salaryStructure.service';
import { getStatutoryRates } from './statutory.service';
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

// ─── Salary setup (inputs) ───

export async function getSalarySetup(employeeId: number) {
  return db('salary_setup').where('employee_id', employeeId).first();
}

export async function listSalarySetups() {
  return db('employees as e')
    .leftJoin('salary_setup as s', 's.employee_id', 'e.id')
    .leftJoin('job_titles as j', 'j.id', 'e.job_title_id')
    .where('e.is_active', true)
    .select(
      'e.id as employee_id', 'e.employee_code', 'e.first_name', 'e.last_name',
      'e.dept_name', 'e.branch_name', 'j.title as designation_name',
      's.gross', 's.city', 's.pli', 's.meal', 's.accommodation',
      's.accommodation_allowance', 's.lwf_employee', 's.lwf_employer',
    )
    .orderBy('e.first_name');
}

export async function upsertSalarySetup(employeeId: number, data: any) {
  await employeeOrThrow(employeeId);

  const allowed = [
    'gross', 'city', 'pli', 'meal', 'accommodation',
    'accommodation_allowance', 'lwf_employee', 'lwf_employer', 'effective_from',
  ];
  const payload: any = {};
  for (const key of allowed) {
    if (data[key] !== undefined && data[key] !== '') payload[key] = data[key];
  }
  if (payload.gross === undefined) {
    const existing = await db('salary_setup').where('employee_id', employeeId).first();
    if (!existing) throw new ValidationError('Gross salary is required');
  }

  const existing = await db('salary_setup').where('employee_id', employeeId).first();
  if (existing) {
    await db('salary_setup').where('employee_id', employeeId)
      .update({ ...payload, updated_at: db.fn.now() });
  } else {
    await db('salary_setup').insert({ employee_id: employeeId, ...payload });
  }
  return getSalarySetup(employeeId);
}

// ─── Computation ───

function inputsFromSetup(setup: any): SalaryInputs {
  return {
    gross: num(setup.gross),
    city: setup.city,
    pli: num(setup.pli),
    meal: num(setup.meal),
    accommodation: num(setup.accommodation),
    accommodation_allowance: num(setup.accommodation_allowance),
    lwf_employee: setup.lwf_employee === null || setup.lwf_employee === undefined ? null : num(setup.lwf_employee),
    lwf_employer: setup.lwf_employer === null || setup.lwf_employer === undefined ? null : num(setup.lwf_employer),
  };
}

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
  const emp = await db('employees').where('id', employeeId).select('job_title_id').first();
  const setup = await getSalarySetup(employeeId);
  const designationStructure = emp?.job_title_id ? await getStructureRow(emp.job_title_id) : null;

  if (!setup && !designationStructure) return null;

  // Per-employee salary setup overrides amounts; the designation structure provides
  // the configured composition (and is the full source for new hires with no setup).
  let inputs: SalaryInputs;
  if (setup) {
    inputs = inputsFromSetup(setup);
    if (designationStructure) inputs.pct = structureToInputs(designationStructure).pct;
  } else {
    inputs = structureToInputs(designationStructure);
  }

  // Statutory rates (EPF/ESI/LWF) come from the editable Statutory Components
  // settings, resolved for the employee's city/state — never hardcoded.
  const rates = await getStatutoryRates(inputs.city);
  return computePayslip(inputs, rates);
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
 * Generates payslips for every active employee with a salary setup for the given
 * period. Creates/refreshes a draft payroll run. Employees without a salary setup
 * are skipped and reported back. Blocked once the run is locked.
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

  const setups = await db('salary_setup as s')
    .join('employees as e', 'e.id', 's.employee_id')
    .where('e.is_active', true)
    .pluck('s.employee_id');

  const skipped = await db('employees as e')
    .leftJoin('salary_setup as s', 's.employee_id', 'e.id')
    .where('e.is_active', true)
    .whereNull('s.id')
    .select('e.employee_code', 'e.first_name', 'e.last_name');

  let generated = 0;
  let totalNet = 0;
  let totalCtc = 0;
  for (const employeeId of setups) {
    const computed = await computeForEmployee(employeeId, month, year);
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
    skipped: skipped.map((s: any) => ({
      employee_code: s.employee_code,
      name: `${s.first_name} ${s.last_name}`,
    })),
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
