import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // A payroll run finalizes payslips for a given month. While `draft`, payslips can
  // be (re)generated; once `locked`, the month's payslips are immutable.
  await knex.schema.createTable('payroll_runs', (table) => {
    table.increments('id').primary();
    table.integer('month').notNullable();   // 1-12
    table.integer('year').notNullable();
    table.string('status', 20).notNullable().defaultTo('draft'); // draft | locked
    table.integer('employee_count').defaultTo(0);
    table.decimal('total_net', 14, 2).defaultTo(0);
    table.decimal('total_ctc', 14, 2).defaultTo(0);
    table.integer('generated_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    table.integer('locked_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('locked_at');
    table.unique(['month', 'year']);
    table.timestamps(true, true);
  });

  // Link generated payslips to their run so a lock cascades naturally.
  await knex.schema.alterTable('payslip_history', (table) => {
    table.integer('run_id').unsigned().references('id').inTable('payroll_runs').onDelete('SET NULL');
  });
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('payslip_history', 'run_id')) {
    await knex.schema.alterTable('payslip_history', (t) => t.dropColumn('run_id'));
  }
  await knex.schema.dropTableIfExists('payroll_runs');
}
