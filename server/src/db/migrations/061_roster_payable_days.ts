import type { Knex } from 'knex';

// Payroll v2 Phase 3 — Shifts Drive Payable Days.
//   • Removes the dead work_week_config table (created in 006, seeded in 04, read
//     by nothing — payable days now come from shift_rosters + the Pay Schedule).
//   • Adds the attendance-coverage gate threshold to pay_schedule_settings: the
//     maximum share of unmarked working-day cells a month may carry before
//     locking requires an explicit confirmation. Config-driven, nothing hardcoded.

export async function up(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('work_week_config');

  const hasCol = await knex.schema.hasColumn('pay_schedule_settings', 'attendance_gate_pct');
  if (!hasCol) {
    await knex.schema.alterTable('pay_schedule_settings', (t) => {
      // Max % of working-day cells that may be unmarked before lock needs confirming.
      t.integer('attendance_gate_pct').notNullable().defaultTo(10);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasCol = await knex.schema.hasColumn('pay_schedule_settings', 'attendance_gate_pct');
  if (hasCol) {
    await knex.schema.alterTable('pay_schedule_settings', (t) => t.dropColumn('attendance_gate_pct'));
  }

  const exists = await knex.schema.hasTable('work_week_config');
  if (!exists) {
    await knex.schema.createTable('work_week_config', (table) => {
      table.increments('id').primary();
      table.integer('property_id').unsigned().notNullable().references('id').inTable('properties').onDelete('CASCADE');
      table.integer('day_of_week').notNullable();
      table.boolean('is_working_day').defaultTo(true);
      table.unique(['property_id', 'day_of_week']);
    });
  }
}
