import type { Knex } from 'knex';

/**
 * Two pre-launch corrections to how attendance turns into pay.
 *
 * 1. A missing biometric record ("No Punch") must pay NOTHING until someone reviews it.
 *    It shipped defaulting to full pay, which meant a fingerprint reader failing for a week
 *    would silently pay an entire property for days nobody could evidence. Migration 017 seeds
 *    its defaults with `onConflict('code').ignore()`, so databases that already ran it still
 *    hold the old value and need this patch.
 *
 *    Deliberately narrow: only rows still sitting at the old default of 1 are corrected. If an
 *    admin has since chosen a value on purpose — including choosing 1 knowingly — that is their
 *    decision and this migration leaves it alone. The `updated_by IS NULL` check is what
 *    distinguishes "never touched by a human" from "deliberately set".
 *
 * 2. "Absent" is removed as something an employee can REQUEST their attendance be corrected to.
 *    Asking to be marked absent is not a correction, and because an approved regularisation pays
 *    the day in full, it was a route to being paid for a day you declared you did not work —
 *    three times a month, per person. Pending requests are cancelled (the employee can re-raise
 *    a real correction); already-approved ones are left untouched so history stays honest, and
 *    are listed in the output so they can be reviewed by hand.
 */
export async function up(knex: Knex): Promise<void> {
  // ── 1. No Punch pays nothing ──
  if (await knex.schema.hasTable('attendance_pay_rules')) {
    const patched = await knex('attendance_pay_rules')
      .where('code', 'no_punch')
      .where('pay_fraction', 1)
      .whereNull('updated_by')
      .update({ pay_fraction: 0, updated_at: knex.fn.now() });
    console.log(patched
      ? '  no_punch now pays nothing until reviewed'
      : '  no_punch left as-is (already corrected, or deliberately set by an admin)');
  }

  // ── 2. "Absent" is no longer a requestable correction ──
  if (await knex.schema.hasTable('attendance_regularisations')) {
    const cancelled = await knex('attendance_regularisations')
      .where('requested_status', 'absent')
      .where('status', 'pending')
      .update({
        status: 'rejected',
        reviewer_comment: 'Automatically withdrawn: a day can no longer be corrected to Absent.',
        decided_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      });
    if (cancelled) console.log(`  withdrew ${cancelled} pending "mark me absent" request(s)`);

    const approved = await knex('attendance_regularisations')
      .where('requested_status', 'absent').where('status', 'approved')
      .select('id', 'employee_id', 'date');
    if (approved.length) {
      console.log(`  NOTE: ${approved.length} already-approved "absent" regularisation(s) remain and paid those days in full.`);
      console.log('        Left in place so history stays honest. Review by hand if the pay looks wrong:');
      for (const r of approved) {
        console.log(`          request #${r.id} — employee ${r.employee_id} on ${String(r.date).slice(0, 10)}`);
      }
    }
  }
}

/**
 * Puts the no_punch default back to full pay. The withdrawn regularisation requests are NOT
 * reinstated — re-opening a request the system has told the employee was withdrawn would be
 * more confusing than leaving it closed, and they can simply raise a new one.
 */
export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('attendance_pay_rules')) {
    await knex('attendance_pay_rules')
      .where('code', 'no_punch').whereNull('updated_by')
      .update({ pay_fraction: 1, updated_at: knex.fn.now() });
  }
}
