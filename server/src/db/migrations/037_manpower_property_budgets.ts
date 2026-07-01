import type { Knex } from 'knex';

// Property-level sanctioned budget + headcount — the primary cap (Admin > Budget
// Control). When no explicit row exists, the property cap defaults to the roll-up
// of its per-role sanctions. The Add-Hire guardrail caps on these property totals;
// the per-role salary band still bounds each individual salary.
export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('manpower_property_budgets')) return;
  await knex.schema.createTable('manpower_property_budgets', (t) => {
    t.increments('id').primary();
    t.integer('property_id').unsigned().notNullable().unique()
      .references('id').inTable('properties').onDelete('CASCADE');
    t.decimal('sanctioned_budget_monthly', 14, 2).notNullable().defaultTo(0); // total monthly CTC cap
    t.integer('sanctioned_headcount').notNullable().defaultTo(0);             // total people cap
    t.text('notes');
    t.integer('created_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.integer('updated_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('manpower_property_budgets');
}
