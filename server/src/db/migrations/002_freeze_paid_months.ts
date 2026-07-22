import type { Knex } from 'knex';

/**
 * Freezes every payslip that has already been paid, ahead of the Shift Management rework.
 *
 * A payslip is stored whole in `payslip_history.snapshot`, but only a LOCKED month is
 * served from that snapshot — a month that was paid and never locked is recalculated live
 * every time anyone views it. Changing how the work calendar is derived would therefore
 * move figures on months people have already been paid for.
 *
 * `calc_version` records which set of rules produced a payslip. Everything that exists
 * today was produced by the old rules, so it is stamped 1 and will always be served from
 * its stored snapshot from now on, locked or not. Anything generated after this migration
 * is 2 and keeps the existing behaviour (draft recomputes live, locked serves stored).
 *
 * The column lives on `payslip_history` rather than `payroll_runs` on purpose: a payslip
 * can be generated for a single employee with no run row at all (`run_id` is nullable), and
 * those months need the same protection.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('payslip_history', (t) => {
    t.integer('calc_version').notNullable().defaultTo(2);
  });

  // Everything that already exists predates the rework.
  const updated = await knex('payslip_history').update({ calc_version: 1 });
  console.log(`  frozen ${updated} existing payslip(s) at calc_version 1`);

  await knex.schema.alterTable('payslip_history', (t) => {
    t.index(['calc_version'], 'payslip_history_calc_version_index');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('payslip_history', (t) => {
    t.dropIndex(['calc_version'], 'payslip_history_calc_version_index');
    t.dropColumn('calc_version');
  });
}
