import type { Knex } from 'knex';
import db from '../config/database';
import { NotFoundError, ValidationError } from '../utils/errors';
import { parseOffDayRules, rulesInForceOn, type OffDayRule } from './shiftPattern';
// paySchedule imports only ../config/database and ../utils/errors, so this is not a cycle.
import { getPaySchedule } from './paySchedule.service';

// ─────────────────────────────────────────────────────────────────────────────
// Leave Templates — the single resolver every leave read path uses to get an
// employee's effective per-leave-type rules from their ASSIGNED template
// (employees.leave_template_id; NULL falls back to the Default template).
//
// A leave type only has a rule for an employee if their template includes it —
// "a type left out of a template means that employee doesn't get that leave."
// This module has no dependencies on leave.service / payableDays, so importing it
// from either creates no cycle.
// ─────────────────────────────────────────────────────────────────────────────

/** The full per-leave-type rule set carried on a template row (mirrors leave_types). */
export interface LeaveRule {
  leave_type_id: number;
  default_days: number;
  is_paid: boolean;
  is_encashable: boolean;
  min_days_per_request: number | null;
  max_days_per_request: number | null;
  advance_notice_days: number | null;
  half_day_allowed: boolean;
  document_required_after_days: number | null;
  eligibility: string;
  after_probation_only: boolean;
  count_sandwich_days: boolean;
  /**
   * Accrual (migration 034). When on, `default_days` stops being a lump sum available on day one
   * and becomes the ANNUAL figure, credited a twelfth at a time on each joining anniversary. Off
   * by default, so a template that has never been touched behaves exactly as it always did.
   */
  accrual_enabled: boolean;
  /** Completed months that earn nothing. 0 = earning starts at the first anniversary. */
  accrual_waiting_months: number;
  /** Days that survive into the next period. null = the balance lapses in full. */
  carry_forward_max: number | null;
  /** Ceiling on what one period can hold. null = no ceiling. */
  max_balance: number | null;
  /** cannot-club-with leave_type_ids — only loaded by getEmployeeLeaveRule (the apply gate). */
  conflicts?: number[];
}

const BOOL = (v: any) => v === true || v === 1 || v === '1' || v === 'true';
/** Postgres hands `numeric` back as a string, so every read of one goes through this. */
const NUM_OR_NULL = (v: any) => (v === null || v === undefined || v === '' ? null : Number(v));

function normalizeRule(r: any): LeaveRule {
  return {
    leave_type_id: r.leave_type_id,
    default_days: Number(r.default_days) || 0,
    is_paid: BOOL(r.is_paid),
    is_encashable: BOOL(r.is_encashable),
    min_days_per_request: r.min_days_per_request ?? null,
    max_days_per_request: r.max_days_per_request ?? null,
    advance_notice_days: r.advance_notice_days ?? null,
    half_day_allowed: BOOL(r.half_day_allowed),
    document_required_after_days: r.document_required_after_days ?? null,
    eligibility: r.eligibility ?? 'any',
    after_probation_only: BOOL(r.after_probation_only),
    count_sandwich_days: BOOL(r.count_sandwich_days),
    accrual_enabled: BOOL(r.accrual_enabled),
    accrual_waiting_months: Number(r.accrual_waiting_months) || 0,
    carry_forward_max: NUM_OR_NULL(r.carry_forward_max),
    max_balance: NUM_OR_NULL(r.max_balance),
  };
}

/**
 * The per-leave-type setting columns shared by leave_types and leave_template_rows.
 *
 * The four accrual columns (migration 034) are deliberately absent: `ensureDefaultTemplate` copies
 * every column named here OFF a `leave_types` row, and `leave_types` has no accrual columns to copy
 * — adding them would write `undefined` into a NOT NULL column. Accrual is a template-only setting.
 */
export const TEMPLATE_ROW_COLUMNS = [
  'default_days', 'is_paid', 'is_encashable', 'min_days_per_request', 'max_days_per_request',
  'advance_notice_days', 'half_day_allowed', 'document_required_after_days', 'eligibility',
  'after_probation_only', 'count_sandwich_days',
] as const;

let _defaultId: number | null = null;
/** The Default template's id (cached — it never changes). */
export async function getDefaultTemplateId(): Promise<number | null> {
  if (_defaultId != null) return _defaultId;
  const t = await db('leave_templates').where('is_default', true).orderBy('id').first()
    ?? await db('leave_templates').orderBy('id').first();
  if (t) _defaultId = t.id;
  return _defaultId;
}

/**
 * Reconcile the Default template so it mirrors the live leave catalogue and no active
 * employee is left without a plan. Idempotent — it only ADDS a Default row for an active
 * leave type that has none (never overwriting an admin's edits), only creates the Default
 * template when none exists, and points NULL-assigned employees at it.
 *
 * This is what keeps "Default = every active leave type" true after migration time. It is
 * called when a leave type is created or reactivated (so a new type is usable immediately,
 * not orphaned), and from the leave seed (where migrations run before any leave_types
 * exist, so the migration builds an empty Default that the seed then fills).
 */
