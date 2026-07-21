import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('roles', (table) => {
    table.increments('id').primary();
    table.string('name', 50).unique().notNullable();
    table.text('description');
    table.timestamps(true, true);
  });

  await knex.schema.createTable('permissions', (table) => {
    table.increments('id').primary();
    table.string('module', 50).notNullable();
    table.string('action', 50).notNullable();
    table.timestamps(true, true);
    table.unique(['module', 'action']);
  });

  await knex.schema.createTable('role_permissions', (table) => {
    table.integer('role_id').unsigned().notNullable().references('id').inTable('roles').onDelete('CASCADE');
    table.integer('permission_id').unsigned().notNullable().references('id').inTable('permissions').onDelete('CASCADE');
    table.primary(['role_id', 'permission_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('role_permissions');
  await knex.schema.dropTableIfExists('permissions');
  await knex.schema.dropTableIfExists('roles');
}
