import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('shift_types', (table) => {
    table.increments('id').primary();
    table.string('name', 50).notNullable();
    table.time('start_time').notNullable();
    table.time('end_time').notNullable();
    table.integer('property_id').unsigned().notNullable().references('id').inTable('properties').onDelete('CASCADE');
    table.boolean('is_active').defaultTo(true);
    table.timestamps(true, true);
  });

  await knex.schema.createTable('shift_rosters', (table) => {
    table.increments('id').primary();
    table.integer('employee_id').unsigned().notNullable().references('id').inTable('employees').onDelete('CASCADE');
    table.integer('shift_type_id').unsigned().notNullable().references('id').inTable('shift_types').onDelete('RESTRICT');
    table.date('date').notNullable();
    table.integer('property_id').unsigned().notNullable().references('id').inTable('properties').onDelete('CASCADE');
    table.integer('assigned_by').unsigned().notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.unique(['employee_id', 'date']);
    table.timestamps(true, true);
  });

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_shift_roster_property_date ON shift_rosters(property_id, date)');

  await knex.schema.createTable('shift_change_requests', (table) => {
    table.increments('id').primary();
    table.integer('shift_type_id').unsigned().notNullable().references('id').inTable('shift_types').onDelete('CASCADE');
    table.integer('requested_by').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('field_changed', 50).notNullable();
    table.string('old_value', 50).notNullable();
    table.string('new_value', 50).notNullable();
    table.string('status', 20).defaultTo('pending');
    table.integer('approved_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    table.text('reason');
    table.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('shift_change_requests');
  await knex.schema.dropTableIfExists('shift_rosters');
  await knex.schema.dropTableIfExists('shift_types');
}
