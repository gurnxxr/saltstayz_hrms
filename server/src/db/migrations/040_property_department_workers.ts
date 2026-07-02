import type { Knex } from 'knex';

// Admin-managed manual worker count per property × department (Property Configuration).
// This is a planning figure the admin edits directly — independent of the live
// employee roster (which is still derived from employees for spend/avg).
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('property_department_workers', (t) => {
    t.increments('id').primary();
    t.integer('property_id').notNullable().references('id').inTable('properties').onDelete('CASCADE');
    t.string('department', 100).notNullable();
    t.integer('worker_count').notNullable().defaultTo(0);
    t.timestamps(true, true);
    t.unique(['property_id', 'department']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('property_department_workers');
}
