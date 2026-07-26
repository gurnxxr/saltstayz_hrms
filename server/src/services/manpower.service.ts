import type { Knex } from 'knex';
import db from '../config/database';
import { JwtPayload } from '../types';
import { NotFoundError, ValidationError, ForbiddenError, GuardrailError } from '../utils/errors';
import { getDefaultTemplateId } from './leaveTemplate.service';
import { nextJobId } from '../utils/jobId';
import { LOCK, advisoryXactLock } from '../utils/locks';
import { notifyRole } from './notification.service';
import { LIVE_VACANCY_STATUSES } from './recruitment.service';
import { getMonthlyCtcMap } from './salaryStructure.service';

// ─────────────────────────────────────────────────────────────────────────────
// Manpower & Budget Control
//
// Admin sanctions, per property x role (job_title): a monthly CTC budget, a
// headcount cap, and a salary band {min,max}. The Add-Hire guardrail blocks
// over-headcount / over-band / over-budget hires; blocked hires can be raised as an
// exception for Admin approval. Committed = Σ monthly_ctc of non-Left employees.
// ─────────────────────────────────────────────────────────────────────────────

export const EMPLOYMENT_STATUSES = ['pre_joining', 'active', 'pip', 'on_notice', 'left', 'absconding'] as const;
export type EmploymentStatus = typeof EMPLOYMENT_STATUSES[number];
// Departed = the employee is gone (Left = resigned/terminated, Absconding =
// vanished without notice). Both free the headcount slot + budget. Pre-joining
// (an accepted-but-not-yet-active hire), Active, PIP and On Notice all consume a
// slot + budget — a pre-joining hire reserves its sanctioned position.
export const DEPARTED_STATUSES: string[] = ['left', 'absconding'];
const CONSUMES_SLOT = (s: string) => !DEPARTED_STATUSES.includes(s);

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const today = () => new Date().toISOString().split('T')[0];

// ─── Scope (who can touch which properties) ───
// admin/chro: all. cluster_hr: properties in their assigned cluster(s).
// property_manager: their own property (via their employee's branch_name).

export interface Scope { all: boolean; propertyIds: number[]; propertyNames: string[]; }

export async function getScope(user?: JwtPayload): Promise<Scope> {
  const empty: Scope = { all: false, propertyIds: [], propertyNames: [] };
  if (!user) return empty;
  if (user.roleName === 'admin' || user.roleName === 'chro') return { all: true, propertyIds: [], propertyNames: [] };

  if (user.roleName === 'cluster_hr') {
    const props = await db('properties as p')
      .join('user_clusters as uc', 'uc.cluster_id', 'p.cluster_id')
      .where('uc.user_id', user.userId)
      .select('p.id', 'p.name');
    return { all: false, propertyIds: props.map((p: any) => p.id), propertyNames: props.map((p: any) => p.name) };
  }

  if (user.roleName === 'property_manager') {
    if (!user.employeeId) return empty;
    const emp = await db('employees').where('id', user.employeeId).first();
    if (!emp?.branch_name) return empty;
    const p = await db('properties').where('name', emp.branch_name).first();
    return { all: false, propertyIds: p ? [p.id] : [], propertyNames: [emp.branch_name] };
  }
  return empty;
}

async function assertPropertyInScope(user: JwtPayload | undefined, propertyId: number) {
  const scope = await getScope(user);
  if (scope.all) return;
  if (!scope.propertyIds.includes(Number(propertyId))) {
    throw new ForbiddenError('This property is outside your assigned cluster/property.');
  }
}

async function assertEmployeeInScope(user: JwtPayload | undefined, emp: any) {
  const scope = await getScope(user);
  if (scope.all) return;
  if (!scope.propertyNames.includes(emp.branch_name)) {
    throw new ForbiddenError('This employee is outside your assigned cluster/property.');
  }
}

// ─── Availability + the guardrail core ───

export interface Availability {
  configured: boolean;
  property_configured: boolean;
  band_configured: boolean;
  is_locked: boolean;
  property_id: number;
  property_name: string;
  job_title_id: number;
  job_title?: string;
  sanctioned_headcount: number;
  sanctioned_budget_monthly: number;
  band_min: number;
  band_max: number;
  /** The pay grade the band came from, for display. Null when the role has none set. */
  pay_grade_name?: string | null;
  committed_amount: number;
  non_left_headcount: number;
  remaining_budget: number;
  remaining_slots: number;
  suggested_ctc: number;
  utilization_pct: number;
  pip_backfill?: number; // # of PIP positions that free a backup slot/budget here
}

/** Suggested salary: the role's approved maximum, capped by the remaining budget when that binds. */
export function suggestedSalary(remaining_budget: number, band_max: number): number {
  if (remaining_budget <= 0) return 0;
  return round2(Math.max(0, Math.min(band_max, remaining_budget)));
}

export interface PropertyBudget {
  property_id: number;
  property_name: string;
  cluster_name?: string | null;
  source: 'explicit' | 'rolled_up';
  configured: boolean;
  sanctioned_budget_monthly: number;
  sanctioned_headcount: number;
  committed_amount: number;
  filled_headcount: number;
  missing_salary_count: number;
  reserved_budget: number;   // Σ pending offers (issued, not yet hired) monthly cost
  reserved_slots: number;    // count of those pending offers
  remaining_budget: number;  // sanctioned − committed − reserved (the genuinely free budget)
  remaining_slots: number;   // sanctioned_headcount − filled − reserved
  utilization_pct: number;
  over_budget: boolean;
  over_headcount: boolean;
}

// Committed money + filled headcount across all non-departed employees at a property.
// Headcount counts EVERY non-departed body — a hired person occupies a sanctioned slot whether
// or not their salary has been keyed yet (so the cap can't be walked past by onboarding staff
// without a salary). Committed money sums only the salaries that HAVE been keyed (SUM ignores
// NULLs); missing_salary flags the bodies whose cost isn't in committed yet, so remaining_budget
// isn't silently read as fully free.
async function propertyCommitment(cx: Knex | Knex.Transaction, propertyName: string) {
  const agg = await cx('employees')
    .where('branch_name', propertyName)
    .whereNotIn('employment_status', DEPARTED_STATUSES)
    .select(
      cx.raw('COALESCE(SUM(monthly_ctc), 0) as committed'),
      cx.raw('COUNT(*) as cnt'),
      cx.raw('COUNT(*) FILTER (WHERE monthly_ctc IS NULL) as missing_salary'),
    )
    .first();
  return {
    committed: round2(Number(agg?.committed || 0)),
    filled: Number(agg?.cnt || 0),
    missing_salary: Number(agg?.missing_salary || 0),
  };
}

// Employees on PIP are still on payroll (they count in committed/filled), but their
// position is backfillable — HR may hire a backup ahead of a likely exit. This
// returns the slot + budget allowance to grant for that backup hire.
async function propertyPipBackfill(cx: Knex | Knex.Transaction, propertyName: string) {
  // Count EVERY PIP body for the slot credit — a PIP employee consumes a slot (propertyCommitment
  // counts all bodies) whether or not their salary is keyed, so its backfill seat must be freed
  // regardless. SUM(monthly_ctc) still ignores NULLs, so the budget credit is only the keyed pay.
  const agg = await cx('employees')
    .where('branch_name', propertyName)
    .where('employment_status', 'pip')
    .select(cx.raw('COALESCE(SUM(monthly_ctc), 0) as budget'), cx.raw('COUNT(*) as cnt'))
    .first();
  return { count: Number(agg?.cnt || 0), budget: round2(Number(agg?.budget || 0)) };
}

// Pending offers reserve a slot + their monthly cost against the cap the moment they're released,
// so a second HR can't offer into the same last slot/rupee before the first offer is accepted.
// A pending offer = an ISSUED offer_letter for a candidate not yet turned into an employee.
// `excludeCandidateId` drops one candidate's own offer (used when re-checking that candidate's
// accept — their reservation is about to be consumed, so it must not count against itself).
async function propertyReservations(
  cx: Knex | Knex.Transaction, propertyId: number, opts?: { excludeCandidateId?: number },
) {
  // SLOTS: reserved only while the body doesn't exist yet — an issued offer whose candidate isn't
  // an employee. Once accepted, the pre_joining body itself is counted in `filled`, so the offer
  // must stop reserving a slot (or it would double-count the headcount).
  const slotQ = cx('offer_letters as ol')
    .join('candidates as c', 'c.id', 'ol.candidate_id')
    .join('vacancies as v', 'v.id', 'c.vacancy_id')
    .where('v.property_id', propertyId).where('ol.status', 'issued').whereNull('c.employee_id');
  if (opts?.excludeCandidateId) slotQ.whereNot('c.id', opts.excludeCandidateId);
  const slotAgg = await slotQ.count({ cnt: '*' }).first();

  // BUDGET: reserved until the cost actually lands in `committed` (employees.monthly_ctc set).
  // Covers issued offers AND accepted-but-not-yet-activated hires (pre_joining, monthly_ctc null),
  // so the promised pay is never briefly invisible between accept and activation.
  const budQ = cx('offer_letters as ol')
    .join('candidates as c', 'c.id', 'ol.candidate_id')
    .join('vacancies as v', 'v.id', 'c.vacancy_id')
    .leftJoin('employees as e', 'e.id', 'c.employee_id')
    .where('v.property_id', propertyId).whereIn('ol.status', ['issued', 'accepted'])
    .where(function (this: Knex.QueryBuilder) { this.whereNull('c.employee_id').orWhereNull('e.monthly_ctc'); });
  if (opts?.excludeCandidateId) budQ.whereNot('c.id', opts.excludeCandidateId);
  const budAgg = await budQ.sum({ annual: 'ol.offered_ctc' }).first();

  return {
    reserved_slots: Number(slotAgg?.cnt || 0),
    reserved_budget: round2(Number(budAgg?.annual || 0) / 12),
  };
}

