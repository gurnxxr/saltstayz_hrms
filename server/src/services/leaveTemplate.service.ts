import type { Knex } from 'knex';
import db from '../config/database';
import { NotFoundError, ValidationError } from '../utils/errors';

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
  /** cannot-club-with leave_type_ids — only loaded by getEmployeeLeaveRule (the apply gate). */
  conflicts?: number[];
}

const BOOL = (v: any) => v === true || v === 1 || v === '1' || v === 'true';

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
  };
}

/** The per-leave-type setting columns shared by leave_types and leave_template_rows. */
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
  return templates.map((t: any) => ({
    id: t.id, name: t.name, is_default: !!t.is_default, is_active: !!t.is_active,
    row_count: rc.get(t.id) ?? 0,
    employee_count: (ec.get(t.id) ?? 0) + (t.id === defaultId ? nullCount : 0),
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
  return {
    id: t.id, name: t.name, is_default: !!t.is_default, is_active: !!t.is_active,
    rows: rows.map((r: any) => ({
      leave_type_id: r.leave_type_id, leave_type_name: r.leave_type_name,
      default_days: Number(r.default_days) || 0, is_paid: !!r.is_paid, is_encashable: !!r.is_encashable,
      min_days_per_request: r.min_days_per_request, max_days_per_request: r.max_days_per_request,
      advance_notice_days: r.advance_notice_days, half_day_allowed: !!r.half_day_allowed,
      document_required_after_days: r.document_required_after_days, eligibility: r.eligibility,
      after_probation_only: !!r.after_probation_only, count_sandwich_days: !!r.count_sandwich_days,
      cannot_club_with: (byRow.get(r.id) ?? []).sort((a, b) => a - b),
    })),
  };
}

interface TemplateInput { name: string; is_active: boolean; rows: any[]; }
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
  return { name, is_active: data.is_active === undefined ? true : !!data.is_active, rows };
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

export async function createTemplate(data: any) {
  const input = await validateTemplateInput(data);
  try {
    const id = await db.transaction(async (trx) => {
      const [{ id: tId }] = await trx('leave_templates').insert({ name: input.name, is_default: false, is_active: input.is_active }).returning('id');
      await writeRows(trx, tId, input.rows);
      return tId;
    });
    return getTemplate(id);
  } catch (e) { rethrowDuplicate(e); }
}

export async function updateTemplate(id: number, data: any) {
  const t = await db('leave_templates').where('id', id).first();
  if (!t) throw new NotFoundError('Leave template');
  const input = await validateTemplateInput(data, id);
  try {
    await db.transaction(async (trx) => {
      // The Default template is the NULL fallback and every new hire's plan — it can be
      // renamed but never deactivated, or the resolver would keep using an "inactive" plan.
      await trx('leave_templates').where('id', id).update({ name: input.name, is_active: t.is_default ? true : input.is_active, updated_at: trx.fn.now() });
      // Editing replaces the rows wholesale — the change applies to everyone on this template
      // going forward; leave already taken/approved is untouched (it lives in leave_requests /
      // leave_entitlements, not here).
      await trx('leave_template_rows').where('template_id', id).del(); // conflicts cascade
      await writeRows(trx, id, input.rows);
    });
    return getTemplate(id);
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
      'jt.title as designation', 'e.leave_template_id', 't.name as template_name', 't.is_default as template_is_default')
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
