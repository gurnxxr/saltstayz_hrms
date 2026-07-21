import type { Knex } from 'knex';

// Per-state minimum wage, used by Statutory Bonus (bonus = % of minimum wage or
// Basic+DA, whichever is higher). Seeded empty — the UI shows "Minimum wage
// details are not added for <state>" until an admin adds one.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('state_minimum_wages', (t) => {
    t.increments('id').primary();
    t.string('state', 100).notNullable();
    t.string('category', 50).notNullable().defaultTo('general'); // skilled/semi-skilled/unskilled/general
    t.decimal('monthly_wage', 12, 2).notNullable().defaultTo(0);
    t.date('effective_from').nullable();
    t.integer('updated_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.unique(['state', 'category']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('state_minimum_wages');
}
