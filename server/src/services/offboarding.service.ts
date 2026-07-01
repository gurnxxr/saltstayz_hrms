import db from '../config/database';
import { NotFoundError, ValidationError, AppError } from '../utils/errors';
import { getMonthlyBreakdown } from './payslip.service';
import { notifyEmployee } from './notification.service';

// Default clearance checklist, grouped by the team responsible for sign-off.
const DEFAULT_CLEARANCE: { category: string; item: string }[] = [
  { category: 'Manager', item: 'Knowledge transfer / handover completed' },
  { category: 'Manager', item: 'Pending tasks reassigned' },
  { category: 'IT', item: 'Laptop / IT assets returned' },
  { category: 'IT', item: 'Email & system accounts to be revoked' },
  { category: 'IT', item: 'VPN / software licenses reclaimed' },
  { category: 'Admin', item: 'Access card / keys returned' },
  { category: 'Admin', item: 'Uniform / company property returned' },
  { category: 'Finance', item: 'Travel / expense advances settled' },
  { category: 'Finance', item: 'Loans / salary advances cleared' },
  { category: 'HR', item: 'Exit interview conducted' },
  { category: 'HR', item: 'Experience & relieving letter prepared' },
  { category: 'HR', item: 'Full & Final settlement approved' },
];

const EXIT_TYPES = ['resignation', 'termination', 'retirement', 'end_of_contract', 'absconding'];

function diffMonths(from?: string | null, to?: string | null): number | null {
  if (!from) return null;
  const a = new Date(from);
  const b = to ? new Date(to) : new Date();
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24 * 30.44)));
}

