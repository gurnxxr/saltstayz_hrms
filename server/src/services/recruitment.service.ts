import type { Knex } from 'knex';
import db from '../config/database';
import { NotFoundError, ValidationError } from '../utils/errors';
import { getCtcRange } from './salaryStructure.service';
import { getVacancySanctionContext } from './manpower.service';
import { nextJobId } from '../utils/jobId';

// Recruitment funnel stages (Hired removed — "Offered" promotes to onboarding,
// "Rejected" archives the application).
export const CANDIDATE_STAGES = ['screening', 'interview', 'shortlisted', 'offered', 'rejected'] as const;

// The funnel is a strict forward sequence. "rejected" is the off-ramp, not a step.
// A candidate may only advance one stage at a time (or be rejected). "offered" and
// "rejected" are terminal — no moves out.
export const FUNNEL_ORDER = ['screening', 'interview', 'shortlisted', 'offered'] as const;

/**
 * Valid stages a candidate at `from` may move to: the next funnel stage and
 * `rejected`. Returns [] for terminal stages (offered/rejected).
 */
export function allowedNextStages(from: string): string[] {
  if (from === 'offered' || from === 'rejected') return [];
  const i = FUNNEL_ORDER.indexOf(from as any);
  const next: string[] = [];
  if (i !== -1 && i + 1 < FUNNEL_ORDER.length) next.push(FUNNEL_ORDER[i + 1]);
  next.push('rejected');
  return next;
}

// ─── Vacancies ───

export async function listVacancies(filters: {
  status?: string;
  property_id?: number;
  department_id?: number;
  search?: string;
}) {
  const query = db('vacancies')
    .join('job_titles', 'job_titles.id', 'vacancies.job_title_id')
    .join('departments', 'departments.id', 'vacancies.department_id')
    .join('properties', 'properties.id', 'vacancies.property_id')
    .select(
      'vacancies.*',
      'job_titles.title as job_title',
      'departments.name as department_name',
      'properties.name as property_name',
      db.raw('(select count(*) from candidates where candidates.vacancy_id = vacancies.id) as candidate_count')
    )
    .orderBy('vacancies.created_at', 'desc');

  if (filters.status) query.where('vacancies.status', filters.status);
  if (filters.property_id) query.where('vacancies.property_id', filters.property_id);
  if (filters.department_id) query.where('vacancies.department_id', filters.department_id);
  if (filters.search) {
    query.where(function () {
      this.where('job_titles.title', 'like', `%${filters.search}%`)
        .orWhere('vacancies.description', 'like', `%${filters.search}%`);
    });
  }

  return query;
}

export async function getVacancy(id: number) {
  const vacancy = await db('vacancies')
    .join('job_titles', 'job_titles.id', 'vacancies.job_title_id')
    .join('departments', 'departments.id', 'vacancies.department_id')
    .join('properties', 'properties.id', 'vacancies.property_id')
    .leftJoin('employees as mgr', 'mgr.id', 'vacancies.reporting_manager_id')
    .where('vacancies.id', id)
    .select(
      'vacancies.*',
      'job_titles.title as job_title',
      'departments.name as department_name',
      'properties.name as property_name',
      db.raw("NULLIF(TRIM(COALESCE(mgr.first_name,'') || ' ' || COALESCE(mgr.last_name,'')), '') as reporting_manager_name")
    )
    .first();

  if (!vacancy) throw new NotFoundError('Vacancy');
  if (vacancy.jd_data && typeof vacancy.jd_data === 'string') {
    try { vacancy.jd_data = JSON.parse(vacancy.jd_data); } catch { vacancy.jd_data = null; }
  }
  // Live CTC range from the designation's salary structure (single source of truth).
  vacancy.ctc = await getCtcRange(vacancy.job_title_id);
  return vacancy;
}

/**
 * All job titles, each flagged with whether its salary structure is configured and
 * its advertised CTC range. Drives the new-vacancy form: unconfigured designations
 * can't be posted until Admin sets up their salary structure.
 */
export async function listPostableJobTitles() {
  const titles = await db('job_titles').select('id', 'title').orderBy('title');
  return Promise.all(
    titles.map(async (t: any) => {
      const range = await getCtcRange(t.id);
      return {
        id: t.id,
        title: t.title,
        configured: range.configured,
        ctc_label: range.label,
        monthly_ctc: range.monthly_ctc,
      };
    })
  );
}

export async function updateVacancyJd(id: number, jdData: any) {
  await db('vacancies').where('id', id).update({
    jd_data: JSON.stringify(jdData ?? {}),
    updated_at: db.fn.now(),
  });
  return getVacancy(id);
}