export async function ensureDefaultTemplate(conn: Knex = db): Promise<number> {
  let t = await conn('leave_templates').where('is_default', true).orderBy('id').first();
  if (!t) {
    const [{ id }] = await conn('leave_templates')
      .insert({ name: 'Default', is_default: true, is_active: true })
      .returning('id');
    t = { id };
  }
  _defaultId = t.id;
  const activeTypes = await conn('leave_types').where('is_active', true);
  const have = new Set<number>(await conn('leave_template_rows').where('template_id', t.id).pluck('leave_type_id'));
  const missing = activeTypes.filter((lt: any) => !have.has(lt.id));
  if (missing.length) {
    await conn('leave_template_rows').insert(missing.map((lt: any) => {
      const row: Record<string, any> = { template_id: t.id, leave_type_id: lt.id };
      for (const c of TEMPLATE_ROW_COLUMNS) row[c] = lt[c];
      return row;
    }));
  }
  // Catch any active employee a fresh migrate/seed left without a template.
  await conn('employees').whereNull('leave_template_id').update({ leave_template_id: t.id });
  return t.id;
}

/** An employee's assigned template id (their own, else Default). */
export async function resolveTemplateId(employeeId: number): Promise<number | null> {
  const emp = await db('employees').where('id', employeeId).select('leave_template_id').first();
  return emp?.leave_template_id ?? (await getDefaultTemplateId());
}

// ─── Department-governed templates ───
//
// `employees.dept_name` is free text while `departments` is a catalogue, so every join between
// them is a name match. It is done case-insensitively on a trimmed value, exactly as
// leave.service's deptIdOf does — anything looser and " housekeeping " silently misses the
// department it plainly belongs to, anything stricter and the two screens disagree about who is
// in a department.
const deptKey = (name: unknown) => String(name ?? '').trim().toLowerCase();

/** Active employees whose dept_name matches any of these department names. Empty in, empty out. */
function employeesInDepartments(cx: Knex | Knex.Transaction, deptNames: string[]) {
  const keys = deptNames.map(deptKey).filter(Boolean);
  const q = cx('employees').where('is_active', true);
  if (!keys.length) return q.whereRaw('1 = 0'); // no departments = nobody, never everybody
  return q.whereRaw(`lower(trim(dept_name)) in (${keys.map(() => '?').join(',')})`, keys);
}

/**
 * The template that governs a department by name, or the Default.
 *
 * This is what makes the department rule stick for people who did not exist when it was made.
 * Every "new hires land on Default" site calls it instead, so somebody hired into Housekeeping
 * next month lands on Housekeeping's plan rather than needing an admin to remember.
 */
export async function resolveTemplateForDepartment(deptName: unknown): Promise<number | null> {
  const key = deptKey(deptName);
  if (key) {
    const row = await db('leave_template_departments as td')
      .join('departments as d', 'd.id', 'td.department_id')
      .join('leave_templates as t', 't.id', 'td.template_id')
      .whereRaw('lower(trim(d.name)) = ?', [key])
      .where('t.is_active', true)
      .select('td.template_id')
      .first();
    if (row) return row.template_id;
  }
  return getDefaultTemplateId();
}

/**
 * Every department, with how many active people are in it and which template claims it.
 *
 * One endpoint behind the whole department picker: the client needs the headcount to say what a
 * choice will cost, and the claim to grey out a department that already belongs to another plan
 * rather than letting someone pick it and be refused on save.
 */
export async function listDepartmentCoverage() {
  const [departments, claims, headcounts] = await Promise.all([
    db('departments').select('id', 'name').orderBy('name'),
    db('leave_template_departments as td')
      .join('leave_templates as t', 't.id', 'td.template_id')
      .select('td.department_id', 'td.template_id', 't.name as template_name'),
    db('employees').where('is_active', true).whereNotNull('dept_name')
      .select(db.raw('lower(trim(dept_name)) as key'), db.raw('count(id)::int as c'))
      .groupBy(db.raw('lower(trim(dept_name))')),
  ]);
  const claimBy = new Map<number, any>(claims.map((c: any) => [c.department_id, c]));
  const headBy = new Map<string, number>(headcounts.map((h: any) => [h.key, Number(h.c)]));
  return departments.map((d: any) => {
    const claim = claimBy.get(d.id);
    return {
      id: d.id,
      name: d.name,
      employee_count: headBy.get(deptKey(d.name)) ?? 0,
      template_id: claim?.template_id ?? null,
      template_name: claim?.template_name ?? null,
    };
  });
}

/**
 * Point every active employee in these departments at this template.
 *
 * Returns how many people actually MOVED, which is the number worth telling the admin — counting
 * everyone in the department would report 22 when 21 were already there and one changed plan.
 * The NULL arm matters: an unassigned employee resolves to Default at read time but stores NULL,
 * and `whereNot(col, x)` is never true for NULL in SQL, so without it the people most in need of
 * a plan would be the ones silently skipped.
 */
