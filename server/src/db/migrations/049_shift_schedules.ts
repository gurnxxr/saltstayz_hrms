import type { Knex } from 'knex';

// Shift Schedule: a named recurring pattern (parent) that assigns one Shift Type on a
// set of weekdays (child rows) at a chosen frequency (Every 1–4 weeks).
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('shift_schedules', (t) => {
    t.increments('id').primary();
    t.string('name', 120).notNullable();
    t.integer('shift_type_id').unsigned().notNullable().references('id').inTable('shift_types').onDelete('RESTRICT');
    t.integer('frequency_weeks').notNullable().defaultTo(1); // 1..4
    t.timestamps(true, true);
  });
  await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS shift_schedules_name_unique ON shift_schedules(name)');

  await knex.schema.createTable('shift_schedule_days', (t) => {
    t.increments('id').primary();
    t.integer('shift_schedule_id').unsigned().notNullable().references('id').inTable('shift_schedules').onDelete('CASCADE');
    t.integer('day_of_week').notNullable(); // 0=Sun … 6=Sat (app-wide convention)
    t.unique(['shift_schedule_id', 'day_of_week']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('shift_schedule_days');
  await knex.schema.dropTableIfExists('shift_schedules');
}
