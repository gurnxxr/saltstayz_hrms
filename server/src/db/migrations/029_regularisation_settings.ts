import type { Knex } from 'knex';

/**
 * Make the regularisation guardrails configurable, and give them a deadline.
 *
 * Three of these four were hardcoded constants in regularisation.service.ts — a monthly request
 * cap of 3, a 31-day range ceiling, and the list of statuses an employee may ask for. Sensible
 * defaults, but HR could not see them, let alone change them, so every question about "how many
 * corrections do we allow" ended at a developer.
 *
 * The fourth is new. Regularisation had NO deadline: the only gate was whether the payroll month
 * could still be re-priced, which stays open indefinitely for any month nobody has locked. That
 * makes attendance permanently negotiable — someone can rewrite a day from eight months ago and
 * the money follows. `cutoff_days_after_month_end` closes each attendance month N days after it
 * ends: 2 means July's corrections close on 2 August.
 *
 * NULLABLE on purpose, and null is not "unset" — it is the explicit opt-out that reproduces
 * today's behaviour of no deadline at all. That is why the column takes no NOT NULL and no
 * default beyond the seeded row: a site that wants corrections open forever must be able to say
 * so, and the settings service has to tell "the admin cleared this field" apart from "the form
 * didn't send it".
 *
 * Seeded with the values that were already in force (3 / 31 / the four types), so applying this
 * migration changes no behaviour except introducing the 2-day deadline.
 */

const TABLE = 'regularisation_settings';

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable(TABLE)) return;

  await knex.schema.createTable(TABLE, (t) => {
    t.increments('id');
    // Null = no deadline. See the note above: this is a meaningful value, not a missing one.
    t.integer('cutoff_days_after_month_end').nullable();
    t.integer('monthly_request_limit').notNullable().defaultTo(3);
    t.integer('max_range_days').notNullable().defaultTo(31);
    // JSON array of regularisation type codes, matching TYPE_TO_STATUS in regularisation.service.
    // Text rather than a join table: it is a short whitelist edited as one unit, never queried
    // across, and pay_schedule_settings.work_week already stores a set this way.
    t.text('allowed_types').notNullable().defaultTo('["np","mp","sp","present"]');
    t.integer('updated_by');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.alterTable(TABLE, (t) => {
    t.foreign('updated_by').references('id').inTable('users').onDelete('SET NULL');
  });

  // The singleton. Written explicitly rather than left to the column defaults so the deadline
  // lands as 2 — the defaults above cover the other three, but a nullable column has no default
  // to fall back on and would otherwise seed as "no deadline".
  await knex(TABLE).insert({
    cutoff_days_after_month_end: 2,
    monthly_request_limit: 3,
    max_range_days: 31,
    allowed_types: JSON.stringify(['np', 'mp', 'sp', 'present']),
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists(TABLE);
}
