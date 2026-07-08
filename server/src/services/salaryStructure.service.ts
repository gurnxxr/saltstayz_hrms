import db from '../config/database';
import { NotFoundError, ValidationError } from '../utils/errors';
import {
  computeFromStructure, type StructureLineInput, type PayslipBreakdown, type LineCalcType,
  type AttendanceContext,
} from './payslip.calc';
import { getStatutoryRates, getStatutoryBonus, getEmployeeState, getMinimumWageFor, resolveStatutoryState } from './statutory.service';

// ─────────────────────────────────────────────────────────────────────────────
// Salary Structures v2: a structure is a named template of salary_components
// lines (per employee category); each employee is assigned a structure + base.
// ─────────────────────────────────────────────────────────────────────────────

const CALC_TYPES: LineCalcType[] = ['flat', 'pct_of_base', 'pct_of_basic', 'remainder'];
const num = (v: any): number => (v === null || v === undefined || v === '' ? 0 : Number(v));

function parseComponentConfig(raw: any): any {
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

function toLineInput(row: any): StructureLineInput {
  const cfg = parseComponentConfig(row.config);
  return {
    component_id: row.component_id,
    name: row.name_in_payslip || row.component_name,
    category: row.category,
    calculation_type: row.calculation_type,
    value: num(row.value),
    earning_type: cfg.earningType === 'variable' ? 'variable' : 'fixed',
    consider_epf: ['always', 'if_below_15000'].includes(cfg.considerEpf) ? cfg.considerEpf : 'no',
    consider_esi: !!cfg.considerEsi,
    pro_rata: cfg.proRata !== false,
  };
}

/** Resolved lines (joined to the catalog) for a structure, in sort order. */
export async function resolveStructureLines(structureId: number): Promise<StructureLineInput[]> {
  const rows = await db('salary_structure_components as l')
    .join('salary_components as c', 'c.id', 'l.component_id')
    .where('l.structure_id', structureId)
    .select('l.component_id', 'l.calculation_type', 'l.value', 'l.sort_order',
      'c.name as component_name', 'c.name_in_payslip', 'c.category', 'c.config')
    .orderBy('l.sort_order');
  return rows.map(toLineInput);
}

const round = (n: number) => Math.round(n);

/**
 * The employee's contracted monthly Basic, derived from the structure's Basic
 * line and the assigned base (mirrors the engine's Basic detection). Used for the
 * Payment of Bonus Act ceilings, which key off the wage, not the prorated pay.
 */
function contractedBasic(lines: StructureLineInput[], base: number): number {
  const basicLine = lines.find((l) => l.category === 'earning' && l.calculation_type === 'pct_of_base' && /basic/i.test(l.name))
    ?? lines.find((l) => l.category === 'earning' && l.calculation_type === 'pct_of_base');
  return basicLine ? round((basicLine.value / 100) * base) : 0;
}

/**
 * Statutory bonus line (Payment of Bonus Act) — injected on every computation
 * when enabled with monthly frequency, with the Act's ceilings applied:
 *   • eligibility: only when monthly Basic ≤ ₹21,000;
 *   • calculation: bonus % of min(Basic, max(₹7,000, state minimum wage)).
 * Emitted as a flat pro-rata earning so it still scales down with Loss of Pay.
 * Yearly frequency is an off-cycle payout and adds no monthly line.
 */
async function statutoryBonusLine(basic: number, state?: string | null, hourly = false): Promise<StructureLineInput | null> {
  const bonus = await getStatutoryBonus();
  if (!bonus.enabled || bonus.frequency !== 'monthly' || bonus.monthlyPercent <= 0) return null;
  // Hourly-rated pay has no fixed monthly Basic to test the Act's rupee ceilings
  // against (base is a per-hour rate), so statutory bonus is skipped for it.
  if (hourly) return null;
  // Eligibility ceiling: employees earning above the wage ceiling are excluded.
  if (basic > 21000) return null;
  // Calculation ceiling: max of ₹7,000 and the state minimum wage. Resolve any
  // city to its canonical state first (min wages are keyed by state).
  const minWage = state ? await getMinimumWageFor(resolveStatutoryState(state)) : null;
  const calcCeiling = Math.max(7000, minWage ?? 0);
  const bonusBase = Math.min(basic, calcCeiling);
  const amount = round((bonus.monthlyPercent / 100) * bonusBase);
  if (amount <= 0) return null;
  return {
    component_id: null,
    name: 'Statutory Bonus',
    category: 'earning',
    calculation_type: 'flat',
    value: amount,
    earning_type: 'variable',
    consider_epf: 'no',
    consider_esi: false,
    pro_rata: true, // still prorates with attendance
  };
}

/**
 * Computes the breakdown for a saved structure at a given base.
 * opts.state: the employee's work-location state (Phase 1) — statutory rates are
 * keyed to it. When absent (template previews), the structure's city field is
 * used as an explicit preview state. opts.month drives cyclical statutory items
 * (LWF deduction months, PT month overrides).
 */
export async function computeForStructure(
  structure: any,
  base: number,
  attendance?: AttendanceContext | null,
  extraLines?: StructureLineInput[],
  opts?: { state?: string | null; month?: number | null; esiCoveredOverride?: boolean | null },
): Promise<PayslipBreakdown> {
  const lines = await resolveStructureLines(structure.id);
  const state = opts?.state ?? structure.city;
  const rates = await getStatutoryRates(state);
  if (opts?.esiCoveredOverride != null) rates.esi.coveredOverride = opts.esiCoveredOverride;
  const bonusLine = await statutoryBonusLine(contractedBasic(lines, base), state, structure.payment_basis === 'hourly');
  const all = [...lines, ...(bonusLine ? [bonusLine] : []), ...(extraLines ?? [])];
  return computeFromStructure(all, base, rates, attendance, opts?.month ?? null);
}

export async function getStructureRow(id: number) {
  return db('salary_structures').where('id', id).first();
}

export async function getStructureByJobTitle(jobTitleId: number) {
  // Only designation TEMPLATES (employee_id null) — never an employee's private structure.
  return db('salary_structures')
    .where('job_title_id', jobTitleId).whereNull('employee_id').where('is_active', true)
    .first();
}

// ─── CRUD ───

/** Raw lines (for the editor) — component + calc type + value. */
async function editorLines(structureId: number) {
  return db('salary_structure_components as l')
    .join('salary_components as c', 'c.id', 'l.component_id')
    .where('l.structure_id', structureId)
    .select('l.id', 'l.component_id', 'l.calculation_type', 'l.value', 'l.sort_order',
      'c.name as component_name', 'c.name_in_payslip', 'c.category')
    .orderBy('l.sort_order');
}

export async function listStructures() {
  const structures = await db('salary_structures as s')
    .leftJoin('job_titles as jt', 'jt.id', 's.job_title_id')
    .whereNull('s.employee_id') // templates only; employee structures are edited per-employee
    .select('s.*', 'jt.title as designation')
    .orderBy('s.name');

  const counts = await db('salary_structure_assignments')
    .select('structure_id').count('id as c').groupBy('structure_id');
  const countMap = new Map<number, number>(counts.map((r: any) => [r.structure_id, Number(r.c)]));

  const out = [];
  for (const s of structures) {
    out.push({
      ...s,
      is_active: !!s.is_active,
      default_base: num(s.default_base),
      assignment_count: countMap.get(s.id) ?? 0,
      lines: await editorLines(s.id),
      breakdown: await computeForStructure(s, num(s.default_base)),
    });
  }
  return out;
}

export async function getStructure(id: number) {
  const s = await getStructureRow(id);
  if (!s) throw new NotFoundError('Salary structure');
  return {
    ...s,
    is_active: !!s.is_active,
    default_base: num(s.default_base),
    lines: await editorLines(id),
    breakdown: await computeForStructure(s, num(s.default_base)),
  };
}

interface StructureInput {
  name: string;
  description?: string;
  job_title_id?: number | null;
  payment_basis?: string;
  default_base: number;
  city?: string;
  is_active?: boolean;
  lines: Array<{ component_id: number; calculation_type: string; value: number }>;
}

/** Validates a set of component lines (shared by templates + per-employee saves). */
async function validateLines(raw: any): Promise<StructureInput['lines']> {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ValidationError('Add at least one component line');
  }
  const seen = new Set<number>();
  let remainderCount = 0;
  let hasEarning = false;
  const lines: StructureInput['lines'] = [];
  for (const row of raw) {
    const component_id = Number(row.component_id);
    if (!component_id) throw new ValidationError('Every line needs a component');
    if (seen.has(component_id)) throw new ValidationError('A component appears twice in the structure');
    seen.add(component_id);
    const component = await db('salary_components').where('id', component_id).first();
    if (!component) throw new NotFoundError('Salary component');
    const calculation_type = String(row.calculation_type) as LineCalcType;
    if (!CALC_TYPES.includes(calculation_type)) throw new ValidationError('Invalid calculation type');
    if (calculation_type === 'remainder') {
      if (component.category !== 'earning') throw new ValidationError('Remainder is only valid for earnings');
      remainderCount += 1;
      if (remainderCount > 1) throw new ValidationError('Only one remainder line is allowed');
    }
    if (component.category === 'earning') hasEarning = true;
    const value = num(row.value);
    if (calculation_type !== 'remainder' && value < 0) throw new ValidationError('Line values cannot be negative');
    lines.push({ component_id, calculation_type, value });
  }
  if (!hasEarning) throw new ValidationError('A structure needs at least one earning component');
  return lines;
}

