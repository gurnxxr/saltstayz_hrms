import type { Knex } from 'knex';
import db from '../config/database';
import { NotFoundError, ValidationError } from '../utils/errors';
import { resolveTemplateForDepartment, assertHasWeeklyOff } from './leaveTemplate.service';
import {
  getCtcRange, getStructureByJobTitle, seedEmployeeStructureFromTemplate,
  editorLines, previewStructure, saveEmployeeStructure, getMonthlyCtcMap,
} from './salaryStructure.service';
import { listSalaryComponents } from './salaryComponent.service';
import { assertCtcMeetsMinimumWage } from './statutory.service';
import { getVacancySanctionContext, getRoleBand, assertHireAllowed, createCandidateException, consumeCandidateApproval, computeAvailability } from './manpower.service';
import * as checklist from './checklist.service';
import { emit } from './notification.service';
import { nextJobId } from '../utils/jobId';
import { parseCsv } from '../utils/csv';
import { advisoryXactLock, LOCK } from '../utils/locks';

// ─── The eleven-step hiring process ───
//
// Steps 1-2 are states of a VACANCY; steps 3-11 are states of a CANDIDATE. They are
// the state of a record, not eleven destinations. The server is authoritative: the
// client mirrors FUNNEL_ORDER / allowedNextStages, it does not decide.

/** Step 1 (new_role) and step 2 (listed). A vacancy is "live" in either. */
export const VACANCY_STATUSES = ['new_role', 'listed', 'closed'] as const;
export const LIVE_VACANCY_STATUSES = ['new_role', 'listed'];

/** Steps 3-11, in order. */
export const FUNNEL_ORDER = [
  'applied',              // 3  Shortlisting
  'interview',            // 4  Interview
  'selected',             // 5  Selection
  'document_collection',  // 6  Document Collection   [checklist]
  'offer_released',       // 7  Offer Release
  'offer_accepted',       // 8  Offer Acceptance
  'pre_joining',          // 9  Pre-joining Formalities [checklist]
  'joining',              // 10 Joining Day             [checklist]
  'transferred',          // 11 Transfer to Manager
] as const;

/** Off-ramps. `rejected` before an offer, `offer_declined` at acceptance, `no_show` at 9/10. */
export const OFF_RAMPS = ['rejected', 'offer_declined', 'no_show'] as const;
export const CANDIDATE_STAGES = [...FUNNEL_ORDER, ...OFF_RAMPS] as const;
export type CandidateStage = typeof CANDIDATE_STAGES[number];

export const STAGE_LABELS: Record<string, string> = {
  applied: 'Shortlisting', interview: 'Interview', selected: 'Selection',
  document_collection: 'Document Collection', offer_released: 'Offer Release',
  offer_accepted: 'Offer Acceptance', pre_joining: 'Pre-joining Formalities',
  joining: 'Joining Day', transferred: 'Transfer to Manager',
  rejected: 'Rejected', offer_declined: 'Offer Declined', no_show: 'No Show',
};

/** A stage whose checklist must be complete before the candidate may leave it. */
export const STAGE_CHECKLIST: Record<string, 'document_collection' | 'pre_joining' | 'joining_day'> = {
  document_collection: 'document_collection',
  pre_joining: 'pre_joining',
  joining: 'joining_day',
};

const TERMINAL: string[] = ['transferred', ...OFF_RAMPS];

/**
 * Stages a candidate at `from` may move to: the next funnel step, plus whichever
 * off-ramp is legal there. Terminal stages return []. Unchanged in spirit from the
 * old four-stage funnel — one step forward at a time, never backwards.
 *
 * `rejected` is only an off-ramp BEFORE an offer exists; once the offer is out the
 * candidate declines it, and once they have accepted they can only fail to show up.
 */
