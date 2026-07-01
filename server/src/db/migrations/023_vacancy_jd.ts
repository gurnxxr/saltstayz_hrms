import type { Knex } from 'knex';

// Stores the admin-configured "variable" parts of a vacancy's Job Description
// (summary, responsibilities, requirements, experience, etc.) as JSON.
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('vacancies', 'jd_data'))) {
    await knex.schema.alterTable('vacancies', (table) => {
      table.text('jd_data');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('vacancies', 'jd_data')) {
    await knex.schema.alterTable('vacancies', (table) => {
      table.dropColumn('jd_data');
    });
  }
}
