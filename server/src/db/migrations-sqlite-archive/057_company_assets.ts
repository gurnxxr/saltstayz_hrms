import type { Knex } from 'knex';

// Company Assets: a catalog of issuable item types + a per-employee assignment
// register. Assets are issued during employment and collected back at exit — the
// Exit Interview completion flow ties returns to the exit event via
// asset_assignments.exit_interview_id. Runs after 056 (exit_interviews exists).
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('asset_types', (t) => {
    t.increments('id').primary();
    t.string('name', 100).notNullable();
    t.string('category', 40).notNullable().defaultTo('Other');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamps(true, true);
    t.unique(['name']); // case-insensitive uniqueness is enforced in the service
  });

  await knex.schema.createTable('asset_assignments', (t) => {
    t.increments('id').primary();
    t.integer('employee_id').unsigned().notNullable().references('id').inTable('employees').onDelete('CASCADE');
    t.integer('asset_type_id').unsigned().notNullable().references('id').inTable('asset_types').onDelete('RESTRICT');
    t.string('identifier', 120);                 // serial no / asset tag / uniform size
    t.date('assigned_date').notNullable();
    t.integer('assigned_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.string('status', 12).notNullable().defaultTo('assigned'); // assigned | returned | lost
    t.date('returned_date');
    t.integer('returned_collected_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.integer('exit_interview_id').unsigned().references('id').inTable('exit_interviews').onDelete('SET NULL');
    t.text('note');            // note captured at issue
    t.text('condition_note');  // note captured on return (damage, missing parts, …)
    t.timestamps(true, true);
    t.index(['employee_id', 'status']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('asset_assignments');
  await knex.schema.dropTableIfExists('asset_types');
}