async function validateStructureInput(data: any, excludeId?: number): Promise<StructureInput> {
  const name = String(data.name || '').trim();
  if (!name) throw new ValidationError('Structure name is required');
  const dupName = db('salary_structures').whereRaw('lower(name) = lower(?)', [name]);
  if (excludeId) dupName.whereNot('id', excludeId);
  if (await dupName.first()) throw new ValidationError('A structure with this name already exists');

  const job_title_id = data.job_title_id ? Number(data.job_title_id) : null;
  if (job_title_id) {
    const jt = await db('job_titles').where('id', job_title_id).first();
    if (!jt) throw new NotFoundError('Designation');
    // One TEMPLATE per designation (employee structures never carry job_title_id).
    const dupJt = db('salary_structures').where('job_title_id', job_title_id).whereNull('employee_id');
    if (excludeId) dupJt.whereNot('id', excludeId);
    if (await dupJt.first()) throw new ValidationError('That designation already has a structure');
  }

  const payment_basis = data.payment_basis === 'hourly' ? 'hourly' : 'monthly';
  const default_base = num(data.default_base);
  if (default_base <= 0) throw new ValidationError('Default base is required');

  const lines = await validateLines(data.lines);

  return {
    name,
    description: data.description ? String(data.description) : undefined,
    job_title_id,
    payment_basis,
    default_base,
    city: data.city ? String(data.city) : 'Haryana',
    is_active: data.is_active === undefined ? true : !!data.is_active,
    lines,
  };
}

