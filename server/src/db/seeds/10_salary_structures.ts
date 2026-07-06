import type { Knex } from 'knex';
import { ensureStructureComponents, standardLines, cloneStructureForEmployee } from '../structureComponents';

/**
 * Seeds a component-based salary TEMPLATE for every designation, then gives every
 * active employee their own PRIVATE structure cloned from that template (so each
 * employee's salary is independently editable — mirrors migration 058). Idempotent:
 * existing structures/assignments are left untouched so manual edits survive re-seeds.
 */
export async function seed(knex: Knex): Promise<void> {
  const ids = await ensureStructureComponents(knex);

  // ── One structure per designation ──
  const jobTitles = await knex('job_titles').select('id', 'title');
  const configured = new Set(await knex('salary_structures').whereNotNull('job_title_id').pluck('job_title_id'));
  const usedNames = new Set<string>((await knex('salary_structures').pluck('name')).map((n: string) => n.toLowerCase()));

  for (const jt of jobTitles) {
    if (configured.has(jt.id)) continue;
    const gross = 18000 + (jt.id % 12) * 1500; // ₹18,000–₹34,500 band by designation
    let name = String(jt.title);
    if (usedNames.has(name.toLowerCase())) name = `${name} (Structure)`;
    usedNames.add(name.toLowerCase());

    const [structureId] = await knex('salary_structures').insert({
      name,
      job_title_id: jt.id,
      payment_basis: 'monthly',
      default_base: gross,
      city: 'Haryana',
      is_active: 1,
    });
    const lines = standardLines(ids, {
      pct_basic: 50, pct_hra: 50, pct_gratuity: 4.81,
      pli: Math.round(gross * 0.04), meal: 0, accommodation: 0, accommodation_allowance: 0,
    });
    await knex('salary_structure_components').insert(lines.map((l) => ({ ...l, structure_id: structureId })));
  }

  // ── Give every active employee a PRIVATE structure cloned from their designation template ──
  const templates = await knex('salary_structures').whereNotNull('job_title_id').whereNull('employee_id')
    .select('id', 'job_title_id', 'default_base');
  const byJobTitle = new Map<number, any>(templates.map((s: any) => [s.job_title_id, s]));
  const assigned = new Set(await knex('salary_structure_assignments').pluck('employee_id'));

  const employees = await knex('employees')
    .where('is_active', true).whereNotNull('job_title_id')
    .select('id', 'first_name', 'last_name', 'employee_code', 'job_title_id');
  for (const emp of employees) {
    if (assigned.has(emp.id)) continue;
    const template = byJobTitle.get(emp.job_title_id);
    if (!template) continue;
    // ₹18,000–₹36,000 band, stepped deterministically by employee id
    const base = 18000 + (emp.id % 10) * 2000;
    const name = `${emp.first_name ?? ''} ${emp.last_name ?? ''} · ${emp.employee_code ?? emp.id}`.trim();
    const structureId = await cloneStructureForEmployee(knex, {
      srcStructureId: template.id, employeeId: emp.id, name, base,
    });
    await knex('salary_structure_assignments').insert({
      employee_id: emp.id,
      structure_id: structureId,
      base,
      effective_from: '2026-04-01',
    });
  }
}
