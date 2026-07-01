import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('employees', (table) => {
    table.increments('id').primary();
    table.string('employee_code', 20).unique().notNullable();
    table.string('first_name', 100).notNullable();
    table.string('last_name', 100).notNullable();
    table.date('date_of_birth');
    table.string('father_name', 100);
    table.integer('reporting_manager_id').unsigned().references('id').inTable('employees').onDelete('SET NULL');
    table.string('email', 255);
    table.date('date_of_joining').notNullable();
    table.string('phone', 15);
    table.string('aadhaar_number', 12);
    table.string('dept_name', 100);
    table.integer('job_title_id').unsigned().references('id').inTable('job_titles').onDelete('SET NULL');
    table.string('branch_name', 100);
    table.boolean('is_active').defaultTo(true);
    table.timestamps(true, true);
  });

  await knex.schema.createTable('employee_qualifications', (table) => {
    table.increments('id').primary();
    table.integer('employee_id').unsigned().notNullable().references('id').inTable('employees').onDelete('CASCADE');
    table.string('type', 50).notNullable();
    table.string('name', 200).notNullable();
    table.json('details');
    table.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('employee_qualifications');
  await knex.schema.dropTableIfExists('employees');
}
