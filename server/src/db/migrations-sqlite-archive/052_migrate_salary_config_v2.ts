import type { Knex } from 'knex';
import { ensureStructureComponents, standardLines } from '../structureComponents';

// Payroll Phase 2 (data): convert every legacy designation_salary_structures row
// into a component-based salary_structures v2 template, and assign every active
// employee to their designation's structure (base = per-employee salary_setup
// gross when present, else the structure's default base). Legacy tables are left
// in place but nothing reads them after this phase. No-op on fresh databases
// (the seed builds v2 data directly).
export async function up(knex: Knex): Promise<void> {
  const legacy = await knex('designation_salary_structures as s')
    .join('job_titles as jt', 'jt.id', 's.job_title_id')
    .whereNotNull('s.gross')
    .select('s.*', 'jt.title');
  if (legacy.length === 0) return;

  const ids = await ensureStructureComponents(knex);
  const usedNames = new Set<string>((await knex('salary_structures').pluck('name')).map((n: string) => n.toLowerCase()));

  const structureByJobTitle = new Map<number, number>();
  for (const row of legacy) {
    const existing = await knex('salary_structures').where('job_title_id', row.job_title_id).first();
    if (existing) { structureByJobTitle.set(row.job_title_id, existing.id); continue; }

    let name = String(row.title);
    if (usedNames.has(name.toLowerCase())) name = `${name} (Structure)`;
    usedNames.add(name.toLowerCase());

    const [structureId] = await knex('salary_structures').insert({
      name,
      job_title_id: row.job_title_id,
      payment_basis: 'monthly',
      default_base: Number(row.gross) || 0,
      city: row.city || 'Haryana',
      is_active: 1,
    });

    const lines = standardLines(ids, {
      pct_basic: Number(row.pct_basic ?? 50),
      pct_hra: Number(row.pct_hra ?? 50),
      pct_gratuity: Number(row.pct_gratuity ?? 4.81),
      pli: Number(row.pli ?? 0),
      meal: Number(row.meal ?? 0),
      accommodation: Number(row.accommodation ?? 0),
      accommodation_allowance: Number(row.accommodation_allowance ?? 0),
    });
    await knex('salary_structure_components').insert(lines.map((l) => ({ ...l, structure_id: structureId })));
    structureByJobTitle.set(row.job_title_id, structureId);
  }

  // Assign every active employee whose designation has a structure.
  const employees = await knex('employees')
    .where('is_active', true)
    .whereNotNull('job_title_id')
    .select('id', 'job_title_id');
  const setups = await knex('salary_setup').select('employee_id', 'gross');
  const setupByEmployee = new Map<number, number>(setups.map((s: any) => [s.employee_id, Number(s.gross) || 0]));
  const assigned = new Set<number>(await knex('salary_structure_assignments').pluck('employee_id'));

  for (const emp of employees) {
    if (assigned.has(emp.id)) continue;
    const structureId = structureByJobTitle.get(emp.job_title_id);
    if (!structureId) continue;
    const structure = await knex('salary_structures').where('id', structureId).first();
    const base = setupByEmployee.get(emp.id) || Number(structure.default_base) || 0;
    if (base <= 0) continue;
    await knex('salary_structure_assignments').insert({
      employee_id: emp.id, structure_id: structureId, base, effective_from: '2026-04-01',
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  // Structures/assignments created here are dropped with the 051 tables; nothing to undo.
  await knex('salary_structure_assignments').del();
  await knex('salary_structure_components').del();
  await knex('salary_structures').del();
}
