import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('salary_structures', (table) => {
    table.increments('id').primary();
    table.integer('employee_id').unsigned().notNullable().references('id').inTable('employees').onDelete('CASCADE');
    table.decimal('basic', 12, 2).notNullable();
    table.decimal('hra', 12, 2).defaultTo(0);
    table.decimal('da', 12, 2).defaultTo(0);
    table.decimal('special_allowance', 12, 2).defaultTo(0);
    table.decimal('gross', 12, 2).notNullable();
    table.decimal('pf_deduction', 12, 2).defaultTo(0);
    table.decimal('esi_deduction', 12, 2).defaultTo(0);
    table.decimal('tax_deduction', 12, 2).defaultTo(0);
    table.decimal('net_salary', 12, 2).notNullable();
    table.date('effective_from').notNullable();
    table.timestamps(true, true);
  });

  await knex.schema.createTable('payslips', (table) => {
    table.increments('id').primary();
    table.integer('employee_id').unsigned().notNullable().references('id').inTable('employees').onDelete('CASCADE');
    table.integer('month').notNullable();
    table.integer('year').notNullable();
    table.integer('salary_structure_id').unsigned().notNullable().references('id').inTable('salary_structures').onDelete('RESTRICT');
    table.integer('days_worked');
    table.integer('days_absent');
    table.decimal('amount_paid', 12, 2).notNullable();
    table.string('pdf_url', 500);
    table.string('status', 20).defaultTo('draft');
    table.unique(['employee_id', 'month', 'year']);
    table.timestamps(true, true);
  });

  await knex.schema.createTable('employee_exits', (table) => {
    table.increments('id').primary();
    table.integer('employee_id').unsigned().notNullable().unique().references('id').inTable('employees').onDelete('CASCADE');
    table.date('exit_date').notNullable();
    table.string('exit_reason', 50).notNullable();
    table.text('exit_details');
    table.integer('tenure_months');
    table.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('employee_exits');
  await knex.schema.dropTableIfExists('payslips');
  await knex.schema.dropTableIfExists('salary_structures');
}
