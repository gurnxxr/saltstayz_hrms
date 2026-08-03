import type { Knex } from 'knex';

/**
 * Per-ACCOUNT limits on password reset, which the per-IP limiter cannot express.
 *
 * Better Auth caps attempts per code and express-rate-limit caps requests per IP, and neither one
 * closes the hole that matters. A six-digit code with five allowed guesses is a 1-in-200,000 shot —
 * fine, until you notice the attacker can simply ask for a fresh code and take five more guesses,
 * from a new IP each time. Repeat that enough and the odds stop being long. What has to be bounded
 * is the number of guesses against ONE account over time, wherever they come from, and that is a
 * fact about the account, not about a connection.
 *
 * Three dials, one row per user:
 *
 *   `last_issued_at`   a 60-second cooldown, so "resend" cannot be leant on.
 *   `issued_in_window` at most 3 codes per 15 minutes. This is the one that actually bounds the
 *                      attacker's budget, because every new code resets their attempt counter.
 *   `failed_in_hour`   at most 15 failed confirmations an hour, then the account stops accepting
 *                      codes at all for the rest of the hour. Belt to the braces above.
 *
 * Keyed on user_id and NOT on the submitted email, deliberately. Keying on the input would let
 * somebody exhaust a stranger's budget by typing their address — a denial of service on a specific
 * person, dressed up as rate limiting. An unknown address never reaches this table at all.
 *
 * Rows are created lazily on first use and are safe to delete: absence means "no history", which is
 * the same as a fresh window.
 */
export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('password_reset_throttle')) return;

  await knex.schema.createTable('password_reset_throttle', (t) => {
    // One row per user; the PK is the FK. There is nothing else to say about a user here, and a
    // surrogate id would only invite a second row for the same person.
    t.integer('user_id').primary().references('id').inTable('users').onDelete('CASCADE');

    // Issuance. `window_started_at` anchors the 15-minute bucket; both are null until the first code.
    t.timestamp('last_issued_at', { useTz: true });
    t.timestamp('window_started_at', { useTz: true });
    t.integer('issued_in_window').notNullable().defaultTo(0);

    // Failed confirmations, in their own hourly bucket — a different question from issuance, and a
    // different window, so it gets its own anchor rather than sharing one.
    t.timestamp('failed_window_started_at', { useTz: true });
    t.integer('failed_in_hour').notNullable().defaultTo(0);

    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  console.log('  created password_reset_throttle');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('password_reset_throttle');
}
