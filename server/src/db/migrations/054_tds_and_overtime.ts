import type { Knex } from 'knex';

// Payroll Phase 4: optional lines.
// - Manual TDS: a per-employee monthly amount entered by Finance on the
//   structure assignment (no investment-declaration engine — by design).
// - Overtime: org-wide rate multiplier used when an employee's shift type
//   allows overtime (hours beyond shift length × hourly rate × multiplier).
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('salary_structure_assignments', (t) => {
    t.decimal('tds_amount', 12, 2).notNullable().defaultTo(0);
  });
  await knex.schema.alterTable('pay_schedule_settings', (t) => {
    t.decimal('overtime_multiplier', 4, 2).notNullable().defaultTo(2);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('pay_schedule_settings', (t) => { t.dropColumn('overtime_multiplier'); });
  await knex.schema.alterTable('salary_structure_assignments', (t) => { t.dropColumn('tds_amount'); });
}
