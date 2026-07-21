import type { Knex } from 'knex';

// A vacancy carries the reporting manager the future hire will report to. Tagged
// onto the employee when an applicant is hired (createEmployeeFromCandidate).
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('vacancies', (table) => {
    table.integer('reporting_manager_id').unsigned()
      .references('id').inTable('employees').onDelete('SET NULL');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('vacancies', (table) => { table.dropColumn('reporting_manager_id'); });
}