export async function createVacancy(data: {
  job_title_id: number;
  department_id: number;
  property_id: number;
  positions: number;
  description?: string;
  reporting_manager_id: number;
  posted_by: number;
  backfill_job_id?: string;
}) {
  // A vacancy can only be posted once its designation has a salary structure —
  // the CTC range on the JD is derived from it.
  const range = await getCtcRange(data.job_title_id);
  if (!range.configured) {
    throw new ValidationError('This designation has no salary structure. Set it up in Admin → Salary Structure before posting a vacancy.');
  }
  if (!data.reporting_manager_id) {
    throw new ValidationError('Reporting manager is required.');
  }

  // Manpower & Budget Control checks: can't post beyond sanctioned headcount, and
  // the role's CTC can't exceed the sanctioned salary band for this property.
  const ctx = await getVacancySanctionContext(data.property_id, data.job_title_id);
  const positions = Number(data.positions) || 1;
  const inr = (n: number) => Math.round(n).toLocaleString('en-IN');
  if (ctx.property_configured && ctx.capacity_remaining < positions) {
    throw new ValidationError(
      `Sanctioned headcount reached for ${ctx.property_name}: ${ctx.filled_headcount} filled` +
      `${ctx.open_vacancy_demand > 0 ? ` + ${ctx.open_vacancy_demand} in open vacancies` : ''} of ${ctx.sanctioned_headcount} sanctioned. ` +
      `${ctx.capacity_remaining <= 0 ? 'No positions remain' : `Only ${ctx.capacity_remaining} position(s) can be posted`} — cannot post ${positions}. Raise the headcount in Admin → Budget Control.`
    );
  }
  if (ctx.band_configured && range.monthly_ctc > ctx.band_max) {
    throw new ValidationError(
      `The role's CTC (₹${inr(range.monthly_ctc)}/month) exceeds the sanctioned salary band maximum (₹${inr(ctx.band_max)}/month) for this property. ` +
      `Lower the salary structure or raise the band in Admin → Budget Control.`
    );
  }

  const [id] = await db('vacancies').insert(data);
  return getVacancy(id);
}

export async function updateVacancy(id: number, data: Partial<{
  job_title_id: number;
  department_id: number;
  property_id: number;
  positions: number;
  description: string;
  status: string;
}>) {
  await db('vacancies').where('id', id).update({ ...data, updated_at: db.fn.now() });
  return getVacancy(id);
}

export async function deleteVacancy(id: number) {
  const vacancy = await db('vacancies').where('id', id).first();
  if (!vacancy) throw new NotFoundError('Vacancy');
  // candidates (and their history) cascade-delete via the FK. Employees already
  // promoted from offered candidates are unaffected.
  await db('vacancies').where('id', id).del();
  return { message: 'Vacancy deleted' };
}

export async function getVacancyStats() {
  const stats = await db('vacancies')
    .select(
      db.raw("count(*) as total"),
      db.raw("sum(case when status = 'open' then 1 else 0 end) as open_count"),
      db.raw("sum(case when status = 'closed' then 1 else 0 end) as closed_count"),
      db.raw("sum(case when status = 'on_hold' then 1 else 0 end) as on_hold_count"),
      db.raw("sum(positions) as total_positions"),
      db.raw("sum(filled) as total_filled")
    )
    .first();

  return stats;
}

// ─── Candidates ───

export async function listCandidates(filters: {
  vacancy_id?: number;
  stage?: string;
  search?: string;
  archived?: string; // 'true' = only archived, 'all' = no filter, else active only
}) {
  const query = db('candidates')
    .join('vacancies', 'vacancies.id', 'candidates.vacancy_id')
    .join('job_titles', 'job_titles.id', 'vacancies.job_title_id')
    .select(
      'candidates.*',
      'job_titles.title as job_title',
      'vacancies.status as vacancy_status'
    )
    .orderBy('candidates.created_at', 'desc');

  if (filters.archived === 'true') {
    query.where('candidates.archived', true);
  } else if (filters.archived !== 'all') {
    query.where(function () {
      this.where('candidates.archived', false).orWhereNull('candidates.archived');
    });
  }

  if (filters.vacancy_id) query.where('candidates.vacancy_id', filters.vacancy_id);
  if (filters.stage) query.where('candidates.stage', filters.stage);
  if (filters.search) {
    query.where(function () {
      this.where('candidates.name', 'like', `%${filters.search}%`)
        .orWhere('candidates.email', 'like', `%${filters.search}%`)
        .orWhere('candidates.phone', 'like', `%${filters.search}%`);
    });
  }

  return query;
}

export async function getCandidate(id: number) {
  const candidate = await db('candidates')
    .join('vacancies', 'vacancies.id', 'candidates.vacancy_id')
    .join('job_titles', 'job_titles.id', 'vacancies.job_title_id')
    .join('departments', 'departments.id', 'vacancies.department_id')
    .join('properties', 'properties.id', 'vacancies.property_id')
    .where('candidates.id', id)
    .select(
      'candidates.*',
      'job_titles.title as job_title',
      'departments.name as department_name',
      'properties.name as property_name',
      'vacancies.status as vacancy_status',
      'vacancies.positions',
      'vacancies.filled'
    )
    .first();

  if (!candidate) throw new NotFoundError('Candidate');
  return candidate;
}

