import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Per-employee salary configuration (the INPUTS to the payslip calculation).
  // Derived components (basic, hra, PF, ESI, gratuity, etc.) are computed at
  // generation time from `gross` + these manual/variable inputs — never stored here.
  await knex.schema.createTable('salary_setup', (table) => {
    table.increments('id').primary();
    table.integer('employee_id').unsigned().notNullable().unique()
      .references('id').inTable('employees').onDelete('CASCADE');
    table.decimal('gross', 12, 2).notNullable();           // Final gross as per minimum wage
    table.string('city', 80).defaultTo('Delhi');           // drives LWF lookup
    table.decimal('pli', 12, 2).defaultTo(0);              // variable pay
    table.decimal('meal', 12, 2).defaultTo(0);            // manual deduction
    table.decimal('accommodation', 12, 2).defaultTo(0);    // manual deduction
    table.decimal('accommodation_allowance', 12, 2).defaultTo(0); // benefit (tentative cost)
    table.decimal('lwf_employee', 12, 2);                  // optional override of city LWF
    table.decimal('lwf_employer', 12, 2);                  // optional override of city LWF
    table.date('effective_from');
    table.timestamps(true, true);
  });

  // Record of every generated payslip, with a full JSON snapshot of the computed
  // breakdown so historical payslips re-download identically even if salary changes.
  await knex.schema.createTable('payslip_history', (table) => {
    table.increments('id').primary();
    table.integer('employee_id').unsigned().notNullable()
      .references('id').inTable('employees').onDelete('CASCADE');
    table.integer('month').notNullable();   // 1-12
    table.integer('year').notNullable();
    table.date('pay_date');
    table.decimal('gross_earnings', 12, 2).notNullable();
    table.decimal('total_deduction', 12, 2).notNullable();
    table.decimal('net_pay', 12, 2).notNullable();
    table.decimal('ctc', 12, 2).notNullable();
    table.text('snapshot').notNullable();   // JSON of the full computed breakdown
    table.integer('generated_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    table.unique(['employee_id', 'month', 'year']);
    table.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('payslip_history');
  await knex.schema.dropTableIfExists('salary_setup');
}
