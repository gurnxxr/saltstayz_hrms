import type { Knex } from 'knex';

// A salary structure per designation (job title). Defines the base gross plus the
// configurable percentage for each percentage-based component and the fixed/manual
// amounts. New employees inherit their designation's structure; the offer letter and
// payslip both compute from it. Every field is editable by admin.
export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('designation_salary_structures')) return;
  await knex.schema.createTable('designation_salary_structures', (table) => {
    table.increments('id').primary();
    table.integer('job_title_id').unsigned().notNullable().unique()
      .references('id').inTable('job_titles').onDelete('CASCADE');

    table.decimal('gross', 12, 2).notNullable().defaultTo(0);   // Fixed Salary A (per MW)
    table.string('city', 80).defaultTo('Haryana');              // drives LWF defaults

    // Editable percentages
    table.decimal('pct_basic', 6, 2).notNullable().defaultTo(50);        // % of Gross
    table.decimal('pct_hra', 6, 2).notNullable().defaultTo(50);          // % of Basic
    table.decimal('pct_employee_pf', 6, 2).notNullable().defaultTo(12);  // % of (Basic+Other)
    table.decimal('pct_esi', 6, 2).notNullable().defaultTo(0.75);        // % of Gross
    table.decimal('pct_employer_pf', 6, 2).notNullable().defaultTo(12);  // % of (Basic+Other)
    table.decimal('pct_gratuity', 6, 2).notNullable().defaultTo(4.81);   // % of Basic
    table.decimal('pct_employer_esi', 6, 2).notNullable().defaultTo(3.25); // % of Gross

    // Editable fixed / manual amounts
    table.decimal('pli', 12, 2).defaultTo(0);                   // Variable Pay
    table.decimal('lwf_employee', 12, 2);                       // null → city default
    table.decimal('lwf_employer', 12, 2);
    table.decimal('meal', 12, 2).defaultTo(0);                  // deduction (manual)
    table.decimal('accommodation', 12, 2).defaultTo(0);        // deduction (manual)
    table.decimal('accommodation_allowance', 12, 2).defaultTo(0); // benefit (tentative)

    table.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('designation_salary_structures');
}
