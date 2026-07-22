import type { Knex } from 'knex';

/**
 * Reshapes a shift so it carries all of its own rules, instead of the weekly roster grid
 * deciding who works when.
 *
 * Three kinds of change:
 *
 *  RENAMES — several columns already held the right thing under a name that didn't say so.
 *  `process_attendance_after` is exactly an effective date, and the punch/grace columns were
 *  being collected by the shift form and read by nothing. Renaming preserves both the data
 *  and, for the two that are live, the behaviour.
 *
 *  ADDITIONS — the genuinely new rules. `ends_next_day` is backfilled from the guess the code
 *  makes today (an end time at or before the start time means the shift crosses midnight), so
 *  existing shifts behave exactly as before.
 *
 *  REMOVALS — ten columns the shift form collected and nothing ever read. `holiday_region_id`
 *  is among them: holidays resolve through the employee's property and its state, so a shift
 *  never had a part in that chain.
 */

const DROPPED = [
  'holiday_region_id',                // holidays come from the property's state, never the shift
  'determine_checkin_checkout',       // folded into attendance_basis
  'working_hours_calculation',        // folded into attendance_basis
  'mark_auto_attendance_on_holidays',
  'last_sync_of_checkin',
  'auto_update_last_sync',
  'enable_late_entry_marking',        // replaced by the single grace_enabled
  'enable_early_exit_marking',        // replaced by the single grace_enabled
  'overtime_type',                    // replaced by overtime_after_hours
  'property_id',                      // shift types are org-wide; the code already stubbed this
];

const RENAMES: Array<[string, string]> = [
  ['process_attendance_after', 'effective_from'],
  ['begin_checkin_before_mins', 'max_early_in_mins'],
  ['allow_checkout_after_mins', 'max_late_out_mins'],
  ['late_entry_grace_period', 'late_in_grace_mins'],
  ['early_exit_grace_period', 'early_out_grace_mins'],
  ['half_day_threshold', 'half_day_hours'],
  ['absent_threshold', 'absent_hours'],
];

export async function up(knex: Knex): Promise<void> {
  // ── Carry the old attendance-basis choice across before its source columns go ──
  await knex.schema.alterTable('shift_types', (t) => {
    // How the day's in and out are picked from the punches.
    t.string('attendance_basis', 20).notNullable().defaultTo('first_last');
  });
  await knex('shift_types')
    .where('working_hours_calculation', 'every_valid')
    .update({ attendance_basis: 'every_valid' });

  // ── Renames ──
  for (const [from, to] of RENAMES) {
    await knex.schema.alterTable('shift_types', (t) => t.renameColumn(from, to));
  }

  // ── New rules ──
  await knex.schema.alterTable('shift_types', (t) => {
    t.boolean('ends_next_day').notNullable().defaultTo(false);

    t.boolean('grace_enabled').notNullable().defaultTo(false);
    t.integer('grace_occurrences_per_month').notNullable().defaultTo(0);

    t.float('full_day_hours').notNullable().defaultTo(0);
    t.float('overtime_after_hours').notNullable().defaultTo(0);

    t.text('office_hour_time');   // expected paid hours in a normal day, HH:MM
    t.text('force_time_out');     // auto-close an open day at this time — stored, not yet applied

    // Off-day pattern. [] means the shift declares none, so the company work week applies.
    // Entries are { day: 0-6, weeks: null | number[] } — weeks null is every week, [2,4] is
    // the 2nd and 4th occurrence of that weekday in the month.
    t.jsonb('weekly_off_days').notNullable().defaultTo(knex.raw("'[]'::jsonb"));

    t.float('monthly_adjustment');       // stored, not yet applied — meaning to be confirmed
    t.string('consider_na', 20);         // overrides the company unmarked-day policy when set
  });

  // A shift whose end time is at or before its start time crosses midnight. This is the
  // guess the calculation makes today, so seeding it keeps every existing shift identical.
  const overnight = await knex('shift_types')
    .whereRaw('end_time <= start_time')
    .update({ ends_next_day: true });
  console.log(`  marked ${overnight} shift(s) as ending the next day`);

  // Grace was previously two independent switches; a shift had grace if either was on.
  const graced = await knex('shift_types')
    .where((q) => q.where('late_in_grace_mins', '>', 0).orWhere('early_out_grace_mins', '>', 0))
    .update({ grace_enabled: true });
  console.log(`  enabled grace on ${graced} shift(s) that already had a grace value`);

  // ── Removals ──
  await knex.schema.alterTable('shift_types', (t) => {
    for (const c of DROPPED) t.dropColumn(c);
  });
  console.log(`  dropped ${DROPPED.length} columns nothing was reading`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('shift_types', (t) => {
    t.integer('holiday_region_id');
    t.string('determine_checkin_checkout', 20).defaultTo('alternating');
    t.string('working_hours_calculation', 20).defaultTo('first_last');
    t.boolean('mark_auto_attendance_on_holidays').defaultTo(false);
    t.text('last_sync_of_checkin');
    t.boolean('auto_update_last_sync').defaultTo(false);
    t.boolean('enable_late_entry_marking').defaultTo(false);
    t.boolean('enable_early_exit_marking').defaultTo(false);
    t.string('overtime_type', 100);
    t.integer('property_id');
  });

  await knex('shift_types').where('attendance_basis', 'every_valid').update({ working_hours_calculation: 'every_valid' });

  await knex.schema.alterTable('shift_types', (t) => {
    t.dropColumn('attendance_basis');
    t.dropColumn('ends_next_day');
    t.dropColumn('grace_enabled');
    t.dropColumn('grace_occurrences_per_month');
    t.dropColumn('full_day_hours');
    t.dropColumn('overtime_after_hours');
    t.dropColumn('office_hour_time');
    t.dropColumn('force_time_out');
    t.dropColumn('weekly_off_days');
    t.dropColumn('monthly_adjustment');
    t.dropColumn('consider_na');
  });

  for (const [from, to] of RENAMES) {
    await knex.schema.alterTable('shift_types', (t) => t.renameColumn(to, from));
  }
}
