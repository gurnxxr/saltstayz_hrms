import type { Knex } from 'knex';

// Leaves module (admin layer): encashable flag on leave types + leave
// encashment records. Encashment is RECORD-ONLY by design — approving one
// deducts the days from the entitlement, but Finance pays it outside payroll
// (no payslip line). Rate is captured at request time as Basic ÷ 30, the same
// convention the offboarding Full & Final settlement uses.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('leave_types', (t) => {
    t.boolean('is_encashable').notNullable().defaultTo(false);
  });
  await knex('leave_types').where('name', 'Earned Leave').update({ is_encashable: true });

  await knex.schema.createTable('leave_encashments', (t) => {
    t.increments('id').primary();
    t.integer('employee_id').unsigned().notNullable().references('id').inTable('employees').onDelete('CASCADE');
    t.integer('leave_type_id').unsigned().notNullable().references('id').inTable('leave_types').onDelete('RESTRICT');
    t.integer('leave_period_id').unsigned().notNullable().references('id').inTable('leave_periods').onDelete('RESTRICT');
    t.decimal('days', 4, 1).notNullable();
    t.decimal('per_day_rate', 10, 2).notNullable();
    t.decimal('amount', 12, 2).notNullable();
    t.string('status', 12).notNullable().defaultTo('pending'); // pending | approved | rejected
    t.text('note');
    t.text('rejection_reason');
    t.integer('requested_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.integer('approved_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('approved_at');
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('leave_encashments');
  await knex.schema.alterTable('leave_types', (t) => { t.dropColumn('is_encashable'); });
}
