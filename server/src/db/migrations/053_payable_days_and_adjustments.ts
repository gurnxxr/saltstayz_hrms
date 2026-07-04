import type { Knex } from 'knex';

// Payroll Phase 3: attendance-driven payroll.
//
// 1. Pay Schedule gains the two policies the payable-days engine needs:
//    - unmarked_day_policy: what a working day with NO attendance record means
//      for monthly-rated staff ('present' | 'absent'). Hourly staff need no
//      policy — no hours simply means no pay.
//    - holidays_paid: whether regional holidays count as paid working days
//      (standard hospitality practice) or are excluded like weekly offs.
// 2. payroll_adjustments: per employee per run — HR's review-step corrections:
//    an LOP override and/or one manual adjustment line, always with a note.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('pay_schedule_settings', (t) => {
    t.string('unmarked_day_policy', 10).notNullable().defaultTo('present'); // present | absent
  });
  await knex.schema.alterTable('pay_schedule_settings', (t) => {
    t.boolean('holidays_paid').notNullable().defaultTo(true);
  });

  await knex.schema.createTable('payroll_adjustments', (t) => {
    t.increments('id').primary();
    t.integer('employee_id').unsigned().notNullable().references('id').inTable('employees').onDelete('CASCADE');
    t.integer('month').notNullable();
    t.integer('year').notNullable();
    t.decimal('lop_override', 6, 2); // null = use the computed LOP
    t.decimal('adjustment_amount', 12, 2).notNullable().defaultTo(0); // + earning / − deduction
    t.string('adjustment_label', 120);
    t.text('note');
    t.integer('updated_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
    t.unique(['employee_id', 'month', 'year']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('payroll_adjustments');
  await knex.schema.alterTable('pay_schedule_settings', (t) => { t.dropColumn('holidays_paid'); });
  await knex.schema.alterTable('pay_schedule_settings', (t) => { t.dropColumn('unmarked_day_policy'); });
}
