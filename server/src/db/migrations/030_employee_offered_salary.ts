import type { Knex } from 'knex';

// Records the final salary OFFERED to an individual (per the offer letter),
// independent of the designation salary structure and of salary_setup (payroll).
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('employees', (table) => {
    table.decimal('offered_base', 12, 2);        // monthly base (gross) offered
    table.decimal('offered_ctc', 14, 2);         // annual CTC offered
    table.decimal('offer_adjustment_pct', 6, 2); // % vs the structure base (+/-)
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('employees', (table) => { table.dropColumn('offer_adjustment_pct'); });
  await knex.schema.alterTable('employees', (table) => { table.dropColumn('offered_ctc'); });
  await knex.schema.alterTable('employees', (table) => { table.dropColumn('offered_base'); });
}
