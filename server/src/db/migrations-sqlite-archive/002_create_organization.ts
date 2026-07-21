import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('properties', (table) => {
    table.increments('id').primary();
    table.string('name', 100).notNullable();
    table.text('address');
    table.string('city', 100);
    table.string('state', 100);
    table.boolean('is_active').defaultTo(true);
    table.timestamps(true, true);
  });

  await knex.schema.createTable('departments', (table) => {
    table.increments('id').primary();
    table.string('name', 100).notNullable();
    table.integer('property_id').unsigned().references('id').inTable('properties').onDelete('SET NULL');
    table.timestamps(true, true);
  });

  await knex.schema.createTable('employee_categories', (table) => {
    table.increments('id').primary();
    table.string('name', 100).unique().notNullable();
    table.boolean('is_active').defaultTo(true);
    table.timestamps(true, true);
  });

  await knex.schema.createTable('job_titles', (table) => {
    table.increments('id').primary();
    table.string('title', 100).notNullable();
    table.text('description');
    table.timestamps(true, true);
  });

  await knex.schema.createTable('pay_grades', (table) => {
    table.increments('id').primary();
    table.string('name', 50).notNullable();
    table.decimal('min_salary', 12, 2);
    table.decimal('max_salary', 12, 2);
    table.timestamps(true, true);
  });

  await knex.schema.createTable('employment_statuses', (table) => {
    table.increments('id').primary();
    table.string('name', 50).unique().notNullable();
    table.timestamps(true, true);
  });

}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('employment_statuses');
  await knex.schema.dropTableIfExists('pay_grades');
  await knex.schema.dropTableIfExists('job_titles');
  await knex.schema.dropTableIfExists('employee_categories');
  await knex.schema.dropTableIfExists('departments');
  await knex.schema.dropTableIfExists('properties');
}
