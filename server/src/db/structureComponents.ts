import type { Knex } from 'knex';

// Shared by migration 052 and the salary-structure seed: makes sure the catalog
// has every component the standard SaltStayz structure uses, and builds the
// standard line set from the legacy numbers (gross/pcts/amounts).

export interface StandardNumbers {
  pct_basic: number;
  pct_hra: number;
  pct_gratuity: number;
  pli: number;
  meal: number;
  accommodation: number;
  accommodation_allowance: number;
}

const EXTRA_COMPONENTS: Array<{ category: string; name: string; payslip: string; config: any }> = [
  {
    category: 'earning', name: 'Other Allowance', payslip: 'Other Allowance',
    config: {
      earningType: 'fixed', calculationType: 'flat', amount: 0, percentage: 0, percentOf: null,
      partOfStructure: true, isTaxable: true, proRata: true,
      considerEpf: 'always', considerEsi: true, showInPayslip: true,
    },
  },
  {
    category: 'earning', name: 'PLI', payslip: 'PLI (Variable Pay)',
    config: {
      earningType: 'variable', calculationType: 'flat', amount: 0, percentage: 0, percentOf: null,
      partOfStructure: true, isTaxable: true, proRata: false,
      considerEpf: 'no', considerEsi: false, showInPayslip: true,
    },
  },
  {
    category: 'deduction', name: 'Meal Deduction', payslip: 'Meal',
    config: { deductionType: 'Meal', frequency: 'recurring' },
  },
  {
    category: 'deduction', name: 'Accommodation Deduction', payslip: 'Accommodation',
    config: { deductionType: 'Accommodation', frequency: 'recurring' },
  },
  {
    category: 'benefit', name: 'Accommodation Allowance', payslip: 'Accommodation Allowance',
    config: { benefitPlan: 'Accommodation Allowance', frequency: 'recurring', proRata: false },
  },
  {
    category: 'benefit', name: 'Gratuity Provision', payslip: 'Gratuity',
    config: { benefitPlan: 'Gratuity Provision', frequency: 'recurring', proRata: false },
  },
];

/** Ensures every needed component exists (active); returns name → id. */
export async function ensureStructureComponents(knex: Knex): Promise<Record<string, number>> {
  const maxSort = await knex('salary_components').max('sort_order as m').first();
  let sort = Number((maxSort as any)?.m ?? 0) + 1;

  for (const c of EXTRA_COMPONENTS) {
    const existing = await knex('salary_components').where({ category: c.category, name: c.name }).first();
    if (!existing) {
      await knex('salary_components').insert({
        category: c.category, name: c.name, name_in_payslip: c.payslip,
        status: 'active', is_system: 1, sort_order: sort++, config: JSON.stringify(c.config),
      });
    } else if (existing.status !== 'active') {
      await knex('salary_components').where('id', existing.id).update({ status: 'active' });
    }
  }

  const names = ['Basic', 'House Rent Allowance', ...EXTRA_COMPONENTS.map((c) => c.name)];
  const rows = await knex('salary_components').whereIn('name', names).select('id', 'name');
  const map: Record<string, number> = {};
  for (const r of rows) map[r.name] = r.id;
  return map;
}

/**
 * Clones a source structure's lines into a NEW private structure owned by one
 * employee (employee_id set, job_title_id null). Shared by migration 058, seed
 * 10, and the runtime seed-from-template helper so every path produces the same
 * shape. Requires the `salary_structures.employee_id` column (migration 058).
 */
export async function cloneStructureForEmployee(
  knex: Knex,
  opts: { srcStructureId: number; employeeId: number; name: string; base: number },
): Promise<number> {
  const src = await knex('salary_structures').where('id', opts.srcStructureId).first();
  const [newId] = await knex('salary_structures').insert({
    name: opts.name,
    description: src?.description ?? null,
    job_title_id: null,
    employee_id: opts.employeeId,
    payment_basis: src?.payment_basis ?? 'monthly',
    default_base: opts.base,
    city: src?.city ?? 'Haryana',
    is_active: 1,
  });
  const lines = await knex('salary_structure_components')
    .where('structure_id', opts.srcStructureId)
    .select('component_id', 'calculation_type', 'value', 'sort_order');
  if (lines.length) {
    await knex('salary_structure_components').insert(lines.map((l: any) => ({ ...l, structure_id: newId })));
  }
  return newId;
}

/** The standard SaltStayz line set, translated from the legacy structure numbers. */
export function standardLines(ids: Record<string, number>, n: StandardNumbers) {
  let sort = 0;
  const lines: Array<{ component_id: number; calculation_type: string; value: number; sort_order: number }> = [
    { component_id: ids['Basic'], calculation_type: 'pct_of_base', value: n.pct_basic, sort_order: sort++ },
    { component_id: ids['House Rent Allowance'], calculation_type: 'pct_of_basic', value: n.pct_hra, sort_order: sort++ },
    { component_id: ids['Other Allowance'], calculation_type: 'remainder', value: 0, sort_order: sort++ },
  ];
  if (n.pli > 0) lines.push({ component_id: ids['PLI'], calculation_type: 'flat', value: n.pli, sort_order: sort++ });
  if (n.meal > 0) lines.push({ component_id: ids['Meal Deduction'], calculation_type: 'flat', value: n.meal, sort_order: sort++ });
  if (n.accommodation > 0) lines.push({ component_id: ids['Accommodation Deduction'], calculation_type: 'flat', value: n.accommodation, sort_order: sort++ });
  if (n.accommodation_allowance > 0) lines.push({ component_id: ids['Accommodation Allowance'], calculation_type: 'flat', value: n.accommodation_allowance, sort_order: sort++ });
  if (n.pct_gratuity > 0) lines.push({ component_id: ids['Gratuity Provision'], calculation_type: 'pct_of_basic', value: n.pct_gratuity, sort_order: sort++ });
  return lines;
}
