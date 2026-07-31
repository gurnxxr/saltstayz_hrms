import type { Knex } from 'knex';

/**
 * Let a shift assignment END, instead of running forward forever.
 *
 * Migration 004 gave assignments a start date, which was enough to say "they moved to Night on
 * the 1st". It cannot say "they cover Night for two weeks and then go back to whatever they were
 * on" — the only way to express that today is to remember to add a second assignment on the
 * return date, and a forgotten one leaves somebody on Night indefinitely.
 *
 * NULLABLE, and null is the normal case: it means "until further notice", which is exactly the
 * behaviour every existing row has. Nothing is backfilled, so no assignment changes what it
 * governs.
 *
 * INCLUSIVE. `effective_to = 2026-08-14` means the 14th is still on that shift and the 15th is
 * not. A half-open end date would be defensible in the abstract and wrong here: every other date
 * in this schema is a business date a human types and reads back, and an admin who types the last
 * day of a secondment means the last day.
 *
 * When an assignment ends and nothing follows it, the employee is not stranded on a stale shift
 * and is not left with no rest day either — `pickAssignmentFor` returns null and the pay engine's
 * existing ladder takes over (shift → leave template work week → organisation work week). That
 * ladder was built for the unassigned case and this reuses it rather than inventing a second one.
 */
export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('employee_shift_assignments', 'effective_to')) return;
  await knex.schema.alterTable('employee_shift_assignments', (t) => {
    t.text('effective_to').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('employee_shift_assignments', 'effective_to'))) return;
  await knex.schema.alterTable('employee_shift_assignments', (t) => {
    t.dropColumn('effective_to');
  });
}
