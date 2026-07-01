import type { Knex } from 'knex';

// Per-employee module access overrides. Layered on top of role-based access:
//   allowed = 1  → grant this module to the employee (even if their role wouldn't)
//   allowed = 0  → deny this module (even if their role would)
//   no row       → fall back to the role default
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('employee_module_access', (table) => {
    table.increments('id').primary();
    table.integer('employee_id').unsigned().notNullable()
      .references('id').inTable('employees').onDelete('CASCADE');
    table.string('module', 50).notNullable();
    table.boolean('allowed').notNullable().defaultTo(true);
    table.integer('updated_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    table.unique(['employee_id', 'module']);
    table.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('employee_module_access');
}
