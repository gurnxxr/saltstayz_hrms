import type { Knex } from 'knex';

/**
 * Who a holiday is actually for: particular departments and/or particular properties.
 *
 * Until now a holiday reached everyone, or everyone in one state. That cannot say "Management
 * gets Diwali off, Housekeeping works it" — which is how a hotel actually runs, and the rule
 * therefore lived in somebody's head instead of the system.
 *
 * OPT-IN, deliberately. A holiday reaches nobody until someone says who it is for, and
 * "everyone" is a thing you TICK (`all_departments` / `all_properties`), not a thing you get by
 * leaving the picker alone. Two reasons that distinction is worth two extra columns:
 *
 *   • "every department" must keep meaning every department after somebody adds a sixth one.
 *     A stored list of today's five would quietly stop covering the new one.
 *   • "nobody has decided yet" has to look different from "somebody chose everyone", or the
 *     admin screen cannot warn about the first without also nagging about the second.
 *
 * The column defaults are `false` so every path that does not know about scoping yet — a raw
 * insert, an old seed, a script — fails SAFE (reaches nobody, and the reach count says so)
 * rather than failing WIDE (silently gives everyone a paid day off).
 *
 * The two link tables copy `leave_type_departments` (001_baseline_postgres.ts:522) exactly:
 * surrogate id, cascade both ways, unique pair. Note the semantics are the OPPOSITE of that
 * table's — there, no rows means every department; here it means none. That is why the
 * `all_*` flags exist rather than reusing the no-rows-means-all convention.
 *
 * `holidays.property_id` is left alone. It is dead (nothing reads it) but it carries
 * ON DELETE CASCADE to `properties`, so populating it would mean deleting a hotel deletes its
 * holidays. `holiday_properties` cascading only removes a scope row. Dropping the dead column
 * is separate cleanup.
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('holidays', 'all_departments'))) {
    await knex.schema.alterTable('holidays', (t) => {
      t.boolean('all_departments').notNullable().defaultTo(false);
      t.boolean('all_properties').notNullable().defaultTo(false);
    });
  }

  if (!(await knex.schema.hasTable('holiday_departments'))) {
    await knex.schema.createTable('holiday_departments', (t) => {
      t.increments('id');
      t.integer('holiday_id').notNullable();
      t.integer('department_id').notNullable();
    });
    await knex.schema.alterTable('holiday_departments', (t) => {
      t.foreign('holiday_id').references('id').inTable('holidays').onDelete('CASCADE');
      t.foreign('department_id').references('id').inTable('departments').onDelete('CASCADE');
      t.unique(['holiday_id', 'department_id']);
    });
  }

  if (!(await knex.schema.hasTable('holiday_properties'))) {
    await knex.schema.createTable('holiday_properties', (t) => {
      t.increments('id');
      t.integer('holiday_id').notNullable();
      t.integer('property_id').notNullable();
    });
    await knex.schema.alterTable('holiday_properties', (t) => {
      t.foreign('holiday_id').references('id').inTable('holidays').onDelete('CASCADE');
      t.foreign('property_id').references('id').inTable('properties').onDelete('CASCADE');
      t.unique(['holiday_id', 'property_id']);
    });
  }

  // Every holiday that exists today was given to everyone, so record that as a decision rather
  // than let it inherit the opt-in default. Without this line the migration silently takes every
  // published holiday off every calendar — and each one then becomes an ordinary WORKING day in
  // the open month's payable-days calculation, which is a day of pay somebody can lose.
  const backfilled = await knex('holidays')
    .where(function () {
      this.where('all_departments', false).orWhere('all_properties', false);
    })
    .update({ all_departments: true, all_properties: true, updated_at: knex.fn.now() });

  console.log(
    `  holiday scoping: ${backfilled} existing holiday(s) marked "every department, every property" — behaviour unchanged.`,
  );
}

/**
 * Lossy by nature: dropping the tables destroys the targeting and every holiday goes back to
 * reaching everyone in its region. That is the correct rollback — it restores exactly the
 * pre-025 behaviour — and note the direction: rolling back WIDENS audiences, never narrows
 * them, so nobody loses a paid day on the way down.
 */
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('holiday_properties');
  await knex.schema.dropTableIfExists('holiday_departments');
  if (await knex.schema.hasColumn('holidays', 'all_departments')) {
    await knex.schema.alterTable('holidays', (t) => {
      t.dropColumn('all_departments');
      t.dropColumn('all_properties');
    });
  }
}
