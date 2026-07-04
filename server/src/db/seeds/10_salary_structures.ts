import type { Knex } from 'knex';
import { ensureStructureComponents, standardLines } from '../structureComponents';

/**
 * Seeds a component-based salary structure (v2) for every designation and assigns
 * every active employee to their designation's structure. Idempotent: existing
 * structures/assignments are left untouched so manual edits survive re-seeds.
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

  // ── Assign every active employee to their designation's structure ──
  const structures = await knex('salary_structures').whereNotNull('job_title_id')
    .select('id', 'job_title_id', 'default_base');
  const byJobTitle = new Map<number, any>(structures.map((s: any) => [s.job_title_id, s]));
  const assigned = new Set(await knex('salary_structure_assignments').pluck('employee_id'));

  const employees = await knex('employees')
    .where('is_active', true).whereNotNull('job_title_id')
    .select('id', 'job_title_id');
  for (const emp of employees) {
    if (assigned.has(emp.id)) continue;
    const structure = byJobTitle.get(emp.job_title_id);
    if (!structure) continue;
    // ₹18,000–₹36,000 band, stepped deterministically by employee id
    const base = 18000 + (emp.id % 10) * 2000;
    await knex('salary_structure_assignments').insert({
      employee_id: emp.id,
      structure_id: structure.id,
      base,
      effective_from: '2026-04-01',
    });
  }
}
