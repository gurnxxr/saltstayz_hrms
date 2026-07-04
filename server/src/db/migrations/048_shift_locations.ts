import type { Knex } from 'knex';

// Shift Location: a simple master list of physical locations where shifts occur.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('shift_locations', (t) => {
    t.increments('id').primary();
    t.string('name', 120).notNullable();
    t.timestamps(true, true);
  });
  await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS shift_locations_name_unique ON shift_locations(name)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('shift_locations');
}
