import type { Knex } from 'knex';

/**
 * Record what an approved regularisation did to the employee's PAY, not just to their attendance.
 *
 * Approval used to write the attendance row and stop, so a month already generated kept its
 * pre-regularisation figure and nobody could tell afterwards whether the money had moved. The
 * derived staleness check answers "is this payslip out of date NOW", which is the right question
 * at lock time — but it cannot reconstruct what happened at approval time, months later, when
 * somebody is asking why an employee was paid what they were paid.
 *
 * Nullable and unbacked by any default: every row that predates this migration genuinely has no
 * answer, and inventing one ('unknown' as a string, say) would let a reader mistake "we never
 * recorded it" for "we checked and nothing happened".
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('attendance_regularisations'))) return;

  const hasStatus = await knex.schema.hasColumn('attendance_regularisations', 'pay_refresh_status');
  const hasNote = await knex.schema.hasColumn('attendance_regularisations', 'pay_refresh_note');

  await knex.schema.alterTable('attendance_regularisations', (t) => {
    // refreshed | unchanged | no_payslip | blocked | failed
    if (!hasStatus) t.string('pay_refresh_status', 20).nullable();
    // Why, in words an approver can act on — the frozen-month message, or the error.
    if (!hasNote) t.text('pay_refresh_note').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('attendance_regularisations'))) return;
  await knex.schema.alterTable('attendance_regularisations', (t) => {
    t.dropColumn('pay_refresh_status');
    t.dropColumn('pay_refresh_note');
  });
}
