import type { Knex } from 'knex';

// Append-only log of every employment_status change, so the historical record is
// retained when an employee moves Active -> PIP -> On Notice -> Left.
export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('employee_status_history')) return;
  await knex.schema.createTable('employee_status_history', (t) => {
    t.increments('id').primary();
    t.integer('employee_id').unsigned().notNullable()
      .references('id').inTable('employees').onDelete('CASCADE');
    t.string('from_status', 20);
    t.string('to_status', 20).notNullable();
    t.decimal('monthly_ctc', 12, 2);
    t.date('effective_date');
    t.date('last_working_day');
    t.text('reason');
    t.integer('changed_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('employee_status_history');
}