async function applyTemplateToDepartments(
  trx: Knex.Transaction, templateId: number, deptIds: number[],
): Promise<number> {
  if (!deptIds.length) return 0;
  const names = await trx('departments').whereIn('id', deptIds).pluck('name');
  if (!names.length) return 0;
  return employeesInDepartments(trx, names)
    .where((q: any) => q.whereNull('leave_template_id').orWhereNot('leave_template_id', templateId))
    .update({ leave_template_id: templateId });
}

/** Which days of the week an employee does not work, and the named policy that says so. */
export interface WorkWeek {
  rules: OffDayRule[];
  /** Where it came from — for the payslip and the day-by-day trace. */
  source: 'template' | 'default_template' | 'none';
  name: string | null;
}

/**
 * An employee's weekly off, from the leave template they are assigned.
 *
 * This is the axis that decides whether a day was one they were SCHEDULED to work — which is what
 * makes an unevidenced day cost pay or not. It lives here rather than on the shift because that is
 * where the business decides it, and because a shift is about what time you start: two people on
 * the same morning shift can have different days off.
 *
 * A template with no pattern of its own falls through to the Default template, and a Default with
 * none falls through to the organisation work week (the caller's job). An empty pattern always
 * means "not configured" and NEVER "works every day" — the difference is somebody's Sunday.
 */
export async function getEmployeeWorkWeek(employeeId: number, trx?: Knex.Transaction): Promise<WorkWeek> {
  const cx = trx || db;
  const emp = await cx('employees').where('id', employeeId).select('leave_template_id').first();
  if (emp?.leave_template_id) {
    const own = await cx('leave_templates').where('id', emp.leave_template_id).first();
    const rules = parseOffDayRules(own?.off_day_rules);
    if (rules.length) return { rules, source: 'template', name: own.name };
  }
  const fallback = await cx('leave_templates').where('is_default', true).first();
  const rules = parseOffDayRules(fallback?.off_day_rules);
  if (rules.length) return { rules, source: 'default_template', name: fallback.name };
  return { rules: [], source: 'none', name: null };
}


/**
 * Refuses to let someone become a paid employee with no rest day at all.
 *
 * A weekly off is not decoration: it is what makes a Sunday marked "no punch" cost nothing instead
 * of a full day's pay. It is resolved in three named rungs — the shift's own pattern, then the
 * leave template's, then the organisation work week — and an empty pattern at every rung leaves
 * someone working seven days a week, year round, from their first payslip.
 *
 * It deliberately does NOT pick a shift or invent a pattern. There is no default shift type in this
 * schema and no property-level default, so any choice made here would be a guess, and a guessed
 * off-day is a wrong salary divisor on someone's first payslip. It refuses and names the screen
 * instead — the same shape as the sanctioned-budget gate this path already carries.
 *
 * Rung 1 is clamped to assignments already in force on the joining date. A future-dated assignment
 * governs nothing on day one, so counting it would be a false pass — the gate would clear while the
 * engine still saw no off days.
 */
export async function assertHasWeeklyOff(employeeId: number, who: string, trx?: Knex.Transaction): Promise<void> {
  // Takes the transaction when there is one: createHire calls this on a row it has just inserted
  // and not yet committed, which a connection outside the transaction cannot see.
  const cx = trx || db;
  const emp = await cx('employees').where('id', employeeId).select('date_of_joining').first();
  const asOf = String(emp?.date_of_joining ?? '').slice(0, 10);
  const schedule = await getPaySchedule();

  // Both pattern rungs are asked the question the ENGINE asks, on the hire's own joining date:
  // `rulesInForceOn` is the same clamp computePayableDays applies, so a pattern that the engine
  // suppresses for that month cannot satisfy this gate. Without it the gate reads a configured
  // pattern and passes while the engine still falls through to the organisation work week — the
  // exact false pass that would let someone start with no rest day.
  const inForce = (raw: unknown) => rulesInForceOn(asOf, parseOffDayRules(raw), schedule.work_pattern_effective_from).length > 0;

  // Rung 1 — a shift already in force on the joining date that declares its own off days.
  const shiftPatterns: unknown[] = await cx('employee_shift_assignments as a')
    .join('shift_types as st', 'st.id', 'a.shift_type_id')
    .where('a.employee_id', employeeId)
    .where((q) => {
      q.whereNull('a.effective_from');
      if (asOf) q.orWhere('a.effective_from', '<=', asOf);
    })
    .pluck('st.weekly_off_days');
  if (shiftPatterns.some(inForce)) return;

  // Rung 2 — their own leave template, else the Default one.
  const workWeek = await getEmployeeWorkWeek(employeeId, trx);
  if (rulesInForceOn(asOf, workWeek.rules, schedule.work_pattern_effective_from).length > 0) return;

  // Rung 3 — the organisation work week. Fewer than seven working days still leaves rest days.
  if (schedule.work_week.length === 0) {
    throw new ValidationError(
      'The organisation work week has no working days at all, so no month can be paid. '
      + 'Set it on Payroll → Pay Schedule before transferring anyone.',
    );
  }
  if (schedule.work_week.length < 7) return;

  throw new ValidationError(
    `${who} would start with no weekly off on ${asOf || 'their joining date'}. No shift declares `
    + `off days, no leave template work week applies on that date, and the organisation work week `
    + `is all seven days — so every unmarked Sunday would cost them a full day's pay. Set the work `
    + `week on Leave → Control Panel → Templates (or move them onto a template that has one), then `
    + `transfer.${schedule.work_pattern_effective_from ? ` Note that weekly-off patterns only apply `
    + `from ${schedule.work_pattern_effective_from}, so a joining date before that is not covered.` : ''}`,
  );
}

