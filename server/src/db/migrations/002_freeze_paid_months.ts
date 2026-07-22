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
 *
 * The CURRENT month is deliberately left alone. Previewing a draft of the month in progress is
 * a supported workflow, and freezing is one-way — nothing ever raises a row back to 2. Freezing
 * a live draft would leave that month impossible to re-run, adjust or correct, while still
 * being lockable and payable at whatever partial figures the preview happened to hold.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('payslip_history', (t) => {
    t.integer('calc_version').notNullable().defaultTo(2);
  });

  // Freeze only periods that are genuinely finished: strictly before the current month, and
  // either locked or never formally run (the single-employee case the note above describes).
  // An open draft of a past month counts as paid — that is the gap this migration exists for.
  const now = new Date();
  const curYear = now.getUTCFullYear();
  const curMonth = now.getUTCMonth() + 1;

  const updated = await knex('payslip_history')
    .whereRaw('(year * 12 + month) < ?', [curYear * 12 + curMonth])
    .update({ calc_version: 1 });

  const periods = await knex('payslip_history')
    .where('calc_version', 1).distinct('year', 'month').orderBy(['year', 'month']);
  console.log(`  frozen ${updated} payslip(s) at calc_version 1 across ${periods.length} period(s):`);
  for (const p of periods) console.log(`    ${String(p.month).padStart(2, '0')}/${p.year}`);

  const live = await knex('payslip_history')
    .whereRaw('(year * 12 + month) >= ?', [curYear * 12 + curMonth]).count('id as c').first();
  if (Number(live?.c ?? 0) > 0) {
    console.log(`  left ${live!.c} payslip(s) in the current month unfrozen — that month is still open`);
  }

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
