import type { Knex } from 'knex';

/**
 * Seeds a default salary structure for every designation (job title) using the
 * standard statutory percentages and a deterministic base gross. Idempotent:
 * designations that already have a structure are skipped.
 */
export async function seed(knex: Knex): Promise<void> {
  const jobTitles = await knex('job_titles').select('id');
  const existing = await knex('designation_salary_structures').pluck('job_title_id');
  const configured = new Set(existing);

  const rows = jobTitles
    .filter((jt: any) => !configured.has(jt.id))
    .map((jt: any) => {
      const gross = 18000 + (jt.id % 12) * 1500; // ₹18,000–₹34,500 band by designation
      return {
        job_title_id: jt.id,
        gross,
        city: 'Haryana',
        pct_basic: 50,
        pct_hra: 50,
        pct_employee_pf: 12,
        pct_esi: 0.75,
        pct_employer_pf: 12,
        pct_gratuity: 4.81,
        pct_employer_esi: 3.25,
        pli: Math.round(gross * 0.04),
        meal: 0,
        accommodation: 0,
        accommodation_allowance: 0,
      };
    });

  if (rows.length) await knex('designation_salary_structures').insert(rows);
}
