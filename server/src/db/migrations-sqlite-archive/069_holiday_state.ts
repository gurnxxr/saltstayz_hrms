import type { Knex } from 'knex';

// Holidays move from per-region to per-state. A holiday is either national
// (everyone) or tied to one state (employees whose property is in that state).
//
// We start fresh on the old region-scoped holidays (a region can span several
// states, so a region→state conversion would be lossy) — national holidays are
// kept, region-scoped ones are dropped, and admins re-upload per state.
//
// SQLite: add the column with a hasColumn guard (migration 067's style). The old
// region_id column is left in place (harmless) so this stays a pure add.

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('holidays', 'state'))) {
    await knex.schema.alterTable('holidays', (t) => t.string('state', 100)); // null when national
  }
  // Keep national holidays; drop the region-scoped ones (to be re-uploaded per state).
  await knex('holidays').whereNotNull('region_id').del();
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('holidays', 'state')) {
    await knex.schema.alterTable('holidays', (t) => t.dropColumn('state'));
  }
}
