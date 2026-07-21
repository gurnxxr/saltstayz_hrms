import db from '../config/database';
import { NotFoundError, ValidationError } from '../utils/errors';
import { getAssignment, upsertAssignment, seedEmployeeStructureFromTemplate } from './salaryStructure.service';
import { ASSET_CATEGORIES, markAssetsReturned } from './asset.service';
import { notifyEmployee } from './notification.service';

// ─────────────────────────────────────────────────────────────────────────────
// Employee Lifecycle: Promotion / Transfer / Exit Interview.
// Promotions and transfers APPLY immediately (this module's users are the
// approvers) and keep auditable from/to history rows.
// ─────────────────────────────────────────────────────────────────────────────

const num = (v: any) => (v === null || v === undefined || v === '' ? 0 : Number(v));

async function activeEmployeeOrThrow(employeeId: number) {
  const emp = await db('employees').where('id', employeeId).first();
  if (!emp) throw new NotFoundError('Employee');
  if (!emp.is_active) throw new ValidationError('Employee is not active');
  return emp;
}

// ─── Reference data (self-contained so hr_manager can use the module) ───

export async function getOptions() {
  const [properties, departments, jobTitles] = await Promise.all([
    db('properties').select('id', 'name').orderBy('name'),
    db('departments').select('id', 'name').orderBy('name'),
    db('job_titles').select('id', 'title').orderBy('title'),
  ]);
  return { properties, departments, job_titles: jobTitles, asset_categories: ASSET_CATEGORIES };
}

export async function listEmployees() {
  return db('employees as e')
    .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
    .where('e.is_active', true)
    .select(
      'e.id', 'e.employee_code', 'e.first_name', 'e.last_name',
      'e.branch_name', 'e.dept_name', 'e.job_title_id', 'jt.title as designation',
    )
    .orderBy('e.first_name');
}

// ─── Promotion ───

export async function listPromotions() {
  return db('employee_promotions as p')
    .join('employees as e', 'e.id', 'p.employee_id')
    .leftJoin('job_titles as fj', 'fj.id', 'p.from_job_title_id')
    .leftJoin('job_titles as tj', 'tj.id', 'p.to_job_title_id')
    .leftJoin('users as u', 'u.id', 'p.created_by')
    .select(
      'p.*',
      'e.employee_code', 'e.first_name', 'e.last_name', 'e.branch_name',
      'fj.title as from_designation', 'tj.title as to_designation',
      'u.email as created_by_email',
    )
    .orderBy('p.created_at', 'desc');
}

/**
 * Promotes an employee: changes the designation and (optionally) revises the
 * salary — new base, switching to the target designation's structure when one
 * exists. Applied immediately inside a transaction; the record keeps from/to
 * snapshots. The existing TDS is passed through so it isn't wiped.
 */
export async function createPromotion(
  data: { employee_id: number; promotion_date: string; to_job_title_id: number; new_base?: number; note?: string },
  userId?: number | null,
) {
  const emp = await activeEmployeeOrThrow(Number(data.employee_id));
  const toJobTitle = await db('job_titles').where('id', Number(data.to_job_title_id)).first();
  if (!toJobTitle) throw new NotFoundError('Designation');
  if (emp.job_title_id === toJobTitle.id) throw new ValidationError('Employee already holds this designation');
  if (!data.promotion_date) throw new ValidationError('Promotion date is required');

  const newBase = num(data.new_base);
  if (data.new_base !== undefined && data.new_base !== null && (data.new_base as any) !== '' && newBase <= 0) {
    throw new ValidationError('New base must be a positive amount');
  }

  const assignment = await getAssignment(emp.id);
  const fromBase = assignment ? num(assignment.base) : null;

  const id = await db.transaction(async (trx) => {
    await trx('employees').where('id', emp.id).update({ job_title_id: toJobTitle.id, updated_at: trx.fn.now() });
    const [{ id: newId }] = await trx('employee_promotions').insert({
      employee_id: emp.id,
      promotion_date: data.promotion_date,
      from_job_title_id: emp.job_title_id ?? null,
      to_job_title_id: toJobTitle.id,
      from_base: fromBase,
      to_base: newBase > 0 ? newBase : null,
      note: data.note ? String(data.note).trim() : null,
      created_by: userId ?? null,
    }).returning('id');
    return newId;
  });

  // Salary revision: keep the employee's own component structure, change only the
  // base (TDS preserved). If they have no config yet, seed one from the new
  // designation's template at the new base.
  if (newBase > 0) {
    if (assignment?.structure_id) {
      await upsertAssignment(emp.id, {
        structure_id: assignment.structure_id,
        base: newBase,
        effective_from: data.promotion_date,
        tds_amount: num(assignment.tds_amount), // preserve TDS
      }, userId ?? null);
    } else {
      await seedEmployeeStructureFromTemplate(emp.id, { base: newBase }, userId ?? null);
    }
  }

  // Congratulate the promoted employee in their in-app inbox. Fire-and-forget:
  // it never throws, and runs after the promotion is committed, so it can't
  // affect the promotion. No-ops quietly if they have no active user account.
  await notifyEmployee(emp.id, {
    type: 'promotion',
    title: 'Congratulations on your promotion!',
    message: `You've been promoted to ${toJobTitle.title}, effective ${data.promotion_date}. Congratulations on the new role!`,
    link: '/profile',
  });

  const rows = await listPromotions();
  return rows.find((r: any) => r.id === id);
}

// ─── Transfer ───

