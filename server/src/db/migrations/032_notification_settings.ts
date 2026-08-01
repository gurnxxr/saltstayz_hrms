import type { Knex } from 'knex';

/**
 * Who gets told what, as a setting rather than a decision buried in a service.
 *
 * Until now the code assumed the person who must APPROVE something is the only person who needs to
 * KNOW about it, so a leave request notified the reporting manager and nobody else. There was no
 * way — anywhere — to say "also tell finance when a settlement is saved", and no page on which to
 * say it. The events with the largest consequences told nobody at all: a payroll month could be
 * locked, unlocked, or knowingly locked over a "these figures are wrong" warning in silence.
 *
 * One row per ticked box. Absent means not ticked, so an event added to the catalogue later simply
 * appears on the page unticked without needing a backfill here.
 *
 * The seeded rows below reproduce EXACTLY what the code does today, so applying this changes
 * nobody's inbox. They are written out as literals rather than imported from
 * services/notificationEvents.ts on purpose: a migration is frozen history and must produce the
 * same rows in a year, whatever the catalogue has grown into by then.
 *
 * The two `system.*` rows are the single deliberate exception. Nothing fires for them today — a
 * failed nightly backup only reaches console.error — so there is no behaviour to preserve, and
 * leaving them unticked would ship the silent failure this work exists to fix.
 */

const TABLE = 'notification_settings';

/** [event_key, audience] — today's hardcoded recipients, plus the two system alerts. */
const DEFAULTS: Array<[string, string]> = [
  // leave.service.ts — the approver is told a request awaits action.
  ['leave.applied', 'reporting_manager'],
  // regularisation.service.ts — same shape.
  ['attendance.regularisation_raised', 'reporting_manager'],
  // shiftChangeRequest.service.ts — same shape.
  ['shift.change_requested', 'reporting_manager'],
  // manpower.service.ts notifyReplacementNeeded — a global blast to both roles.
  ['employee.replacement_needed', 'hr'],
  ['employee.replacement_needed', 'admin'],
  // manpower.service.ts — an over-limit hire awaiting a decision.
  ['manpower.exception_raised', 'admin'],
  // recruitment.service.ts — the new joiner's manager, then admins for the login.
  ['employee.joined', 'reporting_manager'],
  ['employee.login_needed', 'admin'],
  // New. See the note above: nothing fires for these today.
  ['system.backup_failed', 'admin'],
  ['system.auto_attendance_failed', 'admin'],
];

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable(TABLE)) return;

  await knex.schema.createTable(TABLE, (t) => {
    t.increments('id');
    t.string('event_key', 60).notNullable();
    t.string('audience', 30).notNullable();
    t.boolean('enabled').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    // One row per cell. The dispatcher reads (event_key, audience) on every emit, and the grid
    // saves a whole event's row at once, so this is both the uniqueness rule and the read path.
    t.unique(['event_key', 'audience']);
  });

  await knex(TABLE).insert(
    DEFAULTS.map(([event_key, audience]) => ({ event_key, audience, enabled: true })),
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists(TABLE);
}