function daysInMonth(dateStr: string): number {
  const d = new Date(dateStr);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

// ─── List / stats ───

export async function listCases(filters: { status?: string; search?: string }) {
  const q = db('offboarding_cases as oc')
    .join('employees as e', 'e.id', 'oc.employee_id')
    .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
    .select(
      'oc.*',
      'e.first_name', 'e.last_name', 'e.employee_code', 'e.dept_name', 'e.branch_name',
      'jt.title as designation',
    )
    .orderBy('oc.created_at', 'desc');

  if (filters.status) q.where('oc.status', filters.status);
  if (filters.search) {
    q.where((b) => b.where('e.first_name', 'like', `%${filters.search}%`)
      .orWhere('e.last_name', 'like', `%${filters.search}%`)
      .orWhere('e.employee_code', 'like', `%${filters.search}%`));
  }

  const cases = await q;
  for (const c of cases) {
    const items = await db('offboarding_items').where('case_id', c.id);
    c.total_items = items.length;
    c.completed_items = items.filter((i: any) => i.is_completed).length;
  }
  return cases;
}

export async function getStats() {
  const rows = await db('offboarding_cases').select('status').count('id as c').groupBy('status');
  const by = (s: string) => Number(rows.find((r: any) => r.status === s)?.c ?? 0);
  return {
    initiated: by('initiated'),
    in_progress: by('in_progress'),
    cleared: by('cleared'),
    completed: by('completed'),
    active: by('initiated') + by('in_progress') + by('cleared'),
  };
}

// ─── Get one (with items + suggested FnF) ───

export async function getCase(id: number) {
  const c = await db('offboarding_cases as oc')
    .join('employees as e', 'e.id', 'oc.employee_id')
    .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
    .where('oc.id', id)
    .select(
      'oc.*',
      'e.first_name', 'e.last_name', 'e.employee_code', 'e.email', 'e.dept_name',
      'e.branch_name', 'e.date_of_joining', 'e.is_active',
      'jt.title as designation',
    )
    .first();
  if (!c) throw new NotFoundError('Offboarding case');

  c.items = await db('offboarding_items as oi')
    .leftJoin('users as u', 'u.id', 'oi.verified_by')
    .where('oi.case_id', id)
    .select('oi.*', 'u.email as verified_by_email')
    .orderBy('oi.id');

  c.fnf_details = c.fnf_details ? safeParse(c.fnf_details) : null;
  // If not yet saved, attach a computed suggestion so the UI can prefill.
  c.fnf_suggested = await computeFnF(c.employee_id, c.last_working_day, c.date_of_joining, c.notice_period_days);
  return c;
}

function safeParse(s: string) { try { return JSON.parse(s); } catch { return null; } }

// ─── Full & Final settlement ───

export async function computeFnF(
  employeeId: number, lastWorkingDay: string, dateOfJoining?: string | null, noticePeriodDays = 0,
) {
  const breakdown = await getMonthlyBreakdown(employeeId);
  if (!breakdown) return null;

  const lwd = new Date(lastWorkingDay);
  const dim = daysInMonth(lastWorkingDay);
  const daysWorked = lwd.getDate(); // days into the final month
  const perDayNet = breakdown.net_pay / dim;
  const proratedSalary = Math.round(perDayNet * daysWorked);

  // Leave encashment — remaining balance × (basic / 30). Best-effort from entitlements.
  const leaveBalance = await remainingLeaveBalance(employeeId);
  const perDayBasic = breakdown.basic / 30;
  const leaveEncashment = Math.round(leaveBalance * perDayBasic);

  // Gratuity — payable after 5 years: (15/26) × last basic × completed years.
  const tenureMonths = diffMonths(dateOfJoining, lastWorkingDay) ?? 0;
  const years = Math.floor(tenureMonths / 12);
  const gratuity = years >= 5 ? Math.round((15 / 26) * breakdown.basic * years) : 0;

  const earnings = proratedSalary + leaveEncashment + gratuity;
  const deductions = 0; // notice shortfall / advances entered by HR
  const net_payable = earnings - deductions;

  return {
    days_worked: daysWorked,
    days_in_month: dim,
    leave_balance_days: leaveBalance,
    prorated_salary: proratedSalary,
    leave_encashment: leaveEncashment,
    gratuity,
    gratuity_eligible: years >= 5,
    tenure_months: tenureMonths,
    deductions,
    earnings,
    net_payable,
  };
}

async function remainingLeaveBalance(employeeId: number): Promise<number> {
  try {
    const row = await db('leave_entitlements')
      .where('employee_id', employeeId)
      .sum({ total: 'total_days' })
      .sum({ used: 'used_days' })
      .first();
    const bal = Number((row as any)?.total ?? 0) - Number((row as any)?.used ?? 0);
    return Math.max(0, bal);
  } catch {
    return 0;
  }
}

// ─── Create / update ───

export async function createCase(data: any, userId: number) {
  const employeeId = Number(data.employee_id);
  const emp = await db('employees').where('id', employeeId).first();
  if (!emp) throw new NotFoundError('Employee');
  if (!emp.is_active) throw new ValidationError('Employee is already inactive');

  const existing = await db('offboarding_cases').where('employee_id', employeeId).first();
  if (existing) throw new ValidationError('An offboarding case already exists for this employee');

  if (!data.last_working_day) throw new ValidationError('Last working day is required');
  const exitType = EXIT_TYPES.includes(data.exit_type) ? data.exit_type : 'resignation';

  const [id] = await db('offboarding_cases').insert({
    employee_id: employeeId,
    status: 'initiated',
    exit_type: exitType,
    reason: data.reason || null,
    resignation_date: data.resignation_date || null,
    last_working_day: data.last_working_day,
    notice_period_days: data.notice_period_days ? Number(data.notice_period_days) : 0,
    initiated_by: userId,
  });

  await db('offboarding_items').insert(
    DEFAULT_CLEARANCE.map((c) => ({ case_id: id, category: c.category, item_name: c.item })),
  );

  await notifyEmployee(employeeId, {
    type: 'offboarding_initiated',
    title: 'Offboarding initiated',
    message: `Your exit process has been initiated. Last working day: ${data.last_working_day}.`,
    link: '/profile',
  });

  return getCase(id);
}

export async function updateCase(id: number, data: any) {
  const c = await db('offboarding_cases').where('id', id).first();
  if (!c) throw new NotFoundError('Offboarding case');
  if (c.status === 'completed') throw new ValidationError('Completed cases cannot be edited');

  const patch: any = {};
  for (const k of ['exit_type', 'reason', 'resignation_date', 'last_working_day', 'notice_period_days', 'exit_interview_notes']) {
    if (data[k] !== undefined) patch[k] = data[k];
  }
  if (Object.keys(patch).length) {
    patch.updated_at = db.fn.now();
    await db('offboarding_cases').where('id', id).update(patch);
  }
  return getCase(id);
}

export async function saveFnF(id: number, details: any) {
  const c = await db('offboarding_cases').where('id', id).first();
  if (!c) throw new NotFoundError('Offboarding case');
  if (c.status === 'completed') throw new ValidationError('Completed cases cannot be edited');

  const net = Number(details?.net_payable ?? 0);
  await db('offboarding_cases').where('id', id).update({
    fnf_amount: net,
    fnf_details: JSON.stringify(details),
    updated_at: db.fn.now(),
  });
  return getCase(id);
}

// ─── Clearance items ───

export async function toggleItem(itemId: number, userId: number) {
  const item = await db('offboarding_items').where('id', itemId).first();
  if (!item) throw new NotFoundError('Clearance item');

  const next = !item.is_completed;
  await db('offboarding_items').where('id', itemId).update({
    is_completed: next,
    completed_at: next ? db.fn.now() : null,
    verified_by: next ? userId : null,
    updated_at: db.fn.now(),
  });

  await refreshStatus(item.case_id);
  return db('offboarding_items').where('id', itemId).first();
}

export async function addItem(caseId: number, category: string, itemName: string) {
  const c = await db('offboarding_cases').where('id', caseId).first();
  if (!c) throw new NotFoundError('Offboarding case');
  const [id] = await db('offboarding_items').insert({ case_id: caseId, category: category || 'General', item_name: itemName });
  await refreshStatus(caseId);
  return db('offboarding_items').where('id', id).first();
}

export async function deleteItem(itemId: number) {
  const item = await db('offboarding_items').where('id', itemId).first();
  if (!item) throw new NotFoundError('Clearance item');
  await db('offboarding_items').where('id', itemId).delete();
  await refreshStatus(item.case_id);
}

// Keeps case status in step with clearance progress (unless already completed).
async function refreshStatus(caseId: number) {
  const c = await db('offboarding_cases').where('id', caseId).first();
  if (!c || c.status === 'completed') return;
  const items = await db('offboarding_items').where('case_id', caseId);
  const done = items.filter((i: any) => i.is_completed).length;
  const status = items.length && done === items.length ? 'cleared' : done > 0 ? 'in_progress' : 'initiated';
  if (status !== c.status) await db('offboarding_cases').where('id', caseId).update({ status, updated_at: db.fn.now() });
}

// ─── Complete: deactivate employee + revoke login + record exit ───

export async function completeCase(id: number) {
  const c = await db('offboarding_cases').where('id', id).first();
  if (!c) throw new NotFoundError('Offboarding case');
  if (c.status === 'completed') throw new ValidationError('This exit is already completed');

  const items = await db('offboarding_items').where('case_id', id);
  const pending = items.filter((i: any) => !i.is_completed);
  if (pending.length) {
    throw new AppError(`Cannot complete: ${pending.length} clearance item(s) still pending.`, 422);
  }

  const emp = await db('employees').where('id', c.employee_id).first();
  if (!emp) throw new NotFoundError('Employee');

  const tenureMonths = diffMonths(emp.date_of_joining, c.last_working_day) ?? 0;

  await db.transaction(async (trx) => {
    // 1. Deactivate the employee record
    await trx('employees').where('id', c.employee_id).update({ is_active: false, updated_at: trx.fn.now() });

    // 2. Revoke login — deactivate any user account linked to this employee
    await trx('users').where('employee_id', c.employee_id).update({ is_active: false, updated_at: trx.fn.now() });

    // 3. Record the exit for attrition analytics (idempotent on employee_id)
    const existingExit = await trx('employee_exits').where('employee_id', c.employee_id).first();
    const exitRow = {
      exit_date: c.last_working_day,
      exit_reason: c.exit_type,
      exit_details: c.reason || null,
      tenure_months: tenureMonths,
    };
    if (existingExit) await trx('employee_exits').where('employee_id', c.employee_id).update(exitRow);
    else await trx('employee_exits').insert({ employee_id: c.employee_id, ...exitRow });

    // 4. Close the case
    await trx('offboarding_cases').where('id', id).update({
      status: 'completed', completed_at: trx.fn.now(), updated_at: trx.fn.now(),
    });
  });

  return getCase(id);
}
