import type { Knex } from 'knex';

// Admin-controlled sanction per property x role (job_title): how many people may be
// hired (sanctioned_headcount), the monthly CTC budget cap (sanctioned_budget_monthly),
// and the allowed salary band (band_min..band_max, monthly CTC). The Add-Hire guardrail
// reads these to block over-headcount / over-band / over-budget hires.
export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('manpower_sanctions')) return;
  await knex.schema.createTable('manpower_sanctions', (t) => {
    t.increments('id').primary();
    t.integer('property_id').unsigned().notNullable()
      .references('id').inTable('properties').onDelete('CASCADE');
    t.integer('job_title_id').unsigned().notNullable()
      .references('id').inTable('job_titles').onDelete('CASCADE');

    t.integer('sanctioned_headcount').notNullable().defaultTo(0);
    t.decimal('sanctioned_budget_monthly', 14, 2).notNullable().defaultTo(0); // monthly CTC cap
    t.decimal('band_min', 12, 2).notNullable().defaultTo(0); // monthly CTC band floor
    t.decimal('band_max', 12, 2).notNullable().defaultTo(0); // monthly CTC band ceiling
    t.boolean('is_locked').notNullable().defaultTo(false);
    t.text('notes');

    t.integer('created_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.integer('updated_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);

    t.unique(['property_id', 'job_title_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('manpower_sanctions');
}
