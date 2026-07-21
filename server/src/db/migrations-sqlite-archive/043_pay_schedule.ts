import type { Knex } from 'knex';

// Org-wide pay-schedule settings (a SINGLETON row). Drives payroll:
//  - work_week: which weekdays count as working days → payable days & loss of pay
//  - salary_calculation_method: monthly salary denominator (actual calendar days vs a fixed number)
//  - pay_date_type / pay_date_day: when employees are paid
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('pay_schedule_settings', (t) => {
    t.increments('id').primary();
    // JSON array of working weekday indices (0=Sun … 6=Sat). Default Mon–Fri.
    t.text('work_week').notNullable().defaultTo('[1,2,3,4,5]');
    // 'actual_days' = actual calendar days in the month; 'fixed_days' = fixed denominator.
    t.string('salary_calculation_method', 20).notNullable().defaultTo('actual_days');
    t.integer('fixed_working_days').notNullable().defaultTo(30);
    // 'last_day' = last day of the month; 'fixed_day' = a specific day number.
    t.string('pay_date_type', 20).notNullable().defaultTo('last_day');
    t.integer('pay_date_day').notNullable().defaultTo(1);
    t.integer('updated_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // Seed the single settings row with the spec's defaults (Mon–Fri, actual days, last day).
  await knex('pay_schedule_settings').insert({
    work_week: '[1,2,3,4,5]',
    salary_calculation_method: 'actual_days',
    fixed_working_days: 30,
    pay_date_type: 'last_day',
    pay_date_day: 1,
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('pay_schedule_settings');
}
