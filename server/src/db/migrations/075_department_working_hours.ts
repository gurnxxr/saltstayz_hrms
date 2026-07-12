import type { Knex } from 'knex';

// A department can declare its standard working hours per day (e.g. 8, 8.5, 9).
// Nullable — a department with no value simply has none set.
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('departments', 'working_hours_per_day'))) {
    await knex.schema.alterTable('departments', (t) => {
      t.decimal('working_hours_per_day', 4, 2);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('departments', 'working_hours_per_day')) {
    await knex.schema.alterTable('departments', (t) => {
      t.dropColumn('working_hours_per_day');
    });
  }
}
