import type { Knex } from 'knex';

// Regional holidays: properties (PAN India) are grouped into user-defined regions,
// and each holiday is either National (shown to everyone) or tied to one region
// (shown only to employees whose property belongs to that region).
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('regions', (table) => {
    table.increments('id').primary();
    table.string('name', 100).notNullable().unique();
    table.text('description');
    table.timestamps(true, true);
  });

  // Plain integer column (no inline FK) — adding an inline foreign key to an
  // existing table forces a full SQLite table rebuild that can fail.
  await knex.schema.alterTable('properties', (table) => {
    table.integer('region_id');
  });

  await knex.schema.alterTable('holidays', (table) => {
    table.integer('region_id');          // null when national
    table.boolean('is_national').defaultTo(false);
  });

  // Existing org-wide holidays (no property) become national by default.
  await knex('holidays').whereNull('property_id').update({ is_national: true });
}

export async function down(knex: Knex): Promise<void> {
  // One dropColumn per alterTable — SQLite can't drop multiple columns at once.
  await knex.schema.alterTable('holidays', (table) => { table.dropColumn('is_national'); });
  await knex.schema.alterTable('holidays', (table) => { table.dropColumn('region_id'); });
  await knex.schema.alterTable('properties', (table) => { table.dropColumn('region_id'); });
  await knex.schema.dropTableIfExists('regions');
}