export async function createStructure(data: any, userId?: number | null) {
  const input = await validateStructureInput(data);
  const id = await db.transaction(async (trx) => {
    const [newId] = await trx('salary_structures').insert({
      name: input.name, description: input.description ?? null, job_title_id: input.job_title_id,
      payment_basis: input.payment_basis, default_base: input.default_base,
      city: input.city, is_active: input.is_active ? 1 : 0, updated_by: userId ?? null,
    });
    await trx('salary_structure_components').insert(
      input.lines.map((l, i) => ({ ...l, structure_id: newId, sort_order: i })),
    );
    return newId;
  });
  return getStructure(id);
}

export async function updateStructure(id: number, data: any, userId?: number | null) {
  const existing = await getStructureRow(id);
  if (!existing) throw new NotFoundError('Salary structure');
  if (existing.employee_id != null) {
    throw new ValidationError('This is an employee salary structure — edit it from the employee view');
  }
  const input = await validateStructureInput(data, id);
  await db.transaction(async (trx) => {
    await trx('salary_structures').where('id', id).update({
      name: input.name, description: input.description ?? null, job_title_id: input.job_title_id,
      payment_basis: input.payment_basis, default_base: input.default_base,
      city: input.city, is_active: input.is_active ? 1 : 0,
      updated_by: userId ?? null, updated_at: db.fn.now(),
    });
    await trx('salary_structure_components').where('structure_id', id).del();
    await trx('salary_structure_components').insert(
      input.lines.map((l, i) => ({ ...l, structure_id: id, sort_order: i })),
    );
  });
  return getStructure(id);
}

export async function deleteStructure(id: number) {
  const existing = await getStructureRow(id);
  if (!existing) throw new NotFoundError('Salary structure');
  const assigned = await db('salary_structure_assignments').where('structure_id', id).count('id as c').first();
  if (Number((assigned as any)?.c || 0) > 0) {
    throw new ValidationError('Cannot delete: employees are assigned to this structure');
  }
  await db('salary_structures').where('id', id).del(); // lines cascade
  return { id };
}