/**
 * Property-level sanctioned budget + headcount (the primary cap). Uses the explicit
 * Budget-Control row if set, else rolls up the per-role sanctions. Committed/filled
 * are cumulative across all roles at the property.
 */
export async function computePropertyBudget(propertyId: number, trx?: Knex.Transaction, opts?: { excludeCandidateId?: number }): Promise<PropertyBudget> {
  const cx = trx || db;
  const property = await cx('properties as p').leftJoin('clusters as c', 'c.id', 'p.cluster_id')
    .where('p.id', propertyId).select('p.id', 'p.name', 'c.name as cluster_name').first();
  if (!property) throw new NotFoundError('Property');

  const explicit = await cx('manpower_property_budgets').where('property_id', propertyId).first();
  const roll = await cx('manpower_sanctions').where('property_id', propertyId)
    .sum({ budget: 'sanctioned_budget_monthly' }).sum({ head: 'sanctioned_headcount' }).first();
  const rolledBudget = round2(Number(roll?.budget || 0));
  const rolledHead = Number(roll?.head || 0);

  const hasExplicit = !!explicit;
  const sanctioned_budget_monthly = hasExplicit ? Number(explicit.sanctioned_budget_monthly) : rolledBudget;
  const sanctioned_headcount = hasExplicit ? Number(explicit.sanctioned_headcount) : rolledHead;

  const { committed, filled, missing_salary } = await propertyCommitment(cx, property.name);
  const { reserved_budget, reserved_slots } = await propertyReservations(cx, propertyId, opts);
  // Free = sanctioned minus what's already spent (committed) AND already promised (pending offers).
  const remaining_budget = round2(sanctioned_budget_monthly - committed - reserved_budget);
  const remaining_slots = sanctioned_headcount - filled - reserved_slots;

  return {
    property_id: propertyId, property_name: property.name, cluster_name: property.cluster_name,
    source: hasExplicit ? 'explicit' : 'rolled_up',
    configured: hasExplicit || rolledBudget > 0 || rolledHead > 0,
    sanctioned_budget_monthly, sanctioned_headcount,
    committed_amount: committed, filled_headcount: filled, missing_salary_count: missing_salary,
    reserved_budget, reserved_slots,
    remaining_budget, remaining_slots,
    utilization_pct: sanctioned_budget_monthly > 0 ? round2((committed / sanctioned_budget_monthly) * 100) : 0,
    over_budget: committed > sanctioned_budget_monthly,
    over_headcount: filled > sanctioned_headcount,
  };
}

/**
 * Availability for a single hire: budget + headcount caps come from the PROPERTY
 * total; the salary band comes from the ROLE'S PAY GRADE. The suggestion reserves
 * band_min for the other open property slots.
 *
 * The band used to come from `manpower_sanctions.band_min/band_max`, one cap per
 * property × role. It is now the role's pay grade, which is one band per role
 * everywhere — so a Front Desk Executive is held to the same ceiling at every
 * property instead of a figure that had to be re-entered per hotel and silently
 * allowed anything where nobody had entered one.
 *
 * This is the ONLY place the band is read, so re-pointing it here moves every
 * guarded path at once: direct hire, employee CSV import, recruitment offer
 * release, and vacancy creation. Headcount and budget are untouched — they still
 * come from computePropertyBudget, which rolls up `manpower_sanctions`, which is
 * why that table stays.
 */
export async function computeAvailability(propertyId: number, jobTitleId: number, trx?: Knex.Transaction, opts?: { excludeCandidateId?: number }): Promise<Availability> {
  const cx = trx || db;
  const jt = await cx('job_titles as jt')
    .leftJoin('pay_grades as pg', 'pg.id', 'jt.pay_grade_id')
    .where('jt.id', jobTitleId)
    .select('jt.title', 'jt.pay_grade_id', 'pg.name as pay_grade_name', 'pg.min_salary', 'pg.max_salary')
    .first();
  if (!jt) throw new NotFoundError('Role');

  const pb = await computePropertyBudget(propertyId, trx, opts);
  // Still read for `is_locked` only — that flag locks the role's HEADCOUNT sanction,
  // which has nothing to do with the salary band.
  const roleSanction = await cx('manpower_sanctions').where({ property_id: propertyId, job_title_id: jobTitleId }).first();
  const band_min = Number(jt.min_salary) || 0;
  const band_max = Number(jt.max_salary) || 0;
  // A role with no pay grade has no approved ceiling, so it is NOT configured and
  // hiring into it is blocked until an admin assigns a grade. Treating "unset" as
  // "unlimited" would make an ungraded role the way to bypass the ceiling entirely.
  const band_configured = jt.pay_grade_id != null && band_max > 0;

  // PIP positions are backfillable — grant a slot + budget allowance so HR can hire
  // a backup for each PIP employee (who still shows as committed in the displays).
  const pip = await propertyPipBackfill(cx, pb.property_name);
  const remaining_budget = round2(pb.remaining_budget + pip.budget);
  const remaining_slots = pb.remaining_slots + pip.count;

  return {
    configured: pb.configured && band_configured,
    property_configured: pb.configured,
    band_configured,
    is_locked: roleSanction ? !!roleSanction.is_locked : false,
    property_id: propertyId,
    property_name: pb.property_name,
    job_title_id: jobTitleId,
    job_title: jt.title,
    sanctioned_headcount: pb.sanctioned_headcount,
    sanctioned_budget_monthly: pb.sanctioned_budget_monthly,
    band_min, band_max,
    pay_grade_name: jt.pay_grade_name ?? null,
    committed_amount: pb.committed_amount,
    non_left_headcount: pb.filled_headcount,
    remaining_budget,
    remaining_slots,
    suggested_ctc: suggestedSalary(remaining_budget, band_max),
    utilization_pct: pb.utilization_pct,
    pip_backfill: pip.count,
  };
}

export interface GuardrailBlock { exception_type: 'over_headcount' | 'over_band' | 'over_budget'; variance_amount: number; message: string; }

/**
 * Returns null if the CTC is allowed, else the reason it's blocked. Enforces (per the agreed model):
 * the sanctioned headcount (with reservations), the role's approved MAXIMUM salary, and that the pay
 * fits the remaining budget. No band-minimum (the statutory minimum wage is the only floor, enforced
 * on the offer/structure paths). `skipHeadcount` is used when the body already occupies a slot
 * (e.g. re-checking a salary at activation) so only the money is re-validated.
 */
export function evaluateGuardrail(a: Availability, ctc: number, opts?: { skipHeadcount?: boolean }): GuardrailBlock | null {
  if (!opts?.skipHeadcount && a.remaining_slots <= 0) {
    return { exception_type: 'over_headcount', variance_amount: 0,
      message: `No open slots — ${a.non_left_headcount}/${a.sanctioned_headcount} filled for ${a.job_title} at ${a.property_name} (pending offers included).` };
  }
  if (ctc > a.band_max) {
    const grade = a.pay_grade_name ? ` (${a.pay_grade_name})` : '';
    return { exception_type: 'over_band', variance_amount: round2(ctc - a.band_max),
      message: `₹${ctc.toLocaleString('en-IN')} is ₹${round2(ctc - a.band_max).toLocaleString('en-IN')}/month above the pay-grade maximum of ₹${a.band_max.toLocaleString('en-IN')} for ${a.job_title}${grade}.` };
  }
  if (ctc > a.remaining_budget) {
    return { exception_type: 'over_budget', variance_amount: round2(ctc - a.remaining_budget),
      message: `₹${ctc.toLocaleString('en-IN')} is ₹${round2(ctc - a.remaining_budget).toLocaleString('en-IN')}/month above the free budget of ₹${a.remaining_budget.toLocaleString('en-IN')} for ${a.property_name}.` };
  }
  return null;
}

