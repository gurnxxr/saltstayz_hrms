import type { Knex } from 'knex';

/**
 * One extra counter so the hourly failure budget can slide instead of resetting on a cliff.
 *
 * The budget was a FIXED window anchored on the first failure: fifteen wrong codes at minute 59,
 * the window expires, fifteen more at minute 61 — roughly double the intended guesses, back to
 * back, for anyone who timed the burst. Holding the previous window's count alongside the current
 * one lets `passwordResetThrottle.service` decay the total smoothly rather than dropping it.
 *
 * Defaults to 0, so existing rows are correct without a backfill: an account with no recorded
 * previous window simply has nothing carried forward.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('password_reset_throttle', (t) => {
    t.integer('failed_in_prev_window').notNullable().defaultTo(0);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('password_reset_throttle', (t) => {
    t.dropColumn('failed_in_prev_window');
  });
}