/** Preview a DRAFT structure (unsaved lines) at a base — powers the editor. */
export async function previewStructure(data: { lines: any[]; base: number; city?: string }) {
  if (!Array.isArray(data.lines) || data.lines.length === 0) {
    throw new ValidationError('No lines to preview');
  }
  const componentIds = data.lines.map((l: any) => Number(l.component_id)).filter(Boolean);
  const components = await db('salary_components').whereIn('id', componentIds).select('*');
  const byId = new Map<number, any>(components.map((c: any) => [c.id, c]));

  const lines: StructureLineInput[] = [];
  for (const raw of data.lines) {
    const c = byId.get(Number(raw.component_id));
    if (!c) continue;
    lines.push(toLineInput({
      component_id: c.id, calculation_type: raw.calculation_type, value: raw.value,
      component_name: c.name, name_in_payslip: c.name_in_payslip, category: c.category, config: c.config,
    }));
  }
  const state = data.city || 'Haryana';
  const rates = await getStatutoryRates(state);
  const bonusLine = await statutoryBonusLine(contractedBasic(lines, num(data.base)), state);
  return computeFromStructure([...lines, ...(bonusLine ? [bonusLine] : [])], num(data.base), rates);
}

// ─── CTC range (offers, vacancies, JD PDFs) ───

// Advertised CTC headroom above the structure's exact CTC (the structure CTC is the floor).
export const JD_CTC_BAND_PCT = 15;

export interface CtcRange {
  configured: boolean;
  monthly_ctc: number;
  annual_low: number;
  annual_high: number;
  label: string; // e.g. "₹2.32 – 2.67 LPA"
}

/**
 * Resolves the advertised CTC range for a designation from its salary structure.
 * Single source of truth shared by the vacancy form, vacancy detail, and JD PDF —
 * computed live so structure edits always reflect on postings. Range = structure
 * CTC (floor) up to +JD_CTC_BAND_PCT% headroom, expressed annually (LPA).
 */
export async function getCtcRange(jobTitleId: number): Promise<CtcRange> {
  const structure = await getStructureByJobTitle(jobTitleId);
  if (!structure) {
    return { configured: false, monthly_ctc: 0, annual_low: 0, annual_high: 0, label: '' };
  }
  const breakdown = await computeForStructure(structure, num(structure.default_base));
  const monthly_ctc = Math.round(breakdown.ctc);
  const annual_low = monthly_ctc * 12;
  const annual_high = Math.round(annual_low * (1 + JD_CTC_BAND_PCT / 100));
  const lpa = (n: number) => (n / 100000).toFixed(2);
  const label = `₹${lpa(annual_low)} – ${lpa(annual_high)} LPA`;
  return { configured: true, monthly_ctc, annual_low, annual_high, label };
}

// ─── Assignments (employee → structure + base) ───

export async function getAssignment(employeeId: number) {
  return db('salary_structure_assignments as a')
    .join('salary_structures as s', 's.id', 'a.structure_id')
    .where('a.employee_id', employeeId)
    .select('a.*', 's.name as structure_name', 's.payment_basis', 's.city')
    .first();
}

export async function listAssignments() {
  return db('employees as e')
    .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
    .leftJoin('salary_structure_assignments as a', 'a.employee_id', 'e.id')
    .leftJoin('salary_structures as s', 's.id', 'a.structure_id')
    .where('e.is_active', true)
    .select(
      'e.id as employee_id', 'e.employee_code', 'e.first_name', 'e.last_name',
      'e.dept_name', 'e.branch_name', 'e.job_title_id', 'jt.title as designation',
      'a.structure_id', 'a.base', 'a.effective_from', 'a.tds_amount',
      's.name as structure_name', 's.payment_basis',
    )
    .orderBy('e.first_name');
}