export async function createCandidate(data: {
  vacancy_id: number;
  name: string;
  email?: string;
  phone?: string;
  resume_url?: string;
  notes?: string;
  added_by: number;
}) {
  const [id] = await db('candidates').insert(data);
  return getCandidate(id);
}

export async function updateCandidate(id: number, data: Partial<{
  name: string;
  email: string;
  phone: string;
  notes: string;
  resume_url: string;
}>) {
  await db('candidates').where('id', id).update({ ...data, updated_at: db.fn.now() });
  return getCandidate(id);
}

/**
 * Creates an employees row from a candidate, resolving job title / dept / branch
 * from the candidate's vacancy. Used by the onboarding accept path (the employee
 * is created only when an offer is accepted). Returns the new employee id.
 * Accepts an optional Knex transaction. Does NOT fill the vacancy or seed a
 * checklist — the caller orchestrates those within its own transaction.
 */
export async function createEmployeeFromCandidate(
  candidate: any,
  joiningDate?: string,
  trx?: Knex.Transaction
): Promise<number> {
  const cx = trx || db;
  const vacancy = await cx('vacancies as v')
    .join('job_titles as jt', 'jt.id', 'v.job_title_id')
    .join('departments as d', 'd.id', 'v.department_id')
    .join('properties as p', 'p.id', 'v.property_id')
    .where('v.id', candidate.vacancy_id)
    .select('v.*', 'jt.title as job_title', 'd.name as department_name', 'p.name as property_name')
    .first();
  if (!vacancy) throw new NotFoundError('Vacancy');

  const parts = String(candidate.name || '').trim().split(/\s+/);
  const firstName = parts[0] || candidate.name || 'New';
  const lastName = parts.slice(1).join(' ') || '';

  // Unique, readable employee code for the new hire
  const employeeCode = `NH-${String(candidate.id).padStart(4, '0')}`;

  const [employeeId] = await cx('employees').insert({
    employee_code: employeeCode,
    job_id: await nextJobId(cx),
    first_name: firstName,
    last_name: lastName,
    email: candidate.email || null,
    phone: candidate.phone || null,
    job_title_id: vacancy.job_title_id,
    dept_name: vacancy.department_name,
    branch_name: vacancy.property_name,
    reporting_manager_id: vacancy.reporting_manager_id || null,
    date_of_joining: joiningDate || new Date().toISOString().split('T')[0],
    is_active: true,
  });

  return employeeId;
}

export async function moveCandidateStage(
  id: number,
  toStage: string,
  userId: number,
  notes?: string
) {
  if (!CANDIDATE_STAGES.includes(toStage as any)) {
    throw new ValidationError(`Invalid stage: ${toStage}`);
  }

  const candidate = await db('candidates').where('id', id).first();
  if (!candidate) throw new NotFoundError('Candidate');

  const fromStage = candidate.stage;

  // Enforce the strict forward funnel: one step at a time, no skipping, no going
  // back. "rejected" is allowed from any active stage; offered/rejected are final.
  if (fromStage === 'offered' || fromStage === 'rejected') {
    throw new ValidationError("This candidate's stage is final and cannot be changed.");
  }
  if (toStage === fromStage) {
    throw new ValidationError('Candidate is already at this stage.');
  }
  if (!allowedNextStages(fromStage).includes(toStage)) {
    throw new ValidationError(
      `Cannot move from "${fromStage}" to "${toStage}". Stages must advance one step at a time (or be rejected).`
    );
  }

  await db('candidates')
    .where('id', id)
    .update({ stage: toStage, updated_at: db.fn.now() });

  await db('candidate_history').insert({
    candidate_id: id,
    from_stage: fromStage,
    to_stage: toStage,
    notes: notes || null,
    changed_by: userId,
  });

  // Offered → hand to Onboarding for offer-letter generation. The employee
  // record is created only when HR marks the offer accepted (no employee yet).
  if (toStage === 'offered' && !candidate.employee_id && !candidate.offer_status) {
    await db('candidates').where('id', id).update({ offer_status: 'pending' });
  }

  // Rejected → archive the application out of the active funnel
  if (toStage === 'rejected') {
    await db('candidates').where('id', id).update({ archived: true });
  }

  return getCandidate(id);
}

export async function getCandidateHistory(candidateId: number) {
  return db('candidate_history')
    .join('users', 'users.id', 'candidate_history.changed_by')
    .where('candidate_history.candidate_id', candidateId)
    .select(
      'candidate_history.*',
      'users.email as changed_by_email'
    )
    .orderBy('candidate_history.created_at', 'desc');
}

export async function getCandidatesByStage(vacancyId?: number) {
  const query = db('candidates')
    .where(function () {
      this.where('archived', false).orWhereNull('archived');
    })
    .select('stage')
    .count('* as count')
    .groupBy('stage');

  if (vacancyId) query.where('vacancy_id', vacancyId);

  return query;
}
