import type { Knex } from 'knex';

/**
 * Retires the weekly roster grid.
 *
 * `shift_rosters` is deliberately KEPT. Nothing writes to it any more, but it is the only
 * record of why a past month treated a given day as an off day — the payslip snapshot doesn't
 * store that — so it stays as history. It can be dropped later, once nobody needs to answer
 * questions about a month that predates this change.
 *
 * A change request used to say "give me a different shift on this one date", so it carried a
 * day type alongside the shift: working, or weekly off. Now it says "move me onto this shift
 * from this date", and off days come from the shift itself, so the day type has nothing left
 * to describe.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('employee_shift_change_requests', (t) => {
    t.dropColumn('from_day_type');
    t.dropColumn('to_day_type');
  });

  // Requests raised under the old model asked for a specific date's cell. They can't be
  // fulfilled by the new flow, and leaving them pending would put an un-actionable row in
  // the approver's queue, so close them off with an explanation.
  const stale = await knex('employee_shift_change_requests')
    .where('status', 'pending')
    .update({
      status: 'rejected',
      review_note: 'Closed automatically: shift changes are now requested per shift, not per day. Please raise a new request.',
      updated_at: knex.fn.now(),
    });
  if (stale) console.log(`  closed ${stale} pending request(s) raised under the old per-day model`);

  const rosterRows = await knex('shift_rosters').count('id as c').first();
  console.log(`  kept ${rosterRows?.c ?? 0} roster row(s) as history; nothing writes to them now`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('employee_shift_change_requests', (t) => {
    t.string('from_day_type', 20).notNullable().defaultTo('working');
    t.string('to_day_type', 20).notNullable().defaultTo('working');
  });
}
