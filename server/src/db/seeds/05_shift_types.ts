import type { Knex } from 'knex';

/**
 * A starting set of shift types.
 *
 * Nothing has ever created these — not the migrations, not the seeds — so on a fresh install
 * the table was empty, seed 11 found no shifts to assign, and every employee showed "No shift
 * assigned". Shifts are org-specific, so these are a sensible default to edit rather than a
 * fixed catalogue.
 *
 * Includes a night shift on purpose: a shift that ends the following day is the case the
 * attendance and payroll calculations most often get wrong, so there should always be one in
 * a development database.
 *
 * Idempotent — matched on name, which is unique. Existing shifts are left untouched.
 */
export async function seed(knex: Knex): Promise<void> {
  const shifts = [
    { name: 'General',  start_time: '09:00', end_time: '18:00', roster_color: 'Blue' },
    { name: 'Morning',  start_time: '06:00', end_time: '14:00', roster_color: 'Green' },
    { name: 'Evening',  start_time: '14:00', end_time: '22:00', roster_color: 'Orange' },
    // Crosses midnight — the case worth always having in test data.
    { name: 'Night',    start_time: '22:00', end_time: '06:00', roster_color: 'Purple' },
  ];

  const existing = new Set(await knex('shift_types').pluck('name'));
  const missing = shifts.filter((s) => !existing.has(s.name));
  if (!missing.length) return;

  await knex('shift_types').insert(missing.map((s) => ({ ...s, is_active: true })));
}