/**
 * The single hiring chokepoint. Every path that creates an employee or commits a salary calls this.
 * Recomputes availability (with reservations) and throws GuardrailError unless the hire fits — no
 * budget/role-cap configured means no hire. `override` (a verified admin approval) bypasses the
 * numeric checks; `excludeCandidateId` drops that candidate's own pending-offer reservation (accept
 * re-check); `skipHeadcount` re-validates only the money for a body that already holds a slot.
 * Returns the Availability it evaluated (handy for snapshots / variance).
 */
export async function assertHireAllowed(
  propertyId: number, jobTitleId: number, ctc: number, trx?: Knex.Transaction,
  opts?: { excludeCandidateId?: number; skipHeadcount?: boolean; override?: boolean; candidateId?: number },
): Promise<Availability> {
  const cx = trx || db;
  const a = await computeAvailability(propertyId, jobTitleId, trx, { excludeCandidateId: opts?.excludeCandidateId });
  if (opts?.override) return a; // an admin-approved exception was verified by the caller

  // Work out what (if anything) blocks this hire.
  let failure: GuardrailError | null = null;
  if (!a.property_configured) {
    failure = new GuardrailError('No sanctioned budget/headcount is set for this property — an Admin must set it in Admin → Budget Control before hiring.',
      { exception_type: 'over_budget', variance_amount: 0, availability: a, requested_ctc: ctc });
  } else if (!a.band_configured) {
    failure = new GuardrailError(`No pay grade is set for ${a.job_title} — an Admin must assign one in Admin → Organization → Job Titles before an offer/hire.`,
      { exception_type: 'over_band', variance_amount: 0, availability: a, requested_ctc: ctc });
  } else {
    const block = evaluateGuardrail(a, ctc, { skipHeadcount: opts?.skipHeadcount });
    if (block) failure = new GuardrailError(block.message, { ...block, availability: a, requested_ctc: ctc });
  }
  if (!failure) return a;

  // Blocked — the one escape is a still-valid admin-approved exception raised for THIS candidate
  // that covers the pay (maker≠checker was enforced when it was approved). The gate stays the single
  // source of truth: callers pass the candidate id and never decide the override themselves.
  if (opts?.candidateId != null && await hasApprovedException(cx, opts.candidateId, ctc)) return a;
  throw failure;
}

/**
 * A live admin-approved exception for this candidate whose approved ceiling (requested_ctc) covers
 * `ctc`. Three gates measure the SAME offer's monthly CTC from three slightly different bases —
 * release uses breakdown.ctc, accept uses round(annual_ctc/12), transfer uses the recomputed salary
 * structure (getMonthlyCtcMap) — so a ₹1 rounding slack is allowed. Without it the final transfer
 * gate would spuriously re-block an already-approved hire; a genuine over-approval (≥₹2) still blocks.
 */
async function hasApprovedException(cx: Knex | Knex.Transaction, candidateId: number, ctc: number): Promise<boolean> {
  const ex = await cx('manpower_exceptions')
    .where({ candidate_id: candidateId, status: 'approved' })
    .whereNull('consumed_at')
    .andWhere('requested_ctc', '>=', Math.round(ctc) - 1)
    .first();
  return !!ex;
}

/** Spend this candidate's approved exception once the hire actually lands — audit trail + no reuse. */
export async function consumeCandidateApproval(trx: Knex.Transaction, candidateId: number, employeeId: number): Promise<void> {
  await trx('manpower_exceptions')
    .where({ candidate_id: candidateId, status: 'approved' })
    .whereNull('consumed_at')
    .update({ status: 'consumed', consumed_at: trx.fn.now(), created_employee_id: employeeId, updated_at: trx.fn.now() });
}

// ─── Hires ───