export async function upsertAssignment(
  employeeId: number,
  data: { structure_id: number; base: number; effective_from?: string; tds_amount?: number },
  userId?: number | null,
) {
  const emp = await db('employees').where('id', employeeId).first();
  if (!emp) throw new NotFoundError('Employee');
  const structure = await getStructureRow(Number(data.structure_id));
  if (!structure) throw new NotFoundError('Salary structure');
  const base = num(data.base);
  if (base <= 0) throw new ValidationError('Base amount is required');
  const tds = num(data.tds_amount);
  if (tds < 0) throw new ValidationError('TDS cannot be negative');

  const patch = {
    structure_id: structure.id, base,
    effective_from: data.effective_from || null,
    tds_amount: tds,
    assigned_by: userId ?? null, updated_at: db.fn.now(),
  };
  const existing = await db('salary_structure_assignments').where('employee_id', employeeId).first();
  if (existing) await db('salary_structure_assignments').where('employee_id', employeeId).update(patch);
  else await db('salary_structure_assignments').insert({ employee_id: employeeId, ...patch });
  return getAssignment(employeeId);
}

export async function removeAssignment(employeeId: number) {
  await db('salary_structure_assignments').where('employee_id', employeeId).del();
  return { employee_id: employeeId };
}

// ─── Per-employee salary structures ───
// Each employee owns a private structure (employee_id set, job_title_id null),
// its base/TDS held on the assignment. Editing one employee affects only them.

/** Employees with a `configured` flag + current base/TDS — drives the By-Employee list. */
export async function listEmployeeSalary() {
  return db('employees as e')
    .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
    .leftJoin('salary_structure_assignments as a', 'a.employee_id', 'e.id')
    .where('e.is_active', true)
    .select(
      'e.id as employee_id', 'e.employee_code', 'e.first_name', 'e.last_name',
      'e.branch_name', 'e.dept_name', 'jt.title as designation',
      'a.base', 'a.tds_amount',
      db.raw('CASE WHEN a.id IS NULL THEN 0 ELSE 1 END as configured'),
    )
    .orderBy('e.first_name');
}

/**
 * CTC register (Phase 6 — Visibility): every active employee with their monthly
 * Salary (gross), Net and CTC from a live full-month breakdown, plus company
 * totals. Answers "what is X's CTC?" and "what is our monthly salary bill?".
 */
export async function getCtcRegister() {
  const base = await listEmployeeSalary();
  const rows: any[] = [];
  const totals = { gross: 0, net: 0, ctc: 0, configured: 0 };
  for (const r of base) {
    let gross: number | null = null;
    let net: number | null = null;
    let ctc: number | null = null;
    if (r.configured) {
      try {
        const asg = await db('salary_structure_assignments').where('employee_id', r.employee_id).first();
        const structureRow = await getStructureRow(asg.structure_id);
        const state = await getEmployeeState(r.employee_id);
        const bd = await computeForStructure(structureRow, num(asg.base), null, undefined, { state });
        gross = bd.gross_earnings; net = bd.net_pay; ctc = bd.ctc;
        totals.gross += gross; totals.net += net; totals.ctc += ctc; totals.configured += 1;
      } catch { /* leave nulls for a structure that can't resolve */ }
    }
    rows.push({ ...r, gross, net, ctc });
  }
  return { rows, totals };
}

/** An employee's full salary config (lines + base + TDS + city) with a live breakdown. */
export async function getEmployeeStructure(employeeId: number) {
  const emp = await db('employees as e')
    .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
    .where('e.id', employeeId)
    .select('e.id', 'e.employee_code', 'e.first_name', 'e.last_name', 'e.job_title_id',
      'e.dept_name', 'e.branch_name', 'jt.title as designation')
    .first();
  if (!emp) throw new NotFoundError('Employee');

  const assignment = await db('salary_structure_assignments as a')
    .join('salary_structures as s', 's.id', 'a.structure_id')
    .where('a.employee_id', employeeId)
    .select('a.structure_id', 'a.base', 'a.tds_amount', 'a.effective_from', 's.city', 's.payment_basis')
    .first();

  // Work-Location State: statutory rates for this employee come from their
  // property's state — shown read-only in the editor and used for the breakdown.
  const state = await getEmployeeState(employeeId);

  if (assignment) {
    const structureRow = await getStructureRow(assignment.structure_id);
    return {
      configured: true,
      employee: emp,
      structure_id: assignment.structure_id,
      lines: await editorLines(assignment.structure_id),
      base: num(assignment.base),
      tds_amount: num(assignment.tds_amount),
      state,
      payment_basis: assignment.payment_basis ?? 'monthly',
      effective_from: assignment.effective_from ?? null,
      breakdown: await computeForStructure(structureRow, num(assignment.base), null, undefined, { state }),
      template_source: null,
    };
  }

  // Not configured yet — offer the designation template's lines as a starting point.
  const template = emp.job_title_id ? await getStructureByJobTitle(emp.job_title_id) : null;
  const base = template ? num(template.default_base) : 0;
  return {
    configured: false,
    employee: emp,
    structure_id: null,
    lines: template ? await editorLines(template.id) : [],
    base,
    tds_amount: 0,
    state,
    payment_basis: template?.payment_basis ?? 'monthly',
    effective_from: null,
    breakdown: template ? await computeForStructure(template, base, null, undefined, { state }) : null,
    template_source: template ? { id: template.id, name: template.name } : null,
  };
}

