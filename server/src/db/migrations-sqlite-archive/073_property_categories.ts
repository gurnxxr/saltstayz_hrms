import type { Knex } from 'knex';

// A managed pick-list for a property's "Category" field (Admin → Organization →
// Property Categories). Mirrors the departments table: organization-wide, unique
// name. The property still stores its category as a free-text string (properties
// .category); this table just supplies the dropdown's options.
const STARTER_CATEGORIES = ['Premier', 'Select', 'Autograph', 'Boutique', 'Grand', 'Standard'];

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('property_categories');
  if (!exists) {
    await knex.schema.createTable('property_categories', (t) => {
      t.increments('id').primary();
      t.string('name', 100).notNullable();
      t.timestamps(true, true);
    });
    await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS property_categories_name_unique ON property_categories(name)');
  }
  // Seed the starter set for existing databases (fresh installs also get it via the
  // org seed). Skip any that already exist so re-running / seeding stays safe.
  const have = new Set((await knex('property_categories').pluck('name')).map((n) => String(n).trim().toLowerCase()));
  const toAdd = STARTER_CATEGORIES.filter((n) => !have.has(n.toLowerCase()));
  if (toAdd.length) await knex('property_categories').insert(toAdd.map((name) => ({ name })));
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('property_categories');
}
