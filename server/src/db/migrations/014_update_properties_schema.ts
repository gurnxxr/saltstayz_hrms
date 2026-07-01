import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('properties', (table) => {
    table.string('hotel_id', 50).nullable();
    table.string('category', 100).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('properties', (table) => {
    table.dropColumn('hotel_id');
    table.dropColumn('category');
  });
}