interface EmployeeStructureInput {
  lines: any[];
  base: number;
  tds_amount?: number;
  city?: string;
  payment_basis?: string;
  effective_from?: string | null;
}

/** Saves an employee's private structure (creating it if needed) + their assignment, atomically. */
export async function saveEmployeeStructure(
  employeeId: number,
  data: EmployeeStructureInput,
  userId?: number | null,
) {
  const emp = await db('employees').where('id', employeeId).first();
  if (!emp) throw new NotFoundError('Employee');
  const base = num(data.base);
  if (base <= 0) throw new ValidationError('Base amount is required');
  const tds = num(data.tds_amount);
  if (tds < 0) throw new ValidationError('TDS cannot be negative');
  const lines = await validateLines(data.lines);
  // Work-Location State: the private structure's city mirrors the employee's
  // property state (payslips resolve rates from the property, never this field).
  const city = await getEmployeeState(employeeId);
  const payment_basis = data.payment_basis === 'hourly' ? 'hourly' : 'monthly';

  await db.transaction(async (trx) => {
    let structure = await trx('salary_structures').where('employee_id', employeeId).first();
    if (!structure) {
      const name = `${emp.first_name ?? ''} ${emp.last_name ?? ''} · ${emp.employee_code ?? employeeId}`.trim();
      const [newId] = await trx('salary_structures').insert({
        name, description: null, job_title_id: null, employee_id: employeeId,
        payment_basis, default_base: base, city, is_active: 1, updated_by: userId ?? null,
      });
      structure = { id: newId };
    } else {
      await trx('salary_structures').where('id', structure.id).update({
        payment_basis, default_base: base, city, is_active: 1,
        updated_by: userId ?? null, updated_at: trx.fn.now(),
      });
    }
    await trx('salary_structure_components').where('structure_id', structure.id).del();
    await trx('salary_structure_components').insert(
      lines.map((l, i) => ({ ...l, structure_id: structure.id, sort_order: i })),
    );

    const patch = {
      structure_id: structure.id, base, tds_amount: tds,
      effective_from: data.effective_from || null,
      assigned_by: userId ?? null, updated_at: trx.fn.now(),
    };
    const existing = await trx('salary_structure_assignments').where('employee_id', employeeId).first();
    if (existing) await trx('salary_structure_assignments').where('employee_id', employeeId).update(patch);
    else await trx('salary_structure_assignments').insert({ employee_id: employeeId, ...patch });
  });

  return getEmployeeStructure(employeeId);
}

/** Clones the employee's designation template (or a generic template) into their private structure. */
export async function seedEmployeeStructureFromTemplate(
  employeeId: number,
  opts: { base?: number; tds_amount?: number } = {},
  userId?: number | null,
) {
  const emp = await db('employees').where('id', employeeId).first();
  if (!emp) throw new NotFoundError('Employee');
  let template = emp.job_title_id ? await getStructureByJobTitle(emp.job_title_id) : null;
  if (!template) {
    template = await db('salary_structures').whereNull('employee_id').where('is_active', true).orderBy('id').first();
  }
  if (!template) throw new ValidationError('No salary template available to seed from');

  const lines = await editorLines(template.id);
  const base = opts.base && opts.base > 0 ? Number(opts.base) : num(template.default_base);
  return saveEmployeeStructure(employeeId, {
    lines: lines.map((l: any) => ({ component_id: l.component_id, calculation_type: l.calculation_type, value: l.value })),
    base,
    tds_amount: opts.tds_amount ?? 0,
    payment_basis: template.payment_basis,
    effective_from: emp.date_of_joining || null,
  }, userId);
}
