import type { Knex } from 'knex';

// Department applicability for leave types — the same shape as the existing
// "cannot be clubbed with" matrix (leave_type_conflicts): a small join table,
// attached to each type when it's read.
//
//   No rows for a type = it applies to every department (blank = no restriction,
//   consistent with every other policy field, so existing types are unaffected).
//   One or more rows = only employees in those departments may take that type.
//
// We store the department id (not the name) so renaming a department can't
// silently break the rule — employees store dept_name as text and are resolved
// to an id at apply time.

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('leave_type_departments'))) {
    await knex.schema.createTable('leave_type_departments', (t) => {
      t.increments('id').primary();
      t.integer('leave_type_id').unsigned().notNullable().references('id').inTable('leave_types').onDelete('CASCADE');
      t.integer('department_id').unsigned().notNullable().references('id').inTable('departments').onDelete('CASCADE');
      t.unique(['leave_type_id', 'department_id']);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('leave_type_departments');
}
