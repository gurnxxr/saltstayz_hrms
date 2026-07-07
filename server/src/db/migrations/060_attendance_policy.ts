import type { Knex } from 'knex';

// Payroll v2 Phase 2: Attendance policy (Present / Absent / Miss Punch / Short
// Punch). All thresholds live on the singleton pay_schedule_settings row so the
// classification is config-driven — nothing hardcoded.
const ADDED = ['grace_minutes', 'standard_day_hours', 'miss_punch_allowance', 'miss_punch_lop', 'short_punch_lop'];

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('pay_schedule_settings', (t) => {
    // Early-exit tolerance: worked >= (shift hours − grace) counts as Present.
    t.integer('grace_minutes').notNullable().defaultTo(15);
    // Fallback expected day length when an employee has no rostered/assigned shift.
    t.decimal('standard_day_hours', 4, 2).notNullable().defaultTo(8);
    // Miss punches per month treated as Present (regularization allowance);
    // beyond it, each miss punch costs miss_punch_lop days.
    t.integer('miss_punch_allowance').notNullable().defaultTo(3);
    t.decimal('miss_punch_lop', 3, 1).notNullable().defaultTo(0.5);
    // Loss-of-pay for a short punch (left early beyond grace).
    t.decimal('short_punch_lop', 3, 1).notNullable().defaultTo(0.5);
  });
}

export async function down(knex: Knex): Promise<void> {
  for (const col of ADDED) {
    await knex.schema.alterTable('pay_schedule_settings', (t) => t.dropColumn(col));
  }
}