/** All of an employee's leave rules, keyed by leave_type_id. */
export async function getEmployeeLeaveRules(employeeId: number): Promise<Map<number, LeaveRule>> {
  const templateId = await resolveTemplateId(employeeId);
  const map = new Map<number, LeaveRule>();
  if (templateId == null) return map;
  const rows = await db('leave_template_rows').where('template_id', templateId);
  for (const r of rows) map.set(r.leave_type_id, normalizeRule(r));
  return map;
}

/** One rule (+ its cannot-club-with conflicts) for an employee & leave type, or null
 *  if the employee's template doesn't include that leave type. */
export async function getEmployeeLeaveRule(employeeId: number, leaveTypeId: number): Promise<LeaveRule | null> {
  const templateId = await resolveTemplateId(employeeId);
  if (templateId == null) return null;
  const row = await db('leave_template_rows').where({ template_id: templateId, leave_type_id: leaveTypeId }).first();
  if (!row) return null;
  const rule = normalizeRule(row);
  rule.conflicts = await db('leave_template_row_conflicts').where('template_row_id', row.id).pluck('conflict_leave_type_id');
  return rule;
}

/** Batch resolver for the balances grid: employeeId → (leaveTypeId → rule). A fixed
 *  number of queries regardless of how many employees are passed in. */
