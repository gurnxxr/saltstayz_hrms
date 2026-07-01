import type { Knex } from 'knex';

/**
 * Seeds salary_setup for every active employee that doesn't already have one.
 * Idempotent: existing rows are left untouched so manual HR edits survive re-seeds.
 *
 * Gross is derived deterministically from the employee id (no randomness) so the
 * data is stable across runs. City defaults to Gurugram (company HQ).
 */
export async function seed(knex: Knex): Promise<void> {
  const employees = await knex('employees').where('is_active', true).select('id');
  const existing = await knex('salary_setup').select('employee_id');
  const configured = new Set(existing.map((r: any) => r.employee_id));

  const rows = employees
    .filter((e: any) => !configured.has(e.id))
    .map((e: any) => {
      // ₹18,000–₹36,000 band, stepped by employee id
      const gross = 18000 + (e.id % 10) * 2000;
      return {
        employee_id: e.id,
        gross,
        city: 'Gurugram',
        pli: (e.id % 4) * 500,   // some have PLI, some don't
        meal: 0,
        accommodation: 0,
        accommodation_allowance: 0,
        effective_from: '2026-04-01',
      };
    });

  if (rows.length) {
    await knex('salary_setup').insert(rows);
  }
}