export function allowedNextStages(from: string): string[] {
  if (TERMINAL.includes(from)) return [];
  const i = FUNNEL_ORDER.indexOf(from as any);
  if (i === -1) return [];
  const next: string[] = [];
  if (i + 1 < FUNNEL_ORDER.length) next.push(FUNNEL_ORDER[i + 1]);
  if (i < FUNNEL_ORDER.indexOf('offer_released')) next.push('rejected');
  else if (from === 'offer_released') next.push('offer_declined');
  else if (from === 'pre_joining' || from === 'joining') next.push('no_show');
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
      this.where('job_titles.title', 'ilike', `%${filters.search}%`)
        .orWhere('vacancies.description', 'ilike', `%${filters.search}%`);
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
  const titles = await db('job_titles').select('id', 'title', 'department_id').orderBy('title');
  return Promise.all(
    titles.map(async (t: any) => {
      const range = await getCtcRange(t.id);
      return {
        id: t.id,
        title: t.title,
        department_id: t.department_id ?? null,
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

  // The chosen job title must belong to the chosen department (or be unassigned). Stops illogical
  // postings like Security + Housekeeping Attendant; the form filters titles to match.
  const jt = await db('job_titles').where('id', data.job_title_id).select('title', 'department_id').first();
  if (jt?.department_id != null && Number(jt.department_id) !== Number(data.department_id)) {
    throw new ValidationError(`"${jt.title}" isn't in the selected department. Choose a job title from that department, or reassign it in Admin → Organization → Job Titles.`);
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

  // A new vacancy starts at step 1 of the funnel ('new_role'). The DB column default is the
  // legacy 'open', which matches no status filter tab (new_role/listed/closed), so set it here.
  const [{ id }] = await db('vacancies').insert({ ...data, status: 'new_role' }).returning('id');
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
      db.raw("sum(case when status in ('new_role','listed') then 1 else 0 end) as open_count"),
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
      this.where('candidates.name', 'ilike', `%${filters.search}%`)
        .orWhere('candidates.email', 'ilike', `%${filters.search}%`)
        .orWhere('candidates.phone', 'ilike', `%${filters.search}%`);
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

// ─── Adding applicants ───
//
// Two entry points — one applicant at a time, and a CSV import. They share the guards
// below so the two can never disagree about what a valid applicant is.

/** Applicants may only be added to a vacancy that exists and is still live. */
async function assertVacancyAcceptsApplicants(vacancyId: number) {
  const vacancy = await db('vacancies').where('id', vacancyId).first();
  if (!vacancy) throw new ValidationError('Select a vacancy to add applicants to');
  if (vacancy.status === 'closed') throw new ValidationError('This vacancy is closed — reopen it before adding applicants');
  return vacancy;
}

/**
 * A repeat applicant on THIS vacancy, matched on email when we have one and phone otherwise.
 * The same person may legitimately apply to a different vacancy, so the check is always
 * scoped to one. Returns the existing row, or undefined when this is a new applicant.
 */
function findDuplicateApplicant(
  cx: Knex | Knex.Transaction, vacancyId: number, email: string | null, phone: string | null,
) {
  if (!email && !phone) return Promise.resolve(undefined);
  return cx('candidates').where('vacancy_id', vacancyId).where((q) => {
    if (email) q.whereRaw('lower(email) = ?', [email.toLowerCase()]);
    else q.where('phone', phone);
  }).first();
}

const trimmed = (v: unknown) => String(v ?? '').trim() || null;

/** Add one applicant, entering the funnel at Shortlisting. */
export async function createCandidate(input: {
  vacancy_id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  resume_url?: string | null;
  notes?: string | null;
  added_by: number;
}) {
  const vacancyId = Number(input.vacancy_id);
  if (!Number.isInteger(vacancyId) || vacancyId <= 0) throw new ValidationError('Select a vacancy to add applicants to');
  await assertVacancyAcceptsApplicants(vacancyId);

  const name = trimmed(input.name);
  if (!name) throw new ValidationError('Applicant name is required');
  const email = trimmed(input.email);
  const phone = trimmed(input.phone);

  const id = await db.transaction(async (trx) => {
    // Check-then-insert: Postgres is MVCC, so without this lock two simultaneous adds of
    // the same person would both pass the duplicate check. Keyed on the vacancy, so adding
    // to different vacancies never blocks.
    await advisoryXactLock(trx, LOCK.CANDIDATE_APPLY, vacancyId);

    const existing = await findDuplicateApplicant(trx, vacancyId, email, phone);
    if (existing) throw new ValidationError(`${email || phone} has already applied to this vacancy`);

    // Explicit columns, never a spread of the caller's object: this is reached straight
    // from req.body, and a spread would let anyone set archived / employee_id / offer_*,
    // or crash with a raw driver error on an unknown column.
    const [row] = await trx('candidates').insert({
      vacancy_id: vacancyId,
      name,
      email,
      phone,
      address: trimmed(input.address),
      resume_url: trimmed(input.resume_url),
      notes: trimmed(input.notes),
      // The column default is still the retired 'screening'. Set the entry stage
      // explicitly: a candidate parked in a dead stage has no allowedNextStages and can
      // never move.
      stage: FUNNEL_ORDER[0],
      added_by: input.added_by,
    }).returning('id');
    return row.id as number;
  });

  return getCandidate(id);
}

// ─── Bulk applicant upload (CSV → Shortlisting) ───

// CSV header cell → canonical field. Applicants come in as Name / Phone Number /
// Address / Resume Link / Email Address; accept common spellings of each.
const CANDIDATE_HEADER_ALIASES: Record<string, string> = {
  name: 'name', candidate_name: 'name', full_name: 'name', applicant_name: 'name',
  phone: 'phone', phone_number: 'phone', mobile: 'phone', contact: 'phone', contact_number: 'phone', mobile_number: 'phone',
  address: 'address', location: 'address',
  email: 'email', email_address: 'email', email_id: 'email', mail: 'email',
  resume_url: 'resume_url', resume: 'resume_url', resume_link: 'resume_url', cv: 'resume_url', cv_link: 'resume_url', resume_url_link: 'resume_url',
};

/**
 * Import a CSV list of applicants against one vacancy. Every valid row lands as a
 * candidate at FUNNEL_ORDER[0] ('applied' = Shortlisting), exactly like a manually
 * added applicant. Re-uploading the same list is safe: a repeat applicant on the same
 * vacancy — matched on email or phone — is skipped rather than duplicated.
 */
export async function bulkUploadCandidates(vacancyId: number, csvContent: string, addedBy: number) {
  await assertVacancyAcceptsApplicants(vacancyId);

  const rows = parseCsv(csvContent);
  if (rows.length < 2) throw new ValidationError('CSV must have a header row and at least one applicant row');

  const header = rows[0].map((h) => {
    const key = h.toLowerCase().replace(/\s+/g, '_');
    return CANDIDATE_HEADER_ALIASES[key] || key;
  });
  if (!header.includes('name')) throw new ValidationError('CSV must have a "Name" column');

  const results = { total: 0, created: 0, skipped: 0, errors: [] as string[] };
  const seen = new Set<string>(); // in-file dedupe so one file can't list the same person twice

  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    results.total++;
    const rowNo = r + 1; // 1-based; the header is row 1

    // A row whose column count doesn't match the header is malformed (e.g. an
    // unbalanced quote merged fields) — report it rather than store garbage.
    if (cols.length !== header.length) {
      results.skipped++;
      results.errors.push(`Row ${rowNo}: expected ${header.length} columns, found ${cols.length}`);
      continue;
    }

    // First non-empty value wins when two header columns map to the same field
    // (e.g. "Phone" + "Mobile"), so a trailing blank column can't erase real data.
    const row: Record<string, string> = {};
    header.forEach((h, idx) => { if (!row[h]) row[h] = cols[idx] ?? ''; });

    const name = row.name?.trim();
    if (!name) { results.skipped++; results.errors.push(`Row ${rowNo}: missing name`); continue; }

    const emailRaw = row.email?.trim() || null;
    const phone = row.phone?.trim() || null;
    // De-dupe a repeat applicant on THIS vacancy, matched on email or phone (whichever
    // the row carries), against both earlier rows in the file and rows already in the DB.
    // The same person may legitimately apply to a different vacancy, so it's per-vacancy.
    const dupKey = emailRaw ? `e:${emailRaw.toLowerCase()}` : phone ? `p:${phone}` : null;
    if (dupKey) {
      if (seen.has(dupKey)) { results.skipped++; results.errors.push(`Row ${rowNo}: duplicate of an earlier row in this file`); continue; }
      const existing = await findDuplicateApplicant(db, vacancyId, emailRaw, phone);
      if (existing) { results.skipped++; results.errors.push(`Row ${rowNo}: ${emailRaw || phone} already applied to this vacancy`); continue; }
      seen.add(dupKey);
    }

    try {
      await db('candidates').insert({
        vacancy_id: vacancyId,
        name,
        email: emailRaw,
        phone,
        address: row.address?.trim() || null,
        resume_url: row.resume_url?.trim() || null,
        stage: FUNNEL_ORDER[0], // 'applied' → Shortlisting
        added_by: addedBy,
      });
      results.created++;
    } catch {
      // Generic message only — never surface a raw driver/DB error to the client.
      results.skipped++;
      results.errors.push(`Row ${rowNo}: could not be saved`);
    }
  }

  return results;
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

  // Created at Offer Acceptance but NOT yet a working employee: pre_joining holds the
  // sanctioned headcount slot (manpower segments on employment_status) while is_active
  // = false keeps them out of payroll, attendance, leave and analytics. Transfer to
  // Manager (step 11) is what activates them. monthly_ctc stays null until then, so a
  // hire in flight can never trip the budget guardrail against a real hire.
  const [{ id: employeeId }] = await cx('employees').insert({
    employee_code: employeeCode,
    job_id: await nextJobId(cx),
    // Their department's leave plan if one governs it, else Default.
    leave_template_id: await resolveTemplateForDepartment(vacancy.department_name),

    first_name: firstName,
    last_name: lastName,
    email: candidate.email || null,
    phone: candidate.phone || null,
    job_title_id: vacancy.job_title_id,
    dept_name: vacancy.department_name,
    branch_name: vacancy.property_name,
    reporting_manager_id: vacancy.reporting_manager_id || null,
    date_of_joining: joiningDate || new Date().toISOString().split('T')[0],
    employment_status: 'pre_joining',
    is_active: false,
  }).returning('id');

  return employeeId;
}

/**
 * Is this move legal? Pure — no writes. Split out of `transition` so the actions with
 * side effects (releaseOffer prices a salary, acceptOffer mints an employee) can check
 * the gate BEFORE doing that work, and report the actionable error. Without this,
 * releasing an offer on an unfinished checklist complains about the salary band.
 */
async function assertGate(candidate: any, toStage: string, trx?: Knex.Transaction) {
  const fromStage = candidate.stage;

  if (!CANDIDATE_STAGES.includes(toStage as any)) throw new ValidationError(`Invalid stage: ${toStage}`);
  if (candidate.on_hold) throw new ValidationError('This candidate is on hold — resume them before changing stage.');
  if (TERMINAL.includes(fromStage)) throw new ValidationError("This candidate's stage is final and cannot be changed.");
  if (toStage === fromStage) throw new ValidationError('Candidate is already at this stage.');
  if (!allowedNextStages(fromStage).includes(toStage)) {
    throw new ValidationError(
      `Cannot move from "${STAGE_LABELS[fromStage] || fromStage}" to "${STAGE_LABELS[toStage] || toStage}". ` +
      'Stages advance one step at a time.',
    );
  }

  // Completing a phase's checklist is what unlocks the next stage. Enforced here, in
  // the service — the UI only mirrors it. Leaving via an off-ramp is always allowed:
  // a no-show doesn't have to finish their joining-day paperwork first.
  const gate = STAGE_CHECKLIST[fromStage];
  if (gate && !OFF_RAMPS.includes(toStage as any)) {
    const done = await checklist.isComplete(gate, { candidate_id: candidate.id }, trx);
    if (!done) {
      throw new ValidationError(
        `The ${STAGE_LABELS[fromStage]} checklist must be completed before moving to ${STAGE_LABELS[toStage]}.`,
      );
    }
  }
}

/** The gate + the audit row. Every stage change in the module goes through here. */
async function transition(
  candidate: any, toStage: string, userId: number, notes: string | undefined, trx?: Knex.Transaction,
) {
  const cx = trx || db;
  const fromStage = candidate.stage;
  await assertGate(candidate, toStage, trx);

  await cx('candidates').where('id', candidate.id).update({ stage: toStage, updated_at: cx.fn.now() });
  await cx('candidate_history').insert({
    candidate_id: candidate.id, from_stage: fromStage, to_stage: toStage,
    notes: notes || null, changed_by: userId,
  });

  // Entering a checklist phase instantiates that phase's checklist from its template.
  const entering = STAGE_CHECKLIST[toStage];
  if (entering) await checklist.ensureInstance(entering, { candidate_id: candidate.id }, userId, trx);

  // Any off-ramp archives the application out of the active pipeline.
  if (OFF_RAMPS.includes(toStage as any)) {
    await cx('candidates').where('id', candidate.id).update({ archived: true });
  }
}

/**
 * Park a candidate at their current stage, or resume them. A held candidate cannot change
 * stage until resumed (enforced in assertGate). Holding requires a reason; both hold and
 * resume are written to candidate_history so the pause is auditable.
 */
export async function setCandidateHold(id: number, onHold: boolean, reason: string | undefined, userId: number) {
  const candidate = await db('candidates').where('id', id).first();
  if (!candidate) throw new NotFoundError('Candidate');
  const wantHold = !!onHold;
  if (wantHold && TERMINAL.includes(candidate.stage)) {
    throw new ValidationError('This candidate has reached a final stage and cannot be put on hold.');
  }
  if (wantHold === !!candidate.on_hold) {
    throw new ValidationError(wantHold ? 'This candidate is already on hold.' : 'This candidate is not on hold.');
  }
  const note = String(reason || '').trim();
  if (wantHold && !note) throw new ValidationError('A reason is required to put a candidate on hold.');

  await db.transaction(async (trx) => {
    await trx('candidates').where('id', id).update({
      on_hold: wantHold, hold_reason: wantHold ? note : null, updated_at: trx.fn.now(),
    });
    await trx('candidate_history').insert({
      candidate_id: id, from_stage: candidate.stage, to_stage: candidate.stage,
      notes: wantHold ? `Put on hold: ${note}` : 'Resumed from hold', changed_by: userId,
    });
  });
  return getCandidate(id);
}

/**
 * Plain forward moves and the pre-offer/no-show off-ramps. Offer release, acceptance
 * and decline carry side effects and have their own entry points below — this refuses
 * them so a bare stage PUT can never mint an offer letter or an employee.
 */
export async function moveCandidateStage(id: number, toStage: string, userId: number, notes?: string) {
  const candidate = await db('candidates').where('id', id).first();
  if (!candidate) throw new NotFoundError('Candidate');

  if (toStage === 'offer_released') throw new ValidationError('Release the offer letter to move to Offer Release.');
  if (toStage === 'offer_accepted') throw new ValidationError('Record the offer acceptance to move to Offer Acceptance.');
  if (toStage === 'offer_declined') throw new ValidationError('Record the offer decline instead.');
  if (toStage === 'transferred') throw new ValidationError('Use Transfer to Manager to complete the hire.');

  if (toStage === 'no_show') return markNoShow(id, userId, notes);
  await transition(candidate, toStage, userId, notes);
  return getCandidate(id);
}

/**
 * The candidate's checklists for the detail page. When the candidate is in a checklist
 * phase (Document Collection / Pre-joining / Joining Day), the phase's instance is
 * ensured to exist and reconciled to its template first, so the list always matches the
 * current Checklist Template — completed items and uploaded documents are preserved.
 */
export async function getCandidateChecklists(candidateId: number, userId?: number | null) {
  const candidate = await db('candidates').where('id', candidateId).first();
  if (!candidate) throw new NotFoundError('Candidate');
  const key = STAGE_CHECKLIST[candidate.stage];
  if (key) {
    const instance = await checklist.ensureInstance(key, { candidate_id: candidateId }, userId ?? null);
    await checklist.reconcileInstanceToTemplate(instance.id);
  }
  return checklist.listForSubject({ candidate_id: candidateId });
}

/**
 * Step 11. Activates the employee created at acceptance and hands them to their
 * reporting manager. The joining-day checklist gate applies (see `transition`).
 */
export async function transferToManager(id: number, userId: number, notes?: string) {
  const candidate = await db('candidates').where('id', id).first();
  if (!candidate) throw new NotFoundError('Candidate');
  if (!candidate.employee_id) throw new ValidationError('This candidate has no employee record to transfer.');

  const employee = await db('employees').where('id', candidate.employee_id).first();
  if (!employee) throw new NotFoundError('Employee');

  // The transfer is the moment this body enters payroll. No creation path in this system assigns a
  // shift, so a new hire's weekly off rests entirely on their leave template — and an unconfigured
  // one means seven working days a week from day one. Checked before the advisory lock is taken:
  // it is a read-only question about configuration, not about this row.
  await assertHasWeeklyOff(employee.id, `${employee.first_name} ${employee.last_name}`.trim());

  // The final money gate must key off the vacancy's property_id (a real FK), NOT the employee's
  // branch_name text — a property rename between acceptance and transfer would leave branch_name
  // stale, matching no property, silently skipping the gate and committing an unbounded cost into
  // the unassigned bucket. releaseOffer/acceptOffer already gate on the vacancy's property_id.
  const vac = candidate.vacancy_id ? await db('vacancies').where('id', candidate.vacancy_id).first() : null;

  // Stamp the monthly CTC (planning figure) so the Manpower & Budget Control guardrail
  // counts this hire — it only sees employees with employees.monthly_ctc set. Prefer the
  // live salary structure (cloned onto the employee at offer acceptance); fall back to the
  // offer's annual CTC / 12. Leaving it null let hiring slip past the sanctioned headcount.
  let monthlyCtc = employee.monthly_ctc ?? null;
  if (monthlyCtc == null) {
    monthlyCtc = (await getMonthlyCtcMap([employee.id])).get(employee.id) ?? null;
  }
  if (monthlyCtc == null) {
    const offer = await db('offer_letters').where('candidate_id', id).first();
    if (offer?.offered_ctc) monthlyCtc = Math.round(Number(offer.offered_ctc) / 12);
  }

  await db.transaction(async (trx) => {
    if (monthlyCtc != null && vac) {
      // The cost is about to land in `committed`. The body already holds its slot (skipHeadcount),
      // and its own pending-offer cost is excluded so it doesn't count against itself. Blocks if
      // the free budget can no longer fit it (e.g. the sanction was lowered since acceptance).
      await advisoryXactLock(trx, LOCK.HIRE_BUDGET, vac.property_id);
      await assertHireAllowed(vac.property_id, vac.job_title_id, monthlyCtc, trx, { skipHeadcount: true, excludeCandidateId: id, candidateId: id });
    }
    await transition(candidate, 'transferred', userId, notes, trx);
    await trx('employees').where('id', employee.id).update({
      is_active: true,
      employment_status: 'active',
      ...(monthlyCtc != null ? { monthly_ctc: monthlyCtc } : {}),
      updated_at: trx.fn.now(),
    });
    // The cost has now landed in `committed`; spend any approved over-limit exception so a single
    // approval can't wave a second hire through, and leaves a clean audit trail.
    await consumeCandidateApproval(trx, id, employee.id);
  });

  await emit('employee.joined', {
    employeeId: employee.id,
    payload: {
      type: 'hire_transferred',
      title: 'New team member joined',
      message: `${employee.first_name} ${employee.last_name} has joined at ${employee.branch_name || 'their property'}.`,
      link: `/employees/${employee.id}`,
    },
  });

  // The hire is now a full employee but has no HRMS login yet — remind admins to
  // create their email + password on Admin → User Credentials, ready to share.
  const hasLogin = await db('users').where({ employee_id: employee.id, is_active: true }).first();
  if (!hasLogin) {
    await emit('employee.login_needed', {
      employeeId: employee.id,
      payload: {
        type: 'login_setup_required',
        title: 'New hire needs an HRMS login',
        message: `${employee.first_name} ${employee.last_name} has completed onboarding. Set their login email & password to share.`,
        link: '/admin/credentials',
      },
    });
  }
  return getCandidate(id);
}

/**
 * Off-ramp at step 9 or 10. The employee row already exists, so keep it for the audit
 * trail but mark it departed — that frees the sanctioned slot and stops it lingering
 * as an inactive row nobody can offboard (offboarding refuses inactive employees).
 */
export async function markNoShow(id: number, userId: number, notes?: string) {
  const candidate = await db('candidates').where('id', id).first();
  if (!candidate) throw new NotFoundError('Candidate');

  await db.transaction(async (trx) => {
    await transition(candidate, 'no_show', userId, notes, trx);
    if (candidate.employee_id) {
      await trx('employees').where('id', candidate.employee_id).update({
        employment_status: 'left', is_active: false, updated_at: trx.fn.now(),
      });
    }
    if (candidate.vacancy_id) {
      await trx('vacancies').where('id', candidate.vacancy_id)
        .where('filled', '>', 0).decrement('filled', 1);
    }
    // The accepted offer must stop RESERVING budget — the body left before its cost ever landed in
    // committed. Left as 'accepted' it keeps matching the reservation query (employee_id set but
    // monthly_ctc still null) and would sequester its offered budget at the property forever.
    await trx('offer_letters').where('candidate_id', id).whereIn('status', ['issued', 'accepted'])
      .update({ status: 'cancelled', updated_at: trx.fn.now() });
    // Release any approval token — this candidate is now terminal, so a lingering 'approved' row
    // would only mislead the audit trail and block a fresh request were the candidate ever revisited.
    await trx('manpower_exceptions').where('candidate_id', id).whereIn('status', ['pending', 'approved']).whereNull('consumed_at')
      .update({ status: 'cancelled', updated_at: trx.fn.now() });
  });
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

// ─── Steps 7-8: one offer letter ───
//
// There used to be two: a bare PDF built from candidates.offer_data before acceptance,
// and a real offer_letters row with the salary editor and the sanctioned-band cap,
// issued only after the onboarding checklist finished. They are now one letter, issued
// at Offer Release, carrying the editor and the cap. Acceptance stays an HR action —
// there is no candidate portal.

const inrAmount = (n: number) => Math.round(Number(n) || 0).toLocaleString('en-IN');

/** The candidate's vacancy resolved to the bits the offer needs. */
async function offerContext(candidateId: number) {
  const c = await db('candidates as c')
    .join('vacancies as v', 'v.id', 'c.vacancy_id')
    .join('job_titles as jt', 'jt.id', 'v.job_title_id')
    .join('properties as p', 'p.id', 'v.property_id')
    .where('c.id', candidateId)
    .select('c.*', 'v.job_title_id', 'v.property_id', 'v.reporting_manager_id',
      'jt.title as designation', 'p.name as property_name', 'p.state as property_state')
    .first();
  if (!c) throw new NotFoundError('Candidate');
  return c;
}

/** The component + calc rule + value the offer editor works in. */
export type OfferLine = { component_id: number; calculation_type: string; value: number };

const toOfferLines = (rows: any[]): OfferLine[] => rows.map((l: any) => ({
  component_id: Number(l.component_id),
  calculation_type: String(l.calculation_type),
  value: Number(l.value) || 0,
}));

/**
 * Live salary breakdown for a proposed monthly base and — optionally — a per-offer
 * structure. When `lines` are omitted the designation template's lines are used, so
 * an untouched offer prices exactly as it always did.
 *
 * The draft lines are never written back to the template: it feeds every other
 * candidate's offer, the vacancy's advertised CTC, the JD, and every future hire for
 * the designation. They live on the offer letter and are cloned onto the employee's
 * PRIVATE structure at acceptance.
 */
async function breakdownFor(jobTitleId: number, baseGross: number, state: string | null, lines?: OfferLine[] | null) {
  const structure = await getStructureByJobTitle(jobTitleId);
  if (!structure) return null;
  // Omitted lines mean "price the designation template". An EMPTY array is different:
  // the operator cleared the editor, and silently substituting the template would file
  // an offer whose structure nobody chose. The client blocks it; the server decides.
  if (Array.isArray(lines) && lines.length === 0) {
    throw new ValidationError('An offer must include at least one salary component.');
  }
  const structGross = Number(structure.default_base) || 0;
  const gross = baseGross > 0 ? baseGross : structGross;
  const draft = lines?.length ? lines : toOfferLines(await editorLines(structure.id));
  const breakdown = await previewStructure({ lines: draft, base: gross, city: state ?? structure.city });
  return { gross, structGross, breakdown, annual_ctc: Math.round(breakdown.ctc * 12), lines: draft };
}

/** The component catalog the offer's line editor picks from. */
export async function listOfferComponents() {
  return listSalaryComponents();
}

/** Prefill for the salary editor: structure base, the sanctioned band cap, prior issue. */
export async function getOfferDefaults(candidateId: number) {
  const c = await offerContext(candidateId);
  const range = await getCtcRange(c.job_title_id);
  const band = await getRoleBand(c.job_title_id);
  const structure = await getStructureByJobTitle(c.job_title_id);
  const issued = await db('offer_letters').where('candidate_id', candidateId).first();
  const issuedTpl = issued
    ? (typeof issued.template_data === 'string' ? JSON.parse(issued.template_data) : issued.template_data)
    : null;
  // The same sanctioned-cap picture the release gate enforces, so the editor can warn (and offer
  // "request approval") BEFORE a release is attempted. Exclude this candidate's own pending offer.
  const avail = await computeAvailability(c.property_id, c.job_title_id, undefined, { excludeCandidateId: candidateId });
  // A live approval request for THIS candidate: 'pending' (awaiting an admin) or 'approved' (its
  // requested_ctc is the ceiling the release gate will accept). Lets the editor re-enable Release.
  const liveEx = await db('manpower_exceptions')
    .where({ candidate_id: candidateId }).whereIn('status', ['pending', 'approved']).whereNull('consumed_at')
    .orderBy('created_at', 'desc').first();
  return {
    candidate_name: c.name,
    designation: c.designation,
    configured: range.configured,
    base_gross: structure ? Math.round(Number(structure.default_base) || 0) : 0,
    band_max: band.configured ? band.band_max : null,
    property_configured: avail.property_configured,
    band_configured: avail.band_configured,
    remaining_budget: avail.remaining_budget,
    remaining_slots: avail.remaining_slots,
    exception_status: liveEx?.status ?? null,
    approved_ctc: liveEx?.status === 'approved' ? Number(liveEx.requested_ctc) : null,
    already_issued: !!issued,
    status: issued?.status ?? null,
    // Seed the line editor: an issued letter shows what was actually offered, an
    // unissued one starts from the designation template.
    lines: issuedTpl?.lines?.length ? issuedTpl.lines : (structure ? await editorLines(structure.id) : []),
    template_lines: structure ? await editorLines(structure.id) : [],
  };
}

/** Live recompute as the editor base or lines change. No salary math in the client. */
export async function getOfferBreakdown(candidateId: number, baseGross: number, lines?: OfferLine[] | null) {
  const c = await offerContext(candidateId);
  const ob = await breakdownFor(c.job_title_id, baseGross, c.property_state, lines);
  if (!ob) throw new ValidationError('This designation has no salary structure — configure one first.');
  const band = await getRoleBand(c.job_title_id);
  return { ...ob, band_max: band.configured ? band.band_max : null };
}

/**
 * The offered monthly base must be a real, positive amount.
 *
 * It previously had no floor anywhere on the write path. The controllers coerce a missing,
 * empty or non-numeric base to 0 (`Number(x) || 0`), and `breakdownFor` then substitutes the
 * designation template's `default_base` for any base <= 0 — so an offer letter got filed at a
 * figure nobody chose, with `offer_adjustment_pct` recorded as 0.00% so it read as deliberate.
 * That base is cloned onto the employee's salary structure when the offer is accepted, which
 * makes it what payroll pays. Where a template itself carries `default_base = 0`, the letter
 * was issued at ₹0 outright.
 *
 * Neither existing gate caught it: `assertCtcMeetsMinimumWage` is a no-op for any state with no
 * configured minimum wage, and the sanctioned band only has a maximum, which 0 clears trivially.
 *
 * Deliberately does NOT round — a valid base passes through byte-identical, so no existing offer
 * moves by a rupee. `Number.isFinite` also closes Infinity, which survives the controllers' `|| 0`.
 *
 * The live editor breakdown is NOT affected: `getOfferBreakdown` calls `breakdownFor` directly,
 * so an absent base still means "price the designation template" there.
 */
export function assertOfferedBase(baseGross: unknown): number {
  const n = Number(baseGross);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ValidationError('Enter the offered monthly base salary — it must be an amount greater than zero.');
  }
  return n;
}

/** Snapshot the letter template_data — exactly what the PDF renders. */
async function buildOfferLetter(
  candidateId: number,
  opts: { base_gross: number; joining_date?: string | null; designation?: string; lines?: OfferLine[] | null },
  { enforceBand = true }: { enforceBand?: boolean } = {},
) {
  const c = await offerContext(candidateId);
  const ob = await breakdownFor(c.job_title_id, assertOfferedBase(opts.base_gross), c.property_state, opts.lines);
  if (!ob) throw new ValidationError('This designation has no salary structure — configure one first.');

  // Only the statutory floor is checked here. The full sanctioned-cap gate (role maximum +
  // free budget + open headcount, with pending-offer reservations) runs inside releaseOffer's
  // locked transaction — that's where a real commitment is made, and the lock stops two HRs
  // racing into the same last slot/rupee. previewOffer passes enforceBand=false so HR can see
  // the numbers (and why an offer would be blocked) before committing.
  if (enforceBand) {
    await assertCtcMeetsMinimumWage(c.property_state, ob.breakdown.ctc);
  }

  const pct = ob.structGross > 0 ? Math.round((ob.gross / ob.structGross - 1) * 10000) / 100 : 0;
  return {
    candidate: c,
    offered_base: ob.gross,
    offered_ctc: ob.annual_ctc,
    offer_adjustment_pct: pct,
    template_data: {
      designation: opts.designation || c.designation || 'Position',
      salary: inrAmount(ob.annual_ctc),
      joining_date: opts.joining_date || null,
      base_gross: ob.gross,
      adjustment_pct: pct,
      breakdown: ob.breakdown,
      // The structure as offered. Cloned onto the employee's private structure at
      // acceptance, so what was signed is what payroll pays.
      lines: ob.lines,
    },
  };
}

type OfferInput = { base_gross: number; joining_date?: string | null; designation?: string; lines?: OfferLine[] | null };

/**
 * Preview the PDF without filing anything. Deliberately NOT band-gated: HR must be able
 * to see an over-band offer in order to understand what to change. Release still refuses.
 */
export async function previewOffer(candidateId: number, opts: OfferInput) {
  const built = await buildOfferLetter(candidateId, opts, { enforceBand: false });
  return { candidate: built.candidate, template_data: built.template_data };
}

/** Step 7. Issues THE offer letter and advances the candidate — atomically. */
export async function releaseOffer(candidateId: number, opts: OfferInput, userId: number) {
  const existing = await db('offer_letters').where('candidate_id', candidateId).first();
  if (existing) throw new ValidationError('An offer letter has already been issued for this candidate.');

  // Gate first: an unfinished document checklist should say so, not complain about the
  // salary band. transition() re-checks inside the transaction.
  const gateCandidate = await db('candidates').where('id', candidateId).first();
  if (!gateCandidate) throw new NotFoundError('Candidate');
  await assertGate(gateCandidate, 'offer_released');

  const built = await buildOfferLetter(candidateId, opts);
  await db.transaction(async (trx) => {
    // Authoritative sanctioned-cap gate, inside the advisory lock so two HRs can't both release
    // an offer into the same last slot/rupee. Blocks over role-max, over free budget, headcount
    // full, or an unconfigured property/role. (An admin-approved exception will pass here in BC4.)
    await advisoryXactLock(trx, LOCK.HIRE_BUDGET, built.candidate.property_id);
    await assertHireAllowed(built.candidate.property_id, built.candidate.job_title_id, built.template_data.breakdown.ctc, trx, { candidateId });
    await transition(built.candidate, 'offer_released', userId, 'Offer letter issued', trx);
    await trx('offer_letters').insert({
      candidate_id: candidateId,
      template_data: JSON.stringify(built.template_data),
      offered_base: built.offered_base,
      offered_ctc: built.offered_ctc,
      offer_adjustment_pct: built.offer_adjustment_pct,
      status: 'issued',
      issued_by: userId,
    });
  });
  return getCandidate(candidateId);
}

/**
 * The escape hatch when releaseOffer is blocked by the sanctioned cap: instead of being dead-ended,
 * HR raises an approval request for THIS offer (its exact CTC), which a different admin can approve in
 * the Approvals inbox. Once approved, releaseOffer/acceptOffer/transferToManager for this candidate
 * pass the gate. No offer is filed here — this only records the request.
 */
export async function requestOfferApproval(candidateId: number, opts: OfferInput, reason: string, userId: number) {
  const existing = await db('offer_letters').where('candidate_id', candidateId).first();
  if (existing) throw new ValidationError('An offer letter has already been issued for this candidate.');
  const built = await buildOfferLetter(candidateId, opts, { enforceBand: false });
  return createCandidateException({
    candidateId,
    propertyId: built.candidate.property_id,
    jobTitleId: built.candidate.job_title_id,
    candidateName: built.candidate.name,
    monthlyCtc: built.template_data.breakdown.ctc,
    joinDate: opts.joining_date || null,
    reason,
  }, userId);
}

export async function getOfferLetter(candidateId: number) {
  const letter = await db('offer_letters as ol')
    .join('candidates as c', 'c.id', 'ol.candidate_id')
    .where('ol.candidate_id', candidateId)
    .select('ol.*', 'c.name as candidate_name', 'c.employee_id')
    .first();
  if (!letter) throw new NotFoundError('Offer letter');
  const tpl = typeof letter.template_data === 'string' ? JSON.parse(letter.template_data) : letter.template_data;
  return { ...letter, template_data: tpl };
}

/**
 * Step 8 (accept). HR records the acceptance; the employee record is created here,
 * inactive and pre_joining, and the vacancy takes a filled seat.
 */
export async function acceptOffer(candidateId: number, userId: number, joiningDate?: string) {
  const candidate = await db('candidates').where('id', candidateId).first();
  if (!candidate) throw new NotFoundError('Candidate');
  const letter = await db('offer_letters').where('candidate_id', candidateId).first();
  if (!letter) throw new ValidationError('No offer letter has been issued for this candidate.');
  if (letter.status !== 'issued') throw new ValidationError(`This offer is already ${letter.status}.`);

  const tpl = typeof letter.template_data === 'string' ? JSON.parse(letter.template_data) : letter.template_data;
  const joining = joiningDate || tpl.joining_date || undefined;
  const monthlyCtc = Math.round(Number(letter.offered_ctc) / 12);

  const employeeId = await db.transaction(async (trx) => {
    // Re-check the cap now that the body is about to land — the sanction may have been lowered or
    // the slot taken by another hire since release. Exclude THIS candidate's own pending offer
    // (its reservation is being converted into the hire, so it must not count against itself).
    const vac = await trx('vacancies').where('id', candidate.vacancy_id).first();
    if (vac) {
      await advisoryXactLock(trx, LOCK.HIRE_BUDGET, vac.property_id);
      await assertHireAllowed(vac.property_id, vac.job_title_id, monthlyCtc, trx, { excludeCandidateId: candidateId, candidateId });
    }
    await transition(candidate, 'offer_accepted', userId, 'Offer accepted', trx);
    const newEmployeeId = await createEmployeeFromCandidate(candidate, joining, trx);

    // Carry the issued salary onto the employee record — the old post-checklist path
    // wrote these columns; they now travel with the one letter.
    await trx('employees').where('id', newEmployeeId).update({
      offered_base: letter.offered_base,
      offered_ctc: letter.offered_ctc,
      offer_adjustment_pct: letter.offer_adjustment_pct,
    });
    await trx('candidates').where('id', candidateId)
      .update({ employee_id: newEmployeeId, offer_responded_at: trx.fn.now() });
    await trx('offer_letters').where('id', letter.id).update({
      status: 'accepted', employee_id: newEmployeeId, responded_at: trx.fn.now(), updated_at: trx.fn.now(),
    });
    if (candidate.vacancy_id) await trx('vacancies').where('id', candidate.vacancy_id).increment('filled', 1);
    return newEmployeeId;
  });

  // Seed the employee's PRIVATE payroll structure from the offer that was signed —
  // its lines and its base — not from the designation template. Previously this called
  // seedEmployeeStructureFromTemplate(employeeId) with no base, so payroll paid the
  // template's default_base and every negotiated adjustment was silently discarded.
  // Best effort: a missing structure must not fail the acceptance.
  try {
    if (tpl.lines?.length) {
      await saveEmployeeStructure(employeeId, {
        lines: (tpl.lines as OfferLine[]).map((l) => ({
          component_id: Number(l.component_id),
          calculation_type: l.calculation_type,
          value: Number(l.value) || 0,
        })),
        base: Number(letter.offered_base) || 0,
        tds_amount: 0,
        effective_from: joining || null,
      } as any, userId);
    } else {
      // A letter issued before per-offer lines existed: still honour its base.
      await seedEmployeeStructureFromTemplate(employeeId, { base: Number(letter.offered_base) || 0 }, userId);
    }
  } catch { /* configured later in Admin → Salary Structures */ }

  return getCandidate(candidateId);
}

/** Step 8 (decline). Off-ramp; no employee is ever created. */
export async function declineOffer(candidateId: number, userId: number, reason?: string) {
  const candidate = await db('candidates').where('id', candidateId).first();
  if (!candidate) throw new NotFoundError('Candidate');
  const letter = await db('offer_letters').where('candidate_id', candidateId).first();
  if (letter && letter.status !== 'issued') throw new ValidationError(`This offer is already ${letter.status}.`);

  await db.transaction(async (trx) => {
    await transition(candidate, 'offer_declined', userId, reason, trx);
    if (letter) {
      await trx('offer_letters').where('id', letter.id).update({
        status: 'declined', responded_at: trx.fn.now(), updated_at: trx.fn.now(),
      });
    }
    // Release any approval token — the candidate declined, so a lingering 'approved'/'pending' row
    // would only clutter the audit trail and the Admin inbox.
    await trx('manpower_exceptions').where('candidate_id', candidateId).whereIn('status', ['pending', 'approved']).whereNull('consumed_at')
      .update({ status: 'cancelled', updated_at: trx.fn.now() });
    await trx('candidates').where('id', candidateId).update({ offer_responded_at: trx.fn.now() });
  });
  return getCandidate(candidateId);
}

/** Steps 9-11, worked by HR ops: everyone past acceptance and not yet transferred. */
export async function listJoiningQueue() {
  const rows = await db('candidates as c')
    .join('vacancies as v', 'v.id', 'c.vacancy_id')
    .join('job_titles as jt', 'jt.id', 'v.job_title_id')
    .join('properties as p', 'p.id', 'v.property_id')
    .leftJoin('employees as e', 'e.id', 'c.employee_id')
    .whereIn('c.stage', ['offer_accepted', 'pre_joining', 'joining'])
    .select('c.id', 'c.name', 'c.stage', 'c.employee_id', 'jt.title as designation',
      'p.name as property_name', 'e.employee_code', 'e.date_of_joining', 'e.employment_status')
    .orderBy('e.date_of_joining');
  if (!rows.length) return [];

  const instances = await db('checklist_instances as ci')
    .join('checklist_templates as ct', 'ct.id', 'ci.template_id')
    .whereIn('ci.candidate_id', rows.map((r: any) => r.id))
    .select('ci.id', 'ci.candidate_id', 'ci.status', 'ct.key');
  const items = instances.length
    ? await db('checklist_instance_items').whereIn('instance_id', instances.map((i: any) => i.id))
      .select('instance_id', 'is_completed')
    : [];

  return rows.map((r: any) => ({
    ...r,
    checklists: instances.filter((i: any) => i.candidate_id === r.id).map((i: any) => {
      const own = items.filter((it: any) => it.instance_id === i.id);
      return { key: i.key, status: i.status, total: own.length, done: own.filter((it: any) => it.is_completed).length };
    }),
  }));
}