export async function getTemplateRulesForEmployees(employeeIds: number[]): Promise<Map<number, Map<number, LeaveRule>>> {
  const out = new Map<number, Map<number, LeaveRule>>();
  if (!employeeIds.length) return out;
  const defaultId = await getDefaultTemplateId();
  const emps = await db('employees').whereIn('id', employeeIds).select('id', 'leave_template_id');

  const templateIdByEmp = new Map<number, number | null>();
  const templateIds = new Set<number>();
  for (const e of emps) {
    const tid = (e.leave_template_id ?? defaultId) as number | null;
    templateIdByEmp.set(e.id, tid);
    if (tid != null) templateIds.add(tid);
  }

  const rulesByTemplate = new Map<number, Map<number, LeaveRule>>();
  if (templateIds.size) {
    const rows = await db('leave_template_rows').whereIn('template_id', [...templateIds]);
    for (const r of rows) {
      const m = rulesByTemplate.get(r.template_id) ?? new Map<number, LeaveRule>();
      m.set(r.leave_type_id, normalizeRule(r));
      rulesByTemplate.set(r.template_id, m);
    }
  }

  for (const e of emps) {
    const tid = templateIdByEmp.get(e.id);
    out.set(e.id, (tid != null && rulesByTemplate.get(tid)) || new Map<number, LeaveRule>());
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin CRUD (Leave Control Panel → Templates / By Employee)
// ─────────────────────────────────────────────────────────────────────────────

const ELIGIBILITY_OPTS = ['any', 'female', 'male'];
/** Positive int, else null (blank/0 = no limit) — mirrors leave.service.policyInt. */
function policyInt(v: any): number | null {
  if (v === '' || v === null || v === undefined) return null;
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * A nullable day count for the accrual limits — unlike `policyInt`, ZERO IS A REAL VALUE here.
 *
 * `carry_forward_max: 0` means "nothing carries over"; `null` means the same thing today but reads
 * as "not configured", and the two want to stay distinguishable on screen. Running these through
 * `policyInt` would have quietly turned an explicit 0 into null, which is harmless now and would be
 * a silent behaviour change the day the two stop meaning the same thing.
 */
function limitDays(v: any, label: string): number | null {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 366) throw new ValidationError(`${label} must be between 0 and 366`);
  return Math.round(n * 100) / 100;
}
function rethrowDuplicate(e: any): never {
  if (e && e.code === '23505') throw new ValidationError('A leave template with this name already exists');
  throw e;
}

/** List templates with their row + assigned-employee counts (NULL-assigned employees count under Default). */
export async function listTemplates() {
  const templates = await db('leave_templates').orderBy([{ column: 'is_default', order: 'desc' }, { column: 'name' }]);
  const [rowCounts, empCounts, nullRow, defaultId] = await Promise.all([
    db('leave_template_rows').select('template_id').count('id as c').groupBy('template_id'),
    db('employees').whereNotNull('leave_template_id').where('is_active', true).select('leave_template_id').count('id as c').groupBy('leave_template_id'),
    db('employees').whereNull('leave_template_id').where('is_active', true).count('id as c').first(),
    getDefaultTemplateId(),
  ]);
  const rc = new Map<number, number>(rowCounts.map((r: any) => [r.template_id, Number(r.c)]));
  const ec = new Map<number, number>(empCounts.map((r: any) => [r.leave_template_id, Number(r.c)]));
  const nullCount = Number((nullRow as any)?.c ?? 0);
  // Governed departments, so the list can show what a plan covers without opening it.
  const deptRows = await db('leave_template_departments as td')
    .join('departments as d', 'd.id', 'td.department_id')
    .select('td.template_id', 'd.id', 'd.name').orderBy('d.name');
  const deptsByTemplate = new Map<number, any[]>();
  for (const r of deptRows) {
    const list = deptsByTemplate.get(r.template_id) ?? [];
    list.push({ id: r.id, name: r.name });
    deptsByTemplate.set(r.template_id, list);
  }
  return templates.map((t: any) => ({
    id: t.id, name: t.name, is_default: !!t.is_default, is_active: !!t.is_active,
    off_day_rules: parseOffDayRules(t.off_day_rules),
    row_count: rc.get(t.id) ?? 0,
    employee_count: (ec.get(t.id) ?? 0) + (t.id === defaultId ? nullCount : 0),
    departments: deptsByTemplate.get(t.id) ?? [],
  }));
}

/** One template with its rows (each row's full settings + cannot_club_with). */
export async function getTemplate(id: number) {
  const t = await db('leave_templates').where('id', id).first();
  if (!t) throw new NotFoundError('Leave template');
  const rows = await db('leave_template_rows as r')
    .join('leave_types as lt', 'lt.id', 'r.leave_type_id')
    .where('r.template_id', id)
    .select('r.*', 'lt.name as leave_type_name')
    .orderBy('lt.name');
  const rowIds = rows.map((r: any) => r.id);
  const conflicts = rowIds.length ? await db('leave_template_row_conflicts').whereIn('template_row_id', rowIds) : [];
  const byRow = new Map<number, number[]>();
  for (const c of conflicts) { const a = byRow.get(c.template_row_id) ?? []; a.push(c.conflict_leave_type_id); byRow.set(c.template_row_id, a); }
  const departments = await db('leave_template_departments as td')
    .join('departments as d', 'd.id', 'td.department_id')
    .where('td.template_id', id).select('d.id', 'd.name').orderBy('d.name');
  return {
    id: t.id, name: t.name, is_default: !!t.is_default, is_active: !!t.is_active,
    off_day_rules: parseOffDayRules(t.off_day_rules),
    departments,
    department_ids: departments.map((d: any) => d.id),
    rows: rows.map((r: any) => ({
      leave_type_id: r.leave_type_id, leave_type_name: r.leave_type_name,
      default_days: Number(r.default_days) || 0, is_paid: !!r.is_paid, is_encashable: !!r.is_encashable,
      min_days_per_request: r.min_days_per_request, max_days_per_request: r.max_days_per_request,
      advance_notice_days: r.advance_notice_days, half_day_allowed: !!r.half_day_allowed,
      document_required_after_days: r.document_required_after_days, eligibility: r.eligibility,
      after_probation_only: !!r.after_probation_only, count_sandwich_days: !!r.count_sandwich_days,
      accrual_enabled: !!r.accrual_enabled,
      accrual_waiting_months: Number(r.accrual_waiting_months) || 0,
      carry_forward_max: NUM_OR_NULL(r.carry_forward_max),
      max_balance: NUM_OR_NULL(r.max_balance),
      cannot_club_with: (byRow.get(r.id) ?? []).sort((a, b) => a - b),
    })),
  };
}

interface TemplateInput {
  name: string; is_active: boolean; rows: any[]; off_day_rules?: OffDayRule[];
  /** undefined = the caller didn't send the field, so leave the existing claims alone. */
  department_ids?: number[];
}

/**
 * Departments this template will govern, refusing any already claimed by another one.
 *
 * A department has exactly one governing template — an employee has one leave plan, so a
 * department claimed twice could not say which. The unique index enforces that regardless; this
 * exists to fail with a sentence that says what to do instead of a constraint violation.
 *
 * It deliberately does NOT steal a department from another template. Reassigning a department
 * silently rewrites the leave entitlements of everyone in it, which is not something to do as a
 * side effect of saving an unrelated plan — the admin releases it there, then claims it here.
 */
async function validateDepartmentIds(data: any, templateId?: number): Promise<number[] | undefined> {
  if (!('department_ids' in (data ?? {}))) return undefined;
  const raw: any[] = Array.isArray(data.department_ids) ? data.department_ids : [];
  const ids: number[] = [...new Set<number>(raw.map((v) => Number(v)))]
    .filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) return [];

  const known = await db('departments').whereIn('id', ids).select('id', 'name');
  if (known.length !== ids.length) throw new ValidationError('Unknown department selected');

  const clash = await db('leave_template_departments as td')
    .join('leave_templates as t', 't.id', 'td.template_id')
    .join('departments as d', 'd.id', 'td.department_id')
    .whereIn('td.department_id', ids)
    .modify((q) => { if (templateId) q.whereNot('td.template_id', templateId); })
    .select('d.name as department_name', 't.name as template_name')
    .first();
  if (clash) {
    throw new ValidationError(
      `${clash.department_name} is already governed by the "${clash.template_name}" template. `
      + 'A department can only be on one leave plan — remove it there first, then add it here.',
    );
  }
  return ids;
}

async function validateTemplateInput(data: any, excludeId?: number): Promise<TemplateInput> {
  const name = String(data.name ?? '').trim();
  if (!name) throw new ValidationError('Template name is required');
  if (name.length > 80) throw new ValidationError('Template name is too long (max 80)');
  const dup = db('leave_templates').whereRaw('lower(name) = lower(?)', [name]);
  if (excludeId) dup.whereNot('id', excludeId);
  if (await dup.first()) throw new ValidationError('A leave template with this name already exists');

  const typeSet = new Set<number>(await db('leave_types').pluck('id'));
  const seen = new Set<number>();
  const rows: any[] = [];
  for (const rr of Array.isArray(data.rows) ? data.rows : []) {
    const leaveTypeId = Number(rr.leave_type_id);
    if (!typeSet.has(leaveTypeId)) throw new ValidationError('Unknown leave type in template');
    if (seen.has(leaveTypeId)) throw new ValidationError('A leave type appears twice in the template');
    seen.add(leaveTypeId);
    const dd = Math.trunc(Number(rr.default_days));
    if (!Number.isFinite(dd) || dd < 0 || dd > 366) throw new ValidationError('Default days must be between 0 and 366');
    const min = policyInt(rr.min_days_per_request);
    const max = policyInt(rr.max_days_per_request);
    if (min != null && max != null && min > max) throw new ValidationError('Min days per request cannot exceed max days');

    // Accrual. Saving a template REPLACES its rows wholesale (see updateTemplate), so anything not
    // read here is lost on the next save — an accruing type would silently revert to a lump sum.
    const accrualEnabled = !!rr.accrual_enabled;
    const waitingMonths = Math.trunc(Number(rr.accrual_waiting_months ?? 0)) || 0;
    if (waitingMonths < 0 || waitingMonths > 120) throw new ValidationError('Waiting period must be between 0 and 120 months');
    const carryForwardMax = limitDays(rr.carry_forward_max, 'Carry forward limit');
    const maxBalance = limitDays(rr.max_balance, 'Maximum balance');
    if (accrualEnabled && dd <= 0) {
      throw new ValidationError('A type that accrues needs a positive "Days / year" — that figure is the annual rate it earns at.');
    }
    if (maxBalance != null && carryForwardMax != null && maxBalance < carryForwardMax) {
      throw new ValidationError('The maximum balance cannot be lower than the carry forward limit — the carried days would be trimmed the moment they arrived.');
    }

    rows.push({
      leave_type_id: leaveTypeId,
      default_days: dd,
      is_paid: rr.is_paid === undefined ? true : !!rr.is_paid,
      is_encashable: !!rr.is_encashable,
      min_days_per_request: min,
      max_days_per_request: max,
      advance_notice_days: policyInt(rr.advance_notice_days),
      half_day_allowed: rr.half_day_allowed === undefined ? true : !!rr.half_day_allowed,
      document_required_after_days: policyInt(rr.document_required_after_days),
      eligibility: ELIGIBILITY_OPTS.includes(rr.eligibility) ? rr.eligibility : 'any',
      after_probation_only: !!rr.after_probation_only,
      count_sandwich_days: !!rr.count_sandwich_days,
      accrual_enabled: accrualEnabled,
      accrual_waiting_months: waitingMonths,
      carry_forward_max: carryForwardMax,
      max_balance: maxBalance,
      cannot_club_with: [...new Set((rr.cannot_club_with || []).map(Number).filter((n: number) => typeSet.has(n) && n !== leaveTypeId))],
    });
  }
  if (!rows.length) throw new ValidationError('A template needs at least one leave type');
  // Clubbing is symmetric (as the old leave_type_conflicts always were): if A can't be
  // clubbed with B then B can't be clubbed with A. Mirror every edge onto the paired row so
  // enforcement doesn't depend on which leave happens to be requested first.
  const rowByType = new Map<number, any>(rows.map((r: any) => [r.leave_type_id, r]));
  for (const r of rows) {
    for (const other of r.cannot_club_with) {
      const otherRow = rowByType.get(other);
      if (otherRow && !otherRow.cannot_club_with.includes(r.leave_type_id)) {
        otherRow.cannot_club_with.push(r.leave_type_id);
      }
    }
  }
  // The work week travels with the template because that is where the business decides it.
  // Validated through the same parser the shift screen uses, so a bad day index or a
  // nonsense occurrence is rejected here rather than quietly ignored at pay time.
  const off_day_rules = 'off_day_rules' in data ? parseOffDayRules(data.off_day_rules) : undefined;
  if (off_day_rules && off_day_rules.length >= 7) {
    throw new ValidationError('A work week cannot have every day off — that would make the month unpayable.');
  }
  const department_ids = await validateDepartmentIds(data, excludeId);
  return {
    name, is_active: data.is_active === undefined ? true : !!data.is_active,
    rows, off_day_rules, department_ids,
  };
}

async function writeRows(trx: Knex.Transaction, templateId: number, rows: any[]) {
  for (const r of rows) {
    const { cannot_club_with, ...scalar } = r;
    const [{ id: rowId }] = await trx('leave_template_rows').insert({ template_id: templateId, ...scalar }).returning('id');
    if (cannot_club_with.length) {
      await trx('leave_template_row_conflicts').insert(
        cannot_club_with.map((ct: number) => ({ template_row_id: rowId, conflict_leave_type_id: ct })),
      );
    }
  }
}

/**
 * Rewrite a template's department claims and pull everyone in them onto it.
 *
 * Releasing a department does NOT move its people back off the plan. They were put on it
 * deliberately, and quietly rewriting the leave entitlements of a whole department because
 * somebody unticked a box is a bigger action than unticking a box. The screen says so, and the
 * By Employee tab is where you move them back if that is what you meant.
 */
async function syncDepartments(
  trx: Knex.Transaction, templateId: number, deptIds: number[],
): Promise<number> {
  await trx('leave_template_departments').where('template_id', templateId).del();
  if (deptIds.length) {
    await trx('leave_template_departments')
      .insert(deptIds.map((department_id) => ({ template_id: templateId, department_id })));
  }
  return applyTemplateToDepartments(trx, templateId, deptIds);
}

export async function createTemplate(data: any) {
  const input = await validateTemplateInput(data);
  try {
    const { id, applied } = await db.transaction(async (trx) => {
      const [{ id: tId }] = await trx('leave_templates').insert({
        name: input.name, is_default: false, is_active: input.is_active,
        off_day_rules: JSON.stringify(input.off_day_rules ?? []),
      }).returning('id');
      await writeRows(trx, tId, input.rows);
      const moved = input.department_ids ? await syncDepartments(trx, tId, input.department_ids) : 0;
      return { id: tId, applied: moved };
    });
    return { ...(await getTemplate(id)), employees_moved: applied };
  } catch (e) { rethrowDuplicate(e); }
}

/**
 * A copy of an existing template that differs ONLY by its work week.
 *
 * This exists because of a trap. A leave template carries a whole leave plan — entitlements,
 * paid/unpaid, notice periods, what can be clubbed with what. Splitting the workforce by work
 * week means moving people onto new templates, and a new template built from scratch would
 * silently rewrite the leave of everyone moved onto it. So the rows are copied across verbatim,
 * conflicts included, and the ONLY difference is which days of the week are not worked.
 *
 * Idempotent by name: running the rollout twice does not produce two of everything.
 */
export async function cloneTemplateWithWorkWeek(
  sourceTemplateId: number, name: string, offDayRules: OffDayRule[],
): Promise<{ id: number; name: string; created: boolean }> {
  const existing = await db('leave_templates').whereRaw('lower(name) = lower(?)', [name]).first();
  if (existing) {
    await db('leave_templates').where('id', existing.id)
      .update({ off_day_rules: JSON.stringify(offDayRules), updated_at: db.fn.now() });
    return { id: existing.id, name: existing.name, created: false };
  }
  const id = await db.transaction(async (trx) => {
    const [{ id: newId }] = await trx('leave_templates').insert({
      name, is_default: false, is_active: true, off_day_rules: JSON.stringify(offDayRules),
    }).returning('id');

    const rows = await trx('leave_template_rows').where('template_id', sourceTemplateId);
    for (const r of rows) {
      const { id: oldRowId, ...rest } = r;
      const [{ id: newRowId }] = await trx('leave_template_rows')
        .insert({ ...rest, template_id: newId }).returning('id');
      const conflicts = await trx('leave_template_row_conflicts').where('template_row_id', oldRowId);
      if (conflicts.length) {
        await trx('leave_template_row_conflicts').insert(conflicts.map((c: any) => ({
          template_row_id: newRowId, conflict_leave_type_id: c.conflict_leave_type_id,
        })));
      }
    }
    return newId;
  });
  return { id, name, created: true };
}

export async function updateTemplate(id: number, data: any) {
  const t = await db('leave_templates').where('id', id).first();
  if (!t) throw new NotFoundError('Leave template');
  const input = await validateTemplateInput(data, id);
  try {
    let applied = 0;
    await db.transaction(async (trx) => {
      // The Default template is the NULL fallback and every new hire's plan — it can be
      // renamed but never deactivated, or the resolver would keep using an "inactive" plan.
      await trx('leave_templates').where('id', id).update({
        name: input.name, is_active: t.is_default ? true : input.is_active,
        ...(input.off_day_rules ? { off_day_rules: JSON.stringify(input.off_day_rules) } : {}),
        updated_at: trx.fn.now(),
      });
      // Editing replaces the rows wholesale — the change applies to everyone on this template
      // going forward; leave already taken/approved is untouched (it lives in leave_requests /
      // leave_entitlements, not here).
      await trx('leave_template_rows').where('template_id', id).del(); // conflicts cascade
      await writeRows(trx, id, input.rows);
      // Only when the caller actually sent the field — an older client that doesn't know about
      // department governance must not have its omission read as "release every department".
      if (input.department_ids) applied = await syncDepartments(trx, id, input.department_ids);
    });
    return { ...(await getTemplate(id)), employees_moved: applied };
  } catch (e) { rethrowDuplicate(e); }
}

export async function deleteTemplate(id: number) {
  const t = await db('leave_templates').where('id', id).first();
  if (!t) throw new NotFoundError('Leave template');
  if (t.is_default) throw new ValidationError('The Default template cannot be deleted');
  const assigned = Number((await db('employees').where('leave_template_id', id).count('id as c').first() as any).c);
  if (assigned > 0) throw new ValidationError(`Reassign the ${assigned} employee(s) on this template before deleting it`);
  await db('leave_templates').where('id', id).del(); // rows + conflicts cascade
  return { id };
}

// ─── By Employee (assignment) ───

export async function listTemplateAssignments(filters: { search?: string } = {}) {
  const defaultId = await getDefaultTemplateId();
  const q = db('employees as e')
    .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
    .leftJoin('leave_templates as t', 't.id', 'e.leave_template_id')
    .where('e.is_active', true)
    .select('e.id', 'e.employee_code', 'e.first_name', 'e.last_name', 'e.branch_name', 'e.dept_name',
      'jt.title as designation', 'e.leave_template_id', 't.name as template_name',
      't.is_default as template_is_default', 't.off_day_rules as template_off_days')
    .orderBy('e.first_name');
  if (filters.search && filters.search.trim()) {
    const term = `%${filters.search.trim()}%`;
    q.where(function (this: any) {
      this.where('e.first_name', 'ilike', term).orWhere('e.last_name', 'ilike', term)
        .orWhere('e.employee_code', 'ilike', term)
        .orWhereRaw("(e.first_name || ' ' || e.last_name) ilike ?", [term]);
    });
  }
  const rows = await q;
  const defaultRow = await db('leave_templates').where('id', defaultId as number).first();
  return rows.map((r: any) => ({
    id: r.id, employee_code: r.employee_code, first_name: r.first_name, last_name: r.last_name,
    branch_name: r.branch_name, dept_name: r.dept_name, designation: r.designation,
    // NULL assignment resolves to Default (that's what the engine reads).
    leave_template_id: r.leave_template_id ?? defaultId,
    template_name: r.template_name ?? defaultRow?.name ?? 'Default',
    // The work week the engine will actually read for them, resolved the same way it is:
    // their own template, else Default. This is the column that answers "who is off when?".
    off_days: describeOffDays(parseOffDayRules(
      r.leave_template_id ? r.template_off_days : defaultRow?.off_day_rules)),
  }));
}

export async function setEmployeeTemplate(employeeId: number, templateId: number) {
  const emp = await db('employees').where('id', employeeId).first();
  if (!emp) throw new NotFoundError('Employee');
  const t = await db('leave_templates').where('id', templateId).first();
  if (!t) throw new NotFoundError('Leave template');
  if (!t.is_active) throw new ValidationError('That leave template is inactive');
  await db('employees').where('id', employeeId).update({ leave_template_id: templateId });
  return { employee_id: employeeId, leave_template_id: templateId };
}

export async function bulkAssignTemplate(employeeIds: any[], templateId: number) {
  const t = await db('leave_templates').where('id', templateId).first();
  if (!t) throw new NotFoundError('Leave template');
  if (!t.is_active) throw new ValidationError('That leave template is inactive');
  const ids = [...new Set((employeeIds || []).map(Number).filter(Boolean))];
  if (!ids.length) throw new ValidationError('Select at least one employee');
  const assigned = await db('employees').whereIn('id', ids).update({ leave_template_id: templateId });
  return { assigned, template_id: templateId };
}

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const OCCURRENCE = ['', '1st', '2nd', '3rd', '4th', '5th'];

/**
 * A work week in words: "Sun", "Sat + Sun", "Sun + 2nd & 4th Sat".
 *
 * An empty pattern is NOT "works every day" — it means nobody has configured one, and saying so
 * is the point. That distinction is the whole bug: a blank policy was being read as a seven-day
 * working week for an entire company.
 */
export function describeOffDays(rules: OffDayRule[]): string {
  if (!rules.length) return 'Not set';
  return rules
    .slice()
    .sort((a, b) => a.day - b.day)
    .map((r) => (r.weeks === null
      ? DOW_SHORT[r.day]
      : `${r.weeks.slice().sort().map((w) => OCCURRENCE[w] ?? `${w}th`).join(' & ')} ${DOW_SHORT[r.day]}`))
    .join(' + ');
}