async function nextEmployeeCode(trx: Knex.Transaction): Promise<string> {
  // MAX+1 generators race under MVCC: two transactions read the same max and mint the same code.
  // employees.employee_code is UNIQUE so a race could never corrupt data, but it would surface as a
  // constraint-violation 500. Serialising here turns that into a short wait instead.
  await advisoryXactLock(trx, LOCK.EMPLOYEE_CODE);
  const rows = await trx('employees').where('employee_code', 'like', 'MH-%').select('employee_code');
  let max = 0;
  for (const r of rows) {
    const m = /MH-(\d+)/.exec(r.employee_code);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `MH-${String(max + 1).padStart(4, '0')}`;
}

interface HireInput {
  name: string;
  property_id: number;
  job_title_id: number;
  monthly_ctc?: number;
  email?: string;
  phone?: string;
  dept_name?: string;
  date_of_joining?: string;
  reporting_manager_id?: number;
}

async function insertHire(trx: Knex.Transaction, input: HireInput, ctc: number, a: Availability, actor: JwtPayload | undefined, approved: boolean): Promise<number> {
  const parts = String(input.name).trim().split(/\s+/);
  const firstName = parts[0] || input.name;
  const lastName = parts.slice(1).join(' ') || '';
  const code = await nextEmployeeCode(trx);
  const overBand = round2(ctc - a.band_max);
  const doj = input.date_of_joining || today();

  const [{ id: employeeId }] = await trx('employees').insert({
    employee_code: code,
    job_id: await nextJobId(trx),
    leave_template_id: await getDefaultTemplateId(), // new hires land on the Default leave template

    first_name: firstName,
    last_name: lastName,
    email: input.email || null,
    phone: input.phone || null,
    job_title_id: input.job_title_id,
    dept_name: input.dept_name || null,
    branch_name: a.property_name,
    reporting_manager_id: input.reporting_manager_id || null,
    date_of_joining: doj,
    monthly_ctc: ctc,
    employment_status: 'active',
    is_active: true,
    created_by_user_id: actor?.userId || null,
    approved_by_user_id: approved ? (actor?.userId || null) : null,
    sanction_variance: overBand > 0 ? overBand : 0,
  }).returning('id');

  await trx('employee_status_history').insert({
    employee_id: employeeId,
    from_status: null,
    to_status: 'active',
    monthly_ctc: ctc,
    effective_date: doj,
    reason: approved ? 'Hired via approved exception' : 'Direct hire (within sanction)',
    changed_by: actor?.userId || null,
  });

  return employeeId;
}

export async function createHire(input: HireInput, user: JwtPayload) {
  if (!input.name?.trim()) throw new ValidationError('Candidate name is required.');
  if (!input.property_id || !input.job_title_id) throw new ValidationError('Property and role are required.');
  const ctc = Number(input.monthly_ctc);
  if (!ctc || ctc <= 0) throw new ValidationError('A valid monthly CTC is required.');
  await assertPropertyInScope(user, input.property_id);

  return db.transaction(async (trx) => {
    // Serialise hires competing for the same property's budget/headcount. PostgreSQL is MVCC, so
    // without this lock two HRs racing for the last slot would each read the pre-hire availability,
    // both pass the guardrail, and both insert — overshooting the sanctioned budget/headcount.
    // (Under SQLite the single-writer rule made this safe implicitly.)
    await advisoryXactLock(trx, LOCK.HIRE_BUDGET, input.property_id);

    // Recompute + enforce INSIDE the transaction, now that we hold the lock (the single gate).
    const a = await assertHireAllowed(input.property_id, input.job_title_id, ctc, trx);
    const employeeId = await insertHire(trx, input, ctc, a, user, false);
    return getHire(employeeId, trx);
  });
}

export async function getHire(employeeId: number, trx?: Knex.Transaction) {
  const cx = trx || db;
  const emp = await cx('employees as e')
    .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
    .leftJoin('employees as mgr', 'mgr.id', 'e.reporting_manager_id')
    .leftJoin('users as cu', 'cu.id', 'e.created_by_user_id')
    .leftJoin('users as au', 'au.id', 'e.approved_by_user_id')
    .where('e.id', employeeId)
    .select(
      'e.*',
      'jt.title as job_title',
      cx.raw("NULLIF(TRIM(COALESCE(mgr.first_name,'') || ' ' || COALESCE(mgr.last_name,'')), '') as reporting_manager_name"),
      'cu.email as created_by_email',
      'au.email as approved_by_email'
    )
    .first();
  if (!emp) throw new NotFoundError('Employee');
  return emp;
}

// ─── Employee status lifecycle ───

export async function listEmployees(filters: { property_id?: number; job_title_id?: number; status?: string; search?: string }, user: JwtPayload) {
  const scope = await getScope(user);
  const q = db('employees as e')
    .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
    .leftJoin('properties as p', 'p.name', 'e.branch_name')
    .leftJoin('clusters as c', 'c.id', 'p.cluster_id')
    .select(
      'e.id', 'e.job_id', 'e.employee_code', 'e.first_name', 'e.last_name', 'e.email', 'e.phone',
      'e.branch_name', 'e.dept_name', 'e.job_title_id', 'jt.title as job_title',
      'e.employment_status', 'e.monthly_ctc', 'e.last_working_day', 'e.pip_start_date',
      'e.pip_end_date', 'e.open_to_backfill', 'e.date_of_joining', 'e.sanction_variance',
      'p.id as property_id', 'c.name as cluster_name'
    )
    .orderBy('e.branch_name')
    .orderBy('jt.title');

  if (!scope.all) q.whereIn('e.branch_name', scope.propertyNames.length ? scope.propertyNames : ['__none__']);
  if (filters.property_id) q.where('p.id', filters.property_id);
  if (filters.job_title_id) q.where('e.job_title_id', filters.job_title_id);
  if (filters.status) q.where('e.employment_status', filters.status);
  if (filters.search) {
    q.where(function () {
      this.where('e.first_name', 'ilike', `%${filters.search}%`)
        .orWhere('e.last_name', 'ilike', `%${filters.search}%`)
        .orWhere('e.employee_code', 'ilike', `%${filters.search}%`);
    });
  }
  return q;
}

export async function changeStatus(employeeId: number, toStatus: string, data: { reason?: string; last_working_day?: string; pip_start_date?: string; pip_end_date?: string }, user: JwtPayload) {
  if (!EMPLOYMENT_STATUSES.includes(toStatus as EmploymentStatus)) throw new ValidationError('Invalid status.');
  const emp = await db('employees').where('id', employeeId).first();
  if (!emp) throw new NotFoundError('Employee');
  await assertEmployeeInScope(user, emp);

  const from = emp.employment_status || (emp.is_active ? 'active' : 'left');
  if (from === toStatus) throw new ValidationError(`Employee is already ${toStatus}.`);

  const patch: any = { employment_status: toStatus, status_reason: data.reason || null, updated_at: db.fn.now() };
  if (toStatus === 'pip') {
    if (!data.pip_start_date || !data.pip_end_date) throw new ValidationError('PIP requires a start date and an end date.');
    patch.pip_start_date = data.pip_start_date;
    patch.pip_end_date = data.pip_end_date;
    // Still on payroll, but the position is open to backfill so HR can hire a backup.
    patch.is_active = true; patch.open_to_backfill = true; patch.last_working_day = null;
  } else if (toStatus === 'on_notice') {
    if (!data.last_working_day) throw new ValidationError('On Notice requires a last working day.');
    patch.last_working_day = data.last_working_day;
    patch.is_active = true; patch.open_to_backfill = false;
  } else if (toStatus === 'left' || toStatus === 'absconding') {
    const label = toStatus === 'absconding' ? 'Absconding' : 'Left';
    if (!data.last_working_day) throw new ValidationError(`${label} requires a last working day.`);
    patch.last_working_day = data.last_working_day;
    patch.is_active = false; patch.open_to_backfill = true; // frees the slot + budget
  } else { // active
    patch.is_active = true; patch.open_to_backfill = false;
    patch.last_working_day = null; patch.pip_start_date = null; patch.pip_end_date = null;
  }

  await db.transaction(async (trx) => {
    await trx('employees').where('id', employeeId).update(patch);
    await trx('employee_status_history').insert({
      employee_id: employeeId,
      from_status: from,
      to_status: toStatus,
      monthly_ctc: emp.monthly_ctc,
      effective_date: today(),
      last_working_day: patch.last_working_day || null,
      reason: data.reason || null,
      changed_by: user?.userId || null,
    });
  });

  // On PIP / Left / Absconding, flag admin + HR that this JOB needs a backup.
  if (toStatus === 'pip' || DEPARTED_STATUSES.includes(toStatus)) {
    await notifyReplacementNeeded({ ...emp, employment_status: toStatus });
  }
  return getHire(employeeId);
}

/** Flags admin + HR (bell notification) that a departing / PIP employee's JOB needs a backup. */
export async function notifyReplacementNeeded(emp: any) {
  const jt = emp.job_title_id ? (await db('job_titles').where('id', emp.job_title_id).first())?.title : null;
  const who = `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || 'An employee';
  const tag = emp.job_id ? `${emp.job_id} · ` : '';
  const verb = emp.employment_status === 'pip' ? 'is on PIP'
    : emp.employment_status === 'absconding' ? 'has absconded'
    : 'is leaving';
  const payload = {
    type: 'replacement_needed',
    title: 'Replacement needed',
    message: `${who} (${tag}${jt || 'role'} @ ${emp.branch_name || 'property'}) ${verb} — raise a backfill vacancy.`,
    link: '/manpower',
  };
  await notifyRole('admin', payload);
  await notifyRole('hr', payload);
}

/** JOBs (employees) currently on PIP or Left that are open to backfill. */
export async function listReplacements(user: JwtPayload) {
  const scope = await getScope(user);
  const q = db('employees as e')
    .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
    .leftJoin('properties as p', 'p.name', 'e.branch_name')
    .leftJoin('clusters as c', 'c.id', 'p.cluster_id')
    .whereIn('e.employment_status', ['pip', 'left', 'absconding'])
    .where('e.open_to_backfill', true)
    .select(
      'e.id', 'e.job_id', 'e.employee_code', 'e.first_name', 'e.last_name',
      'e.branch_name', 'e.dept_name', 'e.job_title_id', 'jt.title as job_title',
      'e.employment_status', 'e.last_working_day', 'c.name as cluster_name'
    )
    .orderBy('e.employment_status').orderBy('e.branch_name');
  if (!scope.all) q.whereIn('e.branch_name', scope.propertyNames.length ? scope.propertyNames : ['__none__']);
  const rows = await q;

  // Which of these JOB IDs already have an open backfill vacancy?
  const jobIds = rows.map((r: any) => r.job_id).filter(Boolean);
  const openVac = jobIds.length
    ? await db('vacancies').whereIn('backfill_job_id', jobIds).whereNot('status', 'closed').select('backfill_job_id')
    : [];
  const vacSet = new Set(openVac.map((v: any) => v.backfill_job_id));

  return rows.map((r: any) => ({
    ...r,
    name: `${r.first_name} ${r.last_name}`.trim(),
    backfill_vacancy_open: vacSet.has(r.job_id),
  }));
}

export async function getStatusHistory(employeeId: number) {
  return db('employee_status_history as h')
    .leftJoin('users as u', 'u.id', 'h.changed_by')
    .where('h.employee_id', employeeId)
    .select('h.*', 'u.email as changed_by_email')
    .orderBy('h.created_at', 'desc');
}

// ─── Sanctions (Admin) ───

export async function listSanctions(filters: { property_id?: number; cluster_id?: number; job_title_id?: number }, user: JwtPayload) {
  const scope = await getScope(user);
  const q = db('manpower_sanctions as s')
    .join('properties as p', 'p.id', 's.property_id')
    .join('job_titles as jt', 'jt.id', 's.job_title_id')
    .leftJoin('clusters as c', 'c.id', 'p.cluster_id')
    .select(
      's.*', 'p.name as property_name', 'p.cluster_id', 'c.name as cluster_name', 'jt.title as job_title'
    )
    .orderBy('p.name').orderBy('jt.title');
  if (!scope.all) q.whereIn('p.name', scope.propertyNames.length ? scope.propertyNames : ['__none__']);
  if (filters.property_id) q.where('s.property_id', filters.property_id);
  if (filters.cluster_id) q.where('p.cluster_id', filters.cluster_id);
  if (filters.job_title_id) q.where('s.job_title_id', filters.job_title_id);
  const sanctions = await q;

  // One pass over non-Left employees → committed + filled per (branch, role)
  const agg = await db('employees')
    .whereNotIn('employment_status', DEPARTED_STATUSES)
    .select('branch_name', 'job_title_id')
    .sum({ committed: 'monthly_ctc' })
    .count({ cnt: '*' })
    .groupBy('branch_name', 'job_title_id');
  const aggMap = new Map<string, any>(agg.map((a: any) => [`${a.branch_name}|${a.job_title_id}`, a]));

  return sanctions.map((s: any) => {
    const m = aggMap.get(`${s.property_name}|${s.job_title_id}`);
    const committed_amount = round2(Number(m?.committed || 0));
    const filled = Number(m?.cnt || 0);
    const sanctioned_budget_monthly = Number(s.sanctioned_budget_monthly);
    const sanctioned_headcount = Number(s.sanctioned_headcount);
    const band_min = Number(s.band_min);
    const band_max = Number(s.band_max);
    const remaining_budget = round2(sanctioned_budget_monthly - committed_amount);
    const remaining_slots = sanctioned_headcount - filled;
    return {
      ...s,
      sanctioned_budget_monthly, sanctioned_headcount, band_min, band_max,
      committed_amount, filled, remaining_budget, remaining_slots,
      suggested_ctc: suggestedSalary(remaining_budget, band_max),
      utilization_pct: sanctioned_budget_monthly > 0 ? round2((committed_amount / sanctioned_budget_monthly) * 100) : 0,
      over_budget: committed_amount > sanctioned_budget_monthly,
      over_headcount: filled > sanctioned_headcount,
    };
  });
}

export async function upsertSanction(data: { property_id: number; job_title_id: number; sanctioned_headcount: number; sanctioned_budget_monthly: number; band_min: number; band_max: number; notes?: string }, user: JwtPayload) {
  if (!data.property_id || !data.job_title_id) throw new ValidationError('Property and role are required.');
  const headcount = Number(data.sanctioned_headcount);
  const budget = Number(data.sanctioned_budget_monthly);
  const bandMin = Number(data.band_min);
  const bandMax = Number(data.band_max);
  if (headcount < 0 || budget < 0 || bandMin < 0 || bandMax < 0) throw new ValidationError('Values cannot be negative.');
  if (bandMax < bandMin) throw new ValidationError('Band maximum must be greater than or equal to band minimum.');

  const existing = await db('manpower_sanctions').where({ property_id: data.property_id, job_title_id: data.job_title_id }).first();
  if (existing) {
    if (existing.is_locked) throw new ValidationError('This sanction is locked. Unlock it before editing.');
    await db('manpower_sanctions').where('id', existing.id).update({
      sanctioned_headcount: headcount, sanctioned_budget_monthly: budget,
      band_min: bandMin, band_max: bandMax, notes: data.notes ?? existing.notes,
      updated_by: user?.userId || null, updated_at: db.fn.now(),
    });
    return db('manpower_sanctions').where('id', existing.id).first();
  }
  const [{ id }] = await db('manpower_sanctions').insert({
    property_id: data.property_id, job_title_id: data.job_title_id,
    sanctioned_headcount: headcount, sanctioned_budget_monthly: budget,
    band_min: bandMin, band_max: bandMax, notes: data.notes || null,
    created_by: user?.userId || null, updated_by: user?.userId || null,
  }).returning('id');
  return db('manpower_sanctions').where('id', id).first();
}

export async function setSanctionLock(id: number, locked: boolean, user: JwtPayload) {
  const s = await db('manpower_sanctions').where('id', id).first();
  if (!s) throw new NotFoundError('Sanction');
  await db('manpower_sanctions').where('id', id).update({ is_locked: !!locked, updated_by: user?.userId || null, updated_at: db.fn.now() });
  return db('manpower_sanctions').where('id', id).first();
}

// ─── Exceptions ───

export async function getException(id: number, trx?: Knex.Transaction) {
  const cx = trx || db;
  const ex = await cx('manpower_exceptions as x')
    .join('properties as p', 'p.id', 'x.property_id')
    .join('job_titles as jt', 'jt.id', 'x.job_title_id')
    .leftJoin('users as ru', 'ru.id', 'x.requested_by')
    .leftJoin('users as rv', 'rv.id', 'x.reviewed_by')
    .where('x.id', id)
    .select('x.*', 'p.name as property_name', 'jt.title as job_title', 'ru.email as requested_by_email', 'rv.email as reviewed_by_email')
    .first();
  if (!ex) throw new NotFoundError('Exception');
  return ex;
}

export async function listExceptions(filters: { status?: string; mine?: boolean }, user: JwtPayload) {
  const scope = await getScope(user);
  const q = db('manpower_exceptions as x')
    .join('properties as p', 'p.id', 'x.property_id')
    .join('job_titles as jt', 'jt.id', 'x.job_title_id')
    .leftJoin('users as ru', 'ru.id', 'x.requested_by')
    .leftJoin('users as rv', 'rv.id', 'x.reviewed_by')
    .select('x.*', 'p.name as property_name', 'jt.title as job_title', 'ru.email as requested_by_email', 'rv.email as reviewed_by_email')
    .orderBy('x.created_at', 'desc');
  if (filters.status) q.where('x.status', filters.status);
  if (filters.mine) q.where('x.requested_by', user.userId);
  else if (!scope.all) q.whereIn('p.name', scope.propertyNames.length ? scope.propertyNames : ['__none__']);
  return q;
}

export async function createException(input: HireInput & { request_reason?: string }, user: JwtPayload) {
  if (!input.name?.trim()) throw new ValidationError('Candidate name is required.');
  await assertPropertyInScope(user, input.property_id);
  const ctc = Number(input.monthly_ctc);
  if (!ctc || ctc <= 0) throw new ValidationError('A valid monthly CTC is required.');

  const a = await computeAvailability(input.property_id, input.job_title_id);
  if (!a.property_configured) throw new ValidationError('No budget is configured for this property.');
  if (!a.band_configured) throw new ValidationError('No salary band is configured for this role at this property.');
  const block = evaluateGuardrail(a, ctc);
  if (!block) throw new ValidationError('This hire is within sanction — no exception is needed.');

  const [{ id }] = await db('manpower_exceptions').insert({
    property_id: input.property_id, job_title_id: input.job_title_id,
    requested_by: user?.userId || null, candidate_name: input.name.trim(),
    requested_ctc: ctc, exception_type: block.exception_type,
    band_min: a.band_min, band_max: a.band_max,
    sanctioned_budget_monthly: a.sanctioned_budget_monthly,
    committed_amount: a.committed_amount, remaining_budget: a.remaining_budget,
    sanctioned_headcount: a.sanctioned_headcount, non_left_headcount: a.non_left_headcount,
    suggested_ctc: a.suggested_ctc, variance_amount: block.variance_amount,
    join_date: input.date_of_joining || null, request_reason: input.request_reason || null,
    status: 'pending',
  }).returning('id');
  return getException(id);
}

export async function approveException(id: number, admin: JwtPayload, adminNote?: string) {
  return db.transaction(async (trx) => {
    // Lock the request row for the whole review so two concurrent approvals can't both pass the
    // status check — for a standalone Add-Hire exception that would mint two employees from one
    // approval (last-writer-wins on the row). Re-reads the live status inside the lock.
    const ex = await trx('manpower_exceptions').where('id', id).forUpdate().first();
    if (!ex) throw new NotFoundError('Exception');
    if (ex.status !== 'pending') throw new ValidationError(`This exception is already ${ex.status}.`);
    // maker ≠ checker: the reviewer must be someone other than the person who raised the request.
    // This is the whole point of the approval — a junior HR can't wave through their own over-limit hire.
    if (ex.requested_by != null && admin?.userId === ex.requested_by) {
      throw new ValidationError('You can’t approve your own request — a different admin must review it.');
    }

    // A recruitment-linked request is a TOKEN, not a hire: approving it lets HR release/accept the
    // offer for that candidate (the offer gate consumes it). It must NOT mint a second employee here.
    if (ex.candidate_id != null) {
      await trx('manpower_exceptions').where('id', id).update({
        status: 'approved', reviewed_by: admin?.userId || null, reviewed_at: trx.fn.now(),
        admin_note: adminNote || null, updated_at: trx.fn.now(),
      });
      return getException(id, trx);
    }

    // Standalone "Add Hire" exception: approval overrides the guardrail and creates the employee now,
    // so the request is spent in the same step (consumed_at set). Take the property budget lock so
    // this out-of-band commit serialises with every other hiring path on the same property.
    await advisoryXactLock(trx, LOCK.HIRE_BUDGET, ex.property_id);
    const a = await computeAvailability(ex.property_id, ex.job_title_id, trx);
    const employeeId = await insertHire(trx, {
      name: ex.candidate_name,
      property_id: ex.property_id,
      job_title_id: ex.job_title_id,
      date_of_joining: ex.join_date || undefined,
    }, Number(ex.requested_ctc), a, admin, true);

    await trx('manpower_exceptions').where('id', id).update({
      status: 'approved', reviewed_by: admin?.userId || null, reviewed_at: trx.fn.now(),
      admin_note: adminNote || null, created_employee_id: employeeId, consumed_at: trx.fn.now(), updated_at: trx.fn.now(),
    });
    return getException(id, trx);
  });
}

/**
 * A blocked recruitment offer raises an approval request that stays tied to its candidate. Unlike the
 * standalone Add-Hire exception, approving THIS does not mint an employee — it becomes the token the
 * offer/accept/transfer gate accepts for that candidate (see assertHireAllowed + consumeCandidateApproval).
 */
export async function createCandidateException(params: {
  candidateId: number; propertyId: number; jobTitleId: number;
  candidateName: string; monthlyCtc: number; joinDate?: string | null; reason?: string;
}, requestedBy: number): Promise<any> {
  if (!params.reason?.trim()) throw new ValidationError('A reason is required to request approval.');
  // Store the ceiling at whole-rupee resolution — the release/accept gates compare against it and
  // derive the monthly CTC by two slightly different roundings (see hasApprovedException).
  const ctc = Math.round(Number(params.monthlyCtc));
  if (!ctc || ctc <= 0) throw new ValidationError('A valid monthly CTC is required.');

  const open = await db('manpower_exceptions')
    .where('candidate_id', params.candidateId).whereIn('status', ['pending', 'approved']).whereNull('consumed_at').first();
  if (open) throw new ValidationError(`There is already a ${open.status} approval request for this candidate.`);

  const a = await computeAvailability(params.propertyId, params.jobTitleId, undefined, { excludeCandidateId: params.candidateId });
  let block: { exception_type: string; variance_amount: number } | null;
  if (!a.property_configured) block = { exception_type: 'over_budget', variance_amount: 0 };
  else if (!a.band_configured) block = { exception_type: 'over_band', variance_amount: 0 };
  else block = evaluateGuardrail(a, ctc);
  if (!block) throw new ValidationError('This hire is within sanction — no approval is needed.');

  const [{ id }] = await db('manpower_exceptions').insert({
    property_id: params.propertyId, job_title_id: params.jobTitleId,
    candidate_id: params.candidateId, requested_by: requestedBy || null,
    candidate_name: params.candidateName.trim(), requested_ctc: ctc,
    exception_type: block.exception_type,
    band_min: a.band_min, band_max: a.band_max,
    sanctioned_budget_monthly: a.sanctioned_budget_monthly,
    committed_amount: a.committed_amount, remaining_budget: a.remaining_budget,
    sanctioned_headcount: a.sanctioned_headcount, non_left_headcount: a.non_left_headcount,
    suggested_ctc: a.suggested_ctc, variance_amount: block.variance_amount,
    join_date: params.joinDate || null, request_reason: params.reason.trim(),
    status: 'pending',
  }).returning('id');
  // Surface the request to admins right away — the approval inbox is where it gets actioned.
  await notifyRole('admin', {
    type: 'hiring_approval_requested',
    title: 'Over-limit hire needs approval',
    message: `${params.candidateName.trim()} at ₹${ctc.toLocaleString('en-IN')}/mo is over the sanctioned limit and is waiting for review.`,
    link: '/admin/approvals',
  });
  return getException(id);
}

export async function rejectException(id: number, admin: JwtPayload, adminNote?: string) {
  const ex = await db('manpower_exceptions').where('id', id).first();
  if (!ex) throw new NotFoundError('Exception');
  if (ex.status !== 'pending') throw new ValidationError(`This exception is already ${ex.status}.`);
  await db('manpower_exceptions').where('id', id).update({
    status: 'rejected', reviewed_by: admin?.userId || null, reviewed_at: db.fn.now(),
    admin_note: adminNote || null, updated_at: db.fn.now(),
  });
  return getException(id);
}

// ─── Clusters + assignments (Admin) ───

export async function listClusters() {
  const clusters = await db('clusters').select('*').orderBy('name');
  const props = await db('properties').select('id', 'name', 'cluster_id', 'city', 'state');
  return clusters.map((c: any) => ({ ...c, properties: props.filter((p: any) => p.cluster_id === c.id) }));
}

export async function upsertCluster(data: { id?: number; name: string; description?: string }) {
  if (!data.name?.trim()) throw new ValidationError('Cluster name is required.');
  if (data.id) {
    await db('clusters').where('id', data.id).update({ name: data.name.trim(), description: data.description ?? null, updated_at: db.fn.now() });
    return db('clusters').where('id', data.id).first();
  }
  const [{ id }] = await db('clusters').insert({ name: data.name.trim(), description: data.description || null }).returning('id');
  return db('clusters').where('id', id).first();
}

export async function setPropertyCluster(propertyId: number, clusterId: number | null) {
  const p = await db('properties').where('id', propertyId).first();
  if (!p) throw new NotFoundError('Property');
  await db('properties').where('id', propertyId).update({ cluster_id: clusterId || null, updated_at: db.fn.now() });
  return db('properties').where('id', propertyId).first();
}

export async function listClusterHrUsers() {
  return db('users as u')
    .join('roles as r', 'r.id', 'u.role_id')
    .leftJoin('employees as e', 'e.id', 'u.employee_id')
    .where('r.name', 'cluster_hr')
    .select('u.id', 'u.email', db.raw("NULLIF(TRIM(COALESCE(e.first_name,'') || ' ' || COALESCE(e.last_name,'')), '') as name"));
}

export async function getUserClusters(userId: number) {
  return db('user_clusters as uc').join('clusters as c', 'c.id', 'uc.cluster_id')
    .where('uc.user_id', userId).select('c.id', 'c.name');
}

export async function setUserClusters(userId: number, clusterIds: number[]) {
  const user = await db('users').where('id', userId).first();
  if (!user) throw new NotFoundError('User');
  await db.transaction(async (trx) => {
    await trx('user_clusters').where('user_id', userId).del();
    if (clusterIds.length) {
      await trx('user_clusters').insert(clusterIds.map((cid) => ({ user_id: userId, cluster_id: cid })));
    }
  });
  return getUserClusters(userId);
}

// Properties the current user may hire into (scoped); used by the Add-Hire form.
export async function listScopedProperties(user: JwtPayload) {
  const scope = await getScope(user);
  const q = db('properties as p').leftJoin('clusters as c', 'c.id', 'p.cluster_id')
    .select('p.id', 'p.name', 'p.city', 'p.state', 'p.cluster_id', 'c.name as cluster_name')
    .orderBy('p.name');
  if (!scope.all) q.whereIn('p.id', scope.propertyIds.length ? scope.propertyIds : [-1]);
  return q;
}

// ─── Property-level budgets (one row per property; the Manpower module table) ───

export async function listPropertyBudgets(filters: { cluster_id?: number }, user: JwtPayload) {
  const scope = await getScope(user);
  const propsQ = db('properties as p').leftJoin('clusters as c', 'c.id', 'p.cluster_id')
    .select('p.id', 'p.name', 'p.cluster_id', 'c.name as cluster_name').orderBy('p.name');
  if (!scope.all) propsQ.whereIn('p.id', scope.propertyIds.length ? scope.propertyIds : [-1]);
  if (filters.cluster_id) propsQ.where('p.cluster_id', filters.cluster_id);
  const props = await propsQ;

  const explicits = await db('manpower_property_budgets').select('property_id', 'sanctioned_budget_monthly', 'sanctioned_headcount');
  const expMap = new Map<number, any>(explicits.map((e: any) => [e.property_id, e]));
  const rolls = await db('manpower_sanctions').select('property_id').sum({ budget: 'sanctioned_budget_monthly' }).sum({ head: 'sanctioned_headcount' }).count({ roles: '*' }).groupBy('property_id');
  const rollMap = new Map<number, any>(rolls.map((r: any) => [r.property_id, r]));

  // Committed money = Σ of KEYED salaries (SUM ignores NULLs); headcount = ALL non-departed
  // staff (a hired body holds a sanctioned slot even before its salary is entered); missing =
  // of those, how many have no salary yet — the cost not yet in committed. Matches
  // propertyCommitment so the tab and the hiring guardrail agree.
  const commits = await db('employees').whereNotIn('employment_status', DEPARTED_STATUSES)
    .select('branch_name')
    .sum({ committed: 'monthly_ctc' })
    .count({ cnt: '*' })
    .select(db.raw('COUNT(*) FILTER (WHERE monthly_ctc IS NULL) as missing'))
    .groupBy('branch_name');
  const commitMap = new Map<string, any>(commits.map((c: any) => [c.branch_name, c]));

  // PIP positions are backfillable — the hiring guardrail credits back a slot + that person's
  // salary so HR can line up a backup (computeAvailability). Surface the same allowance here so
  // this tab agrees with what Add-Hire actually permits instead of reading "0 open / over budget".
  // Slot credit counts every PIP body (matches propertyPipBackfill); SUM ignores NULL salaries.
  const pips = await db('employees').where('employment_status', 'pip')
    .select('branch_name').sum({ budget: 'monthly_ctc' }).count({ cnt: '*' }).groupBy('branch_name');
  const pipMap = new Map<string, any>(pips.map((p: any) => [p.branch_name, p]));

  // Reservations (mirror propertyReservations so the tab agrees with the hiring guardrail):
  // reserved SLOTS = issued offers whose body doesn't exist yet; reserved BUDGET = any offer whose
  // cost hasn't landed in committed (issued, or accepted-but-not-yet-activated with null monthly_ctc).
  const resSlots = await db('offer_letters as ol')
    .join('candidates as c', 'c.id', 'ol.candidate_id').join('vacancies as v', 'v.id', 'c.vacancy_id')
    .where('ol.status', 'issued').whereNull('c.employee_id')
    .select('v.property_id').count({ cnt: '*' }).groupBy('v.property_id');
  const resSlotMap = new Map<number, number>(resSlots.map((r: any) => [r.property_id, Number(r.cnt || 0)]));
  const resBudget = await db('offer_letters as ol')
    .join('candidates as c', 'c.id', 'ol.candidate_id').join('vacancies as v', 'v.id', 'c.vacancy_id')
    .leftJoin('employees as e', 'e.id', 'c.employee_id')
    .whereIn('ol.status', ['issued', 'accepted'])
    .where(function (this: Knex.QueryBuilder) { this.whereNull('c.employee_id').orWhereNull('e.monthly_ctc'); })
    .select('v.property_id').sum({ annual: 'ol.offered_ctc' }).groupBy('v.property_id');
  const resBudgetMap = new Map<number, number>(resBudget.map((r: any) => [r.property_id, round2(Number(r.annual || 0) / 12)]));

  // Admin-set per-department sanctioned worker limits, summed per property.
  const deptSanctions = await db('property_department_workers').select('property_id').sum({ workers: 'worker_count' }).groupBy('property_id');
  const deptSanctionMap = new Map<number, number>(deptSanctions.map((r: any) => [r.property_id, Number(r.workers || 0)]));

  return props.map((p: any) => {
    const exp = expMap.get(p.id);
    const roll = rollMap.get(p.id);
    const hasExplicit = !!exp;
    const rolledBudget = round2(Number(roll?.budget || 0));
    const rolledHead = Number(roll?.head || 0);
    const sanctioned_budget_monthly = hasExplicit ? Number(exp.sanctioned_budget_monthly) : rolledBudget;
    const sanctioned_headcount = hasExplicit ? Number(exp.sanctioned_headcount) : rolledHead;

    const cm = commitMap.get(p.name);
    const committed_amount = round2(Number(cm?.committed || 0));
    const filled_headcount = Number(cm?.cnt || 0);            // ALL non-departed staff
    const missing_salary_count = Number(cm?.missing || 0);    // of which, salary not yet keyed

    const reserved_slots = resSlotMap.get(p.id) || 0;
    const reserved_budget = resBudgetMap.get(p.id) || 0;
    // Free = sanctioned minus what's spent (committed) AND promised (pending offers).
    const remaining_budget = round2(sanctioned_budget_monthly - committed_amount - reserved_budget);
    const remaining_slots = sanctioned_headcount - filled_headcount - reserved_slots;

    const pip = pipMap.get(p.name);
    const pip_backfill_slots = Number(pip?.cnt || 0);
    const pip_backfill_budget = round2(Number(pip?.budget || 0));

    const total_sanctioned_workers = deptSanctionMap.get(p.id) || 0;
    return {
      property_id: p.id, property_name: p.name, cluster_id: p.cluster_id, cluster_name: p.cluster_name,
      source: hasExplicit ? 'explicit' : 'rolled_up',
      configured: hasExplicit || rolledBudget > 0 || rolledHead > 0,
      role_lines: Number(roll?.roles || 0),
      sanctioned_budget_monthly, sanctioned_headcount,
      committed_amount, filled_headcount, missing_salary_count,
      reserved_budget, reserved_slots,
      remaining_budget, remaining_slots,
      // What Add-Hire actually allows once PIP backfill is credited (matches the guardrail).
      pip_backfill_slots, pip_backfill_budget,
      hireable_remaining_slots: remaining_slots + pip_backfill_slots,
      hireable_remaining_budget: round2(remaining_budget + pip_backfill_budget),
      utilization_pct: sanctioned_budget_monthly > 0 ? round2((committed_amount / sanctioned_budget_monthly) * 100) : 0,
      over_budget: committed_amount > sanctioned_budget_monthly,
      over_headcount: filled_headcount > sanctioned_headcount,
      // worker_count == filled_headcount now (both are all non-departed staff). The dept limit
      // (Σ per-department sanctioned workers) is a SEPARATE, softer cap the console surfaces.
      worker_count: filled_headcount, total_sanctioned_workers,
      over_worker_limit: total_sanctioned_workers > 0 && filled_headcount > total_sanctioned_workers,
      // Soft reconciliation flags (display-only): the three "sanctioned" sources disagreeing.
      rolled_budget: rolledBudget, rolled_headcount: rolledHead,
      explicit_overrides_roles: hasExplicit && (rolledBudget > 0 || rolledHead > 0)
        && (rolledBudget !== sanctioned_budget_monthly || rolledHead !== sanctioned_headcount),
      workers_vs_headcount_mismatch: total_sanctioned_workers > 0 && total_sanctioned_workers !== sanctioned_headcount,
    };
  });
}

export async function upsertPropertyBudget(propertyId: number, data: { sanctioned_budget_monthly: number; sanctioned_headcount: number; notes?: string }, user: JwtPayload) {
  const property = await db('properties').where('id', propertyId).first();
  if (!property) throw new NotFoundError('Property');
  const budget = Number(data.sanctioned_budget_monthly);
  const head = Number(data.sanctioned_headcount);
  if (budget < 0 || head < 0) throw new ValidationError('Values cannot be negative.');

  const existing = await db('manpower_property_budgets').where('property_id', propertyId).first();
  if (existing) {
    await db('manpower_property_budgets').where('id', existing.id).update({
      sanctioned_budget_monthly: budget, sanctioned_headcount: head,
      notes: data.notes ?? existing.notes, updated_by: user?.userId || null, updated_at: db.fn.now(),
    });
  } else {
    await db('manpower_property_budgets').insert({
      property_id: propertyId, sanctioned_budget_monthly: budget, sanctioned_headcount: head,
      notes: data.notes || null, created_by: user?.userId || null, updated_by: user?.userId || null,
    });
  }
  return computePropertyBudget(propertyId);
}

/**
 * Committed spend + headcount for staff whose branch_name matches NO property (renamed,
 * typo'd, or blank) — money and bodies that would otherwise silently vanish from every
 * property row. Admin-scope only (a cluster user has no global orphan view); zeros otherwise.
 */
export async function unassignedCommitment(user: JwtPayload | undefined) {
  const scope = await getScope(user);
  if (!scope.all) return { count: 0, committed: 0, missing_salary: 0, employees: [] as any[] };
  const propNames: string[] = await db('properties').pluck('name');
  const employees = await db('employees as e')
    .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
    .whereNotIn('e.employment_status', DEPARTED_STATUSES)
    .where(function (this: Knex.QueryBuilder) {
      this.whereNull('e.branch_name').orWhere('e.branch_name', '')
        .orWhereNotIn('e.branch_name', propNames.length ? propNames : ['__none__']);
    })
    .select('e.id', 'e.employee_code', 'e.first_name', 'e.last_name', 'e.branch_name',
      'e.monthly_ctc', 'e.employment_status', 'jt.title as designation')
    .orderBy('e.first_name');
  const committed = round2(employees.reduce((s: number, r: any) => s + (Number(r.monthly_ctc) || 0), 0));
  const missing_salary = employees.filter((r: any) => r.monthly_ctc == null).length;
  return { count: employees.length, committed, missing_salary, employees };
}

/** The employees that make up a property's Committed figure (the drill-in). */
export async function propertyCommittedBreakdown(propertyId: number, user: JwtPayload | undefined) {
  const property = await db('properties').where('id', propertyId).first();
  if (!property) throw new NotFoundError('Property');
  await assertPropertyInScope(user, propertyId);
  return db('employees as e')
    .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
    .where('e.branch_name', property.name)
    .whereNotIn('e.employment_status', DEPARTED_STATUSES)
    .select('e.id', 'e.employee_code', 'e.first_name', 'e.last_name', 'e.monthly_ctc',
      'e.employment_status', 'jt.title as designation')
    .orderByRaw('e.monthly_ctc DESC NULLS LAST');
}

// Set just the salary band for a property × role (used by the band drill-down).
export async function upsertSanctionBand(propertyId: number, jobTitleId: number, bandMin: number, bandMax: number, user: JwtPayload) {
  const min = Number(bandMin), max = Number(bandMax);
  if (min < 0 || max < 0) throw new ValidationError('Band values cannot be negative.');
  if (max < min) throw new ValidationError('Band maximum must be greater than or equal to band minimum.');
  const existing = await db('manpower_sanctions').where({ property_id: propertyId, job_title_id: jobTitleId }).first();
  if (existing) {
    if (existing.is_locked) throw new ValidationError('This role band is locked. Unlock it before editing.');
    await db('manpower_sanctions').where('id', existing.id).update({ band_min: min, band_max: max, updated_by: user?.userId || null, updated_at: db.fn.now() });
  } else {
    await db('manpower_sanctions').insert({
      property_id: propertyId, job_title_id: jobTitleId, sanctioned_headcount: 0, sanctioned_budget_monthly: 0,
      band_min: min, band_max: max, created_by: user?.userId || null, updated_by: user?.userId || null,
    });
  }
  return db('manpower_sanctions').where({ property_id: propertyId, job_title_id: jobTitleId }).first();
}

// ─── Admin property console (city → property configuration) ───

/**
 * Full per-property picture for the Admin Property Configuration console:
 * manpower budget + sanctioned count, per-department worker counts & spend,
 * org totals/averages, and the employee roster with salary + work status.
 * Workers/spend count non-Left staff; the roster lists everyone (incl. Left).
 */
export async function getPropertyConsole(propertyId: number) {
  const pb = await computePropertyBudget(propertyId);
  const emps = await db('employees as e')
    .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
    .where('e.branch_name', pb.property_name)
    .select(
      'e.id', 'e.job_id', 'e.employee_code', 'e.first_name', 'e.last_name', 'e.dept_name',
      'jt.title as job_title', 'e.monthly_ctc', 'e.employment_status',
      'e.last_working_day', 'e.pip_start_date', 'e.pip_end_date'
    )
    .orderBy('e.dept_name').orderBy('e.first_name');

  // Seed with the canonical department list (Organisation is the single source of
  // truth) so every department — including those with no staff at this property —
  // is visible and stays in sync with changes made in Admin → Organisation.
  const canonicalDepts = await db('departments').select('name').orderBy('name');
  const deptMap = new Map<string, { dept_name: string; actual_workers: number; spend: number; salaried: number }>();
  for (const d of canonicalDepts as any[]) deptMap.set(d.name, { dept_name: d.name, actual_workers: 0, spend: 0, salaried: 0 });

  // Admin-set manual worker counts per department (the editable "No. of Workers").
  const manualRows = await db('property_department_workers').where('property_id', propertyId).select('department', 'worker_count');
  const manualMap = new Map<string, number>(manualRows.map((r: any) => [r.department, Number(r.worker_count)]));
  for (const dept of manualMap.keys()) if (!deptMap.has(dept)) deptMap.set(dept, { dept_name: dept, actual_workers: 0, spend: 0, salaried: 0 });

  // Real pay for the spend/average: each employee's actual monthly CTC from their
  // salary structure (the Salary Details figure), falling back to the manpower
  // `monthly_ctc` planning field. Most staff have no monthly_ctc, so without this the
  // console would report ₹0 spend for fully-staffed properties.
  const ctcMap = await getMonthlyCtcMap((emps as any[]).map((e) => e.id));
  const ctcFor = (e: any): number | null => {
    const structured = ctcMap.get(e.id);
    if (structured != null) return structured;
    return e.monthly_ctc != null ? Number(e.monthly_ctc) : null;
  };

  // Actual workers = non-Left headcount. Spend = Σ salaries; average is over workers
  // who actually have a salary set (so unpaid/unset rows don't drag the average to ₹0).
  let total_spend = 0, worker_count = 0, salaried = 0, on_pip = 0;
  for (const e of emps as any[]) {
    if (e.employment_status === 'pip') on_pip += 1;
    if (DEPARTED_STATUSES.includes(e.employment_status)) continue; // departed employees don't count toward workers/spend
    const dept = e.dept_name || 'Unassigned';
    if (!deptMap.has(dept)) deptMap.set(dept, { dept_name: dept, actual_workers: 0, spend: 0, salaried: 0 });
    const ctc = ctcFor(e);
    const d = deptMap.get(dept)!;
    d.actual_workers += 1; worker_count += 1;
    if (ctc != null) { d.salaried += 1; salaried += 1; d.spend = round2(d.spend + ctc); total_spend = round2(total_spend + ctc); }
  }

  let total_sanctioned_workers = 0;
  const byDepartment = Array.from(deptMap.values())
    .map(d => {
      const sanctioned = manualMap.get(d.dept_name) ?? 0;
      total_sanctioned_workers += sanctioned;
      return {
        dept_name: d.dept_name,
        sanctioned_workers: sanctioned,    // admin-set sanctioned limit (editable)
        actual_workers: d.actual_workers,  // workers currently hired (live roster)
        over_limit: sanctioned > 0 && d.actual_workers > sanctioned,
        spend: d.spend,
        avg_salary: d.salaried > 0 ? round2(d.spend / d.salaried) : 0,
      };
    })
    .sort((a, b) => b.spend - a.spend || b.actual_workers - a.actual_workers);

  return {
    property: { id: propertyId, name: pb.property_name, cluster: pb.cluster_name },
    budget: {
      sanctioned_budget_monthly: pb.sanctioned_budget_monthly,
      sanctioned_headcount: pb.sanctioned_headcount,
      // Committed/filled reflect the ACTUAL workforce and pay here (the reporting
      // view), not the monthly_ctc planning figure the hire guardrail runs on.
      committed: total_spend,
      remaining: round2(pb.sanctioned_budget_monthly - total_spend),
      filled: worker_count,
      configured: pb.configured,
    },
    totals: {
      total_spend,                          // monthly spend (Σ salaries)
      total_spend_yearly: round2(total_spend * 12),
      worker_count,                         // workers currently hired (live headcount)
      total_sanctioned_workers,             // Σ of the admin-set per-department sanctioned limits
      on_pip,
      avg_salary: salaried > 0 ? round2(total_spend / salaried) : 0,
    },
    byDepartment,
    employees: (emps as any[]).map(e => {
      const ctc = ctcFor(e);
      return {
        id: e.id, job_id: e.job_id, employee_code: e.employee_code, name: `${e.first_name} ${e.last_name}`.trim(),
        dept_name: e.dept_name || 'Unassigned', job_title: e.job_title,
        monthly_ctc: ctc != null ? Math.round(ctc) : null,
        employment_status: e.employment_status, last_working_day: e.last_working_day,
      };
    }),
  };
}

// Upsert the admin-set worker count for a property × department.
export async function setDepartmentWorkers(propertyId: number, department: string, workerCount: number) {
  const property = await db('properties').where('id', propertyId).first();
  if (!property) throw new NotFoundError('Property');
  const dept = String(department || '').trim();
  if (!dept) throw new ValidationError('Department is required.');
  const count = Number(workerCount);
  if (isNaN(count) || count < 0) throw new ValidationError('Enter a valid worker count.');

  const existing = await db('property_department_workers').where({ property_id: propertyId, department: dept }).first();
  if (existing) {
    await db('property_department_workers').where('id', existing.id).update({ worker_count: count, updated_at: db.fn.now() });
  } else {
    await db('property_department_workers').insert({ property_id: propertyId, department: dept, worker_count: count });
  }
  return { property_id: propertyId, department: dept, worker_count: count };
}

// ─── Recruitment integration: vacancy headcount + salary-band checks ───

export interface RoleBand { configured: boolean; band_min: number; band_max: number; pay_grade_name?: string | null; }

/**
 * A role's salary band, from its pay grade.
 *
 * Takes no property: the band is one per role for the whole company. It used to be
 * per property × role out of `manpower_sanctions`, which meant the same job could
 * carry a different ceiling at each hotel — or, far more often, none at all,
 * because a cap had to be typed in per property before it bound anything.
 */
export async function getRoleBand(jobTitleId: number): Promise<RoleBand> {
  const r = await db('job_titles as jt')
    .leftJoin('pay_grades as pg', 'pg.id', 'jt.pay_grade_id')
    .where('jt.id', jobTitleId)
    .select('jt.pay_grade_id', 'pg.name as pay_grade_name', 'pg.min_salary', 'pg.max_salary')
    .first();
  const band_max = Number(r?.max_salary) || 0;
  const band_min = Number(r?.min_salary) || 0;
  return {
    configured: !!r?.pay_grade_id && band_max > 0,
    band_min,
    band_max,
    pay_grade_name: r?.pay_grade_name ?? null,
  };
}

/**
 * The salary band governing an employee, i.e. their role's pay grade. No longer needs
 * their property — the band is global — so an employee at a property that isn't in the
 * `properties` table is no longer silently unbanded.
 */
export async function getBandForEmployee(employeeId: number): Promise<RoleBand> {
  const emp = await db('employees').where('id', employeeId).select('job_title_id').first();
  if (!emp?.job_title_id) return { configured: false, band_min: 0, band_max: 0, pay_grade_name: null };
  return getRoleBand(emp.job_title_id);
}

/**
 * Hiring capacity + band for a property × role, used to gate vacancy creation.
 * capacity_remaining = sanctioned headcount − current employees − unfilled open
 * vacancy positions (so you can't keep posting beyond the sanction).
 */
export async function getVacancySanctionContext(propertyId: number, jobTitleId: number) {
  const pb = await computePropertyBudget(propertyId);
  const openVacs = await db('vacancies').where('property_id', propertyId).whereIn('status', LIVE_VACANCY_STATUSES).select('positions', 'filled');
  const open_vacancy_demand = openVacs.reduce((s: number, v: any) => s + Math.max(0, Number(v.positions || 0) - Number(v.filled || 0)), 0);
  const band = await getRoleBand(jobTitleId);
  // Each PIP employee frees a backup slot (their position is backfillable).
  const pip = await propertyPipBackfill(db, pb.property_name);
  return {
    property_configured: pb.configured,
    property_name: pb.property_name,
    sanctioned_headcount: pb.sanctioned_headcount,
    filled_headcount: pb.filled_headcount,
    open_vacancy_demand,
    pip_backfill: pip.count,
    capacity_remaining: pb.sanctioned_headcount - pb.filled_headcount - open_vacancy_demand + pip.count,
    band_configured: band.configured,
    band_min: band.band_min,
    band_max: band.band_max,
  };
}
