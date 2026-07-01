import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // archived: rejected candidates are archived out of the active funnel.
  // employee_id: set when a candidate is marked "offered" and promoted into the
  // employees table + onboarding pipeline (also prevents double-promotion).
  if (!(await knex.schema.hasColumn('candidates', 'archived'))) {
    await knex.schema.alterTable('candidates', (t) => {
      t.boolean('archived').notNullable().defaultTo(false);
    });
  }
  if (!(await knex.schema.hasColumn('candidates', 'employee_id'))) {
    await knex.schema.alterTable('candidates', (t) => {
      t.integer('employee_id').unsigned().references('id').inTable('employees').onDelete('SET NULL');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('candidates', 'employee_id')) {
    await knex.schema.alterTable('candidates', (t) => t.dropColumn('employee_id'));
  }
  if (await knex.schema.hasColumn('candidates', 'archived')) {
    await knex.schema.alterTable('candidates', (t) => t.dropColumn('archived'));
  }
}
