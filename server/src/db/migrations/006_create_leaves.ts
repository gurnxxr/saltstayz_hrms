import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('leave_types', (table) => {
    table.increments('id').primary();
    table.string('name', 50).notNullable();
    table.integer('default_days').notNullable();
    table.boolean('is_paid').defaultTo(true);
    table.boolean('is_active').defaultTo(true);
    table.timestamps(true, true);
  });

  await knex.schema.createTable('leave_periods', (table) => {
    table.increments('id').primary();
    table.string('name', 50).notNullable();
    table.date('start_date').notNullable();
    table.date('end_date').notNullable();
    table.boolean('is_current').defaultTo(false);
    table.timestamps(true, true);
  });

  await knex.schema.createTable('leave_entitlements', (table) => {
    table.increments('id').primary();
    table.integer('employee_id').unsigned().notNullable().references('id').inTable('employees').onDelete('CASCADE');
    table.integer('leave_type_id').unsigned().notNullable().references('id').inTable('leave_types').onDelete('CASCADE');
    table.integer('leave_period_id').unsigned().notNullable().references('id').inTable('leave_periods').onDelete('CASCADE');
    table.decimal('total_days', 4, 1).notNullable();
    table.decimal('used_days', 4, 1).defaultTo(0);
    table.unique(['employee_id', 'leave_type_id', 'leave_period_id']);
    table.timestamps(true, true);
  });

  await knex.schema.createTable('leave_requests', (table) => {
    table.increments('id').primary();
    table.integer('employee_id').unsigned().notNullable().references('id').inTable('employees').onDelete('CASCADE');
    table.integer('leave_type_id').unsigned().notNullable().references('id').inTable('leave_types').onDelete('RESTRICT');
    table.date('start_date').notNullable();
    table.date('end_date').notNullable();
    table.decimal('days', 4, 1).notNullable();
    table.text('reason');
    table.string('status', 20).defaultTo('pending');
    table.integer('approved_by').unsigned().references('id').inTable('employees').onDelete('SET NULL');
    table.text('rejection_reason');
    table.timestamps(true, true);
  });

  await knex.schema.createTable('holidays', (table) => {
    table.increments('id').primary();
    table.string('name', 100).notNullable();
    table.date('date').notNullable();
    table.integer('property_id').unsigned().references('id').inTable('properties').onDelete('CASCADE');
    table.boolean('is_recurring').defaultTo(false);
    table.timestamps(true, true);
  });

  await knex.schema.createTable('work_week_config', (table) => {
    table.increments('id').primary();
    table.integer('property_id').unsigned().notNullable().references('id').inTable('properties').onDelete('CASCADE');
    table.integer('day_of_week').notNullable();
    table.boolean('is_working_day').defaultTo(true);
    table.unique(['property_id', 'day_of_week']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('work_week_config');
  await knex.schema.dropTableIfExists('holidays');
  await knex.schema.dropTableIfExists('leave_requests');
  await knex.schema.dropTableIfExists('leave_entitlements');
  await knex.schema.dropTableIfExists('leave_periods');
  await knex.schema.dropTableIfExists('leave_types');
}