export async function listTransfers() {
  return db('employee_transfers as t')
    .join('employees as e', 'e.id', 't.employee_id')
    .leftJoin('users as u', 'u.id', 't.created_by')
    .select(
      't.*',
      'e.employee_code', 'e.first_name', 'e.last_name',
      'u.email as created_by_email',
    )
    .orderBy('t.created_at', 'desc');
}

/**
 * Transfers an employee to another property and/or department (at least one).
 * branch_name intentionally drives manpower budgets and holiday regions, so a
 * transfer takes effect everywhere immediately.
 */
export async function createTransfer(
  data: { employee_id: number; transfer_date: string; to_branch?: string; to_dept?: string; note?: string },
  userId?: number | null,
) {
  const emp = await activeEmployeeOrThrow(Number(data.employee_id));
  if (!data.transfer_date) throw new ValidationError('Transfer date is required');

  const toBranch = data.to_branch ? String(data.to_branch).trim() : '';
  const toDept = data.to_dept ? String(data.to_dept).trim() : '';
  if (!toBranch && !toDept) throw new ValidationError('Choose a new property and/or department');
  if (toBranch && toBranch === emp.branch_name && !toDept) {
    throw new ValidationError('Employee is already at this property');
  }
  if (toDept && toDept === emp.dept_name && !toBranch) {
    throw new ValidationError('Employee is already in this department');
  }
  if (toBranch) {
    const property = await db('properties').where('name', toBranch).first();
    if (!property) throw new NotFoundError('Property');
  }
  if (toDept) {
    const dept = await db('departments').where('name', toDept).first();
    if (!dept) throw new NotFoundError('Department');
  }

  const id = await db.transaction(async (trx) => {
    const patch: any = { updated_at: trx.fn.now() };
    if (toBranch) patch.branch_name = toBranch;
    if (toDept) patch.dept_name = toDept;
    await trx('employees').where('id', emp.id).update(patch);
    const [{ id: newId }] = await trx('employee_transfers').insert({
      employee_id: emp.id,
      transfer_date: data.transfer_date,
      from_branch: emp.branch_name ?? null,
      to_branch: toBranch || null,
      from_dept: emp.dept_name ?? null,
      to_dept: toDept || null,
      note: data.note ? String(data.note).trim() : null,
      created_by: userId ?? null,
    }).returning('id');
    return newId;
  });

  const rows = await listTransfers();
  return rows.find((r: any) => r.id === id);
}

// ─── Exit Interview ───

export const EXIT_REASONS = [
  'Better Opportunity', 'Compensation', 'Relocation', 'Personal',
  'Work Environment', 'Higher Studies', 'Other',
];

export async function listExitInterviews(filters: { status?: string } = {}) {
  const query = db('exit_interviews as x')
    .join('employees as e', 'e.id', 'x.employee_id')
    .leftJoin('users as iu', 'iu.id', 'x.interviewer_id')
    .select(
      'x.*',
      'e.employee_code', 'e.first_name', 'e.last_name', 'e.branch_name',
      'iu.email as interviewer_email',
      db.raw(`(select count(*) from asset_assignments aa
               where aa.employee_id = x.employee_id and aa.status = 'assigned') as outstanding_assets`),
    )
    .orderBy('x.interview_date', 'desc');
  if (filters.status) query.where('x.status', filters.status);
  return query;
}

export async function scheduleExitInterview(
  data: { employee_id: number; interview_date: string; reason_for_leaving?: string },
  userId?: number | null,
) {
  const emp = await db('employees').where('id', Number(data.employee_id)).first();
  if (!emp) throw new NotFoundError('Employee');
  if (!data.interview_date) throw new ValidationError('Interview date is required');

  const [{ id }] = await db('exit_interviews').insert({
    employee_id: emp.id,
    interview_date: data.interview_date,
    status: 'scheduled',
    reason_for_leaving: data.reason_for_leaving ? String(data.reason_for_leaving).trim() : null,
    interviewer_id: userId ?? null,
    created_by: userId ?? null,
  }).returning('id');
  const rows = await listExitInterviews();
  return rows.find((r: any) => r.id === id);
}

export async function completeExitInterview(
  id: number,
  data: {
    reason_for_leaving?: string; overall_rating?: number; would_recommend?: boolean;
    feedback?: string; suggestions?: string; returned_asset_ids?: number[];
  },
  userId?: number | null,
) {
  const interview = await db('exit_interviews').where('id', id).first();
  if (!interview) throw new NotFoundError('Exit interview');
  if (interview.status === 'completed') throw new ValidationError('This interview is already completed');

  const rating = data.overall_rating === undefined || data.overall_rating === null ? null : Number(data.overall_rating);
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    throw new ValidationError('Overall rating must be between 1 and 5');
  }

  await db('exit_interviews').where('id', id).update({
    status: 'completed',
    reason_for_leaving: data.reason_for_leaving ? String(data.reason_for_leaving).trim() : interview.reason_for_leaving,
    overall_rating: rating,
    would_recommend: data.would_recommend === undefined ? null : (data.would_recommend ? true : false),
    feedback: data.feedback ? String(data.feedback).trim() : null,
    suggestions: data.suggestions ? String(data.suggestions).trim() : null,
    interviewer_id: userId ?? interview.interviewer_id,
    updated_at: db.fn.now(),
  });

  // Collect back the company assets the interviewer ticked off, tying each
  // return to this exit event. Guarded to this employee's still-held items.
  if (Array.isArray(data.returned_asset_ids) && data.returned_asset_ids.length) {
    await markAssetsReturned(
      data.returned_asset_ids,
      interview.employee_id,
      { exit_interview_id: id, returned_date: interview.interview_date },
      userId ?? null,
    );
  }

  const rows = await listExitInterviews();
  return rows.find((r: any) => r.id === id);
}
