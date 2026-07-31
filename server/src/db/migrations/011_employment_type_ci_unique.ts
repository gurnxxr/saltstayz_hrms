import type { Knex } from 'knex';

/**
 * Make employment_types.name unique CASE-INSENSITIVELY.
 *
 * Migration 009 declared `unique(['name'])` — a case-sensitive index — but the service
 * checks duplicates with `lower(name) = lower(?)`. Under that mismatch, two concurrent
 * creates of "Contract" and "contract" both pass the app check AND both satisfy the
 * case-sensitive index, leaving two rows the app treats as one. Replacing the index with
 * a unique index on `lower(name)` closes that gap and makes the DB the real guard the
 * service's 23505→"already exists" translation relies on.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('employment_types', (t) => {
    t.dropUnique(['name']); // drops employment_types_name_unique
  });
  await knex.raw('CREATE UNIQUE INDEX employment_types_name_lower_unique ON employment_types (lower(name))');
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS employment_types_name_lower_unique');
  await knex.schema.alterTable('employment_types', (t) => {
    t.unique(['name']);
  });
}
