import type { Knex } from 'knex';

// Extend shift_types into a full ERPNext-style Shift Type definition: holiday list
// (→ regions), roster colour, auto-attendance automation, late-entry / early-exit
// grace, and overtime rules. All columns are additive with sensible defaults so the
// existing quick create (name/start/end) on the /shifts page keeps working.
const ADDED_COLUMNS = [
  'holiday_region_id', 'roster_color', 'enable_auto_attendance',
  'determine_checkin_checkout', 'working_hours_calculation',
  'begin_checkin_before_mins', 'allow_checkout_after_mins',
  'mark_auto_attendance_on_holidays', 'half_day_threshold', 'absent_threshold',
  'process_attendance_after', 'last_sync_of_checkin', 'auto_update_last_sync',
  'enable_late_entry_marking', 'late_entry_grace_period',
  'enable_early_exit_marking', 'early_exit_grace_period',
  'allow_overtime', 'overtime_type',
];

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('shift_types', (t) => {
    // Main section
    t.integer('holiday_region_id');                              // link → regions (holiday list)
    t.string('roster_color', 20).notNullable().defaultTo('Blue');
    t.boolean('enable_auto_attendance').defaultTo(false);

    // Auto Attendance Settings
    t.string('determine_checkin_checkout', 20).defaultTo('alternating'); // alternating | log_type
    t.string('working_hours_calculation', 20).defaultTo('first_last');   // first_last | every_valid
    t.integer('begin_checkin_before_mins').defaultTo(60);
    t.integer('allow_checkout_after_mins').defaultTo(60);
    t.boolean('mark_auto_attendance_on_holidays').defaultTo(false);
    t.decimal('half_day_threshold', 5, 2).defaultTo(0);          // 0 disables
    t.decimal('absent_threshold', 5, 2).defaultTo(0);            // 0 disables
    t.date('process_attendance_after');                          // attendance only marked after this date
    t.datetime('last_sync_of_checkin');
    t.boolean('auto_update_last_sync').defaultTo(false);

    // Late Entry & Early Exit
    t.boolean('enable_late_entry_marking').defaultTo(false);
    t.integer('late_entry_grace_period').defaultTo(0);
    t.boolean('enable_early_exit_marking').defaultTo(false);
    t.integer('early_exit_grace_period').defaultTo(0);

    // Overtime
    t.boolean('allow_overtime').defaultTo(false);
    t.string('overtime_type', 100);
  });
}

export async function down(knex: Knex): Promise<void> {
  // SQLite drops one column per ALTER — do them individually.
  for (const col of ADDED_COLUMNS) {
    await knex.schema.alterTable('shift_types', (t) => t.dropColumn(col));
  }
}
