import type { Knex } from 'knex';

/**
 * Per-attendance-code pay rules, configurable in Admin → Payroll → Attendance Pay Rules.
 *
 * Until now the pay effect of each daily code was split: miss-punch / short-punch / unmarked /
 * holidays-paid were settings on `pay_schedule_settings`, but Present / Half-Day / HHD / Absent were
 * hardcoded literals in `payableDays.service`. This table makes ALL of them configurable — one row
 * per code, keyed by the value stored in `attendance_records.status`.
 *
 *   pay_fraction            0..1 — share of a day's pay the code earns (present=1, absent=0, hhd=0.5)
 *   counts_in_denominator   whether the day is a working day for the salary divisor (weekly-off = false)
 *   deducts_leave_fraction  0..1 — leave balance used by the code (Half Day = 0.5 leave)
 *   config                  JSON extras — e.g. miss-punch { allowance, beyond_pay_fraction }
 *
 * Regularised (approved) days and approved paid-leave days are paid in full *ahead* of these rules —
 * that precedence lives in the payroll engine, not here.
 */
const DEFAULT_RULES = [
  { code: 'present',      label: 'Present',            pay_fraction: 1,   counts_in_denominator: true,  deducts_leave_fraction: 0,   config: '{}' },
  // Pays nothing until reviewed — see the note in attendancePayRules.service.ts. A broken
  // fingerprint reader must not silently pay a whole property for days nobody can evidence.
  { code: 'no_punch',     label: 'No Punch',           pay_fraction: 0,   counts_in_denominator: true,  deducts_leave_fraction: 0,   config: '{}' },
  { code: 'absent',       label: 'Absent',             pay_fraction: 0,   counts_in_denominator: true,  deducts_leave_fraction: 0,   config: '{}' },
  { code: 'half_day',     label: 'Half Day',           pay_fraction: 0.5, counts_in_denominator: true,  deducts_leave_fraction: 0.5, config: '{}' },
  { code: 'short_punch',  label: 'Short Present',      pay_fraction: 0.5, counts_in_denominator: true,  deducts_leave_fraction: 0,   config: '{}' },
  { code: 'miss_punch',   label: 'Missed Punch',       pay_fraction: 1,   counts_in_denominator: true,  deducts_leave_fraction: 0,   config: '{"allowance":3,"beyond_pay_fraction":0.5}' },
  { code: 'hhd',          label: 'Half-Day Holiday',   pay_fraction: 0.5, counts_in_denominator: true,  deducts_leave_fraction: 0,   config: '{}' },
  { code: 'weekly_off',   label: 'Weekly Off',         pay_fraction: 1,   counts_in_denominator: false, deducts_leave_fraction: 0,   config: '{}' },
];

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('attendance_pay_rules'))) {
    await knex.schema.createTable('attendance_pay_rules', (t) => {
      t.increments('id');
      t.string('code', 30).notNullable().unique();
      t.string('label', 60).notNullable();
      t.float('pay_fraction').notNullable().defaultTo(1);
      t.boolean('counts_in_denominator').notNullable().defaultTo(true);
      t.float('deducts_leave_fraction').notNullable().defaultTo(0);
      t.text('config').notNullable().defaultTo('{}');
      t.integer('updated_by');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
  }
  // Seed defaults for any code not already present (safe to re-run).
  for (const r of DEFAULT_RULES) {
    await knex('attendance_pay_rules').insert(r).onConflict('code').ignore();
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('attendance_pay_rules');
}
