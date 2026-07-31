import type { Knex } from 'knex';

/**
 * Adds `pan_number` to `employees`.
 *
 * NOTE — this is deliberately a SECOND place a PAN can live. Finance already holds one on
 * `employee_bank_details.pan_card`, and that is the copy payroll and TDS actually use. This
 * column is the HR record's own copy, captured with the rest of the identity documents at
 * onboarding. The two are not synchronised, so they can disagree; when they do, the finance
 * one is the one that affects money.
 *
 * The column is intentionally NOT unique. A PAN should be unique per person in reality, but
 * enforcing that here would fail the migration on any existing duplicate or placeholder and
 * block the deploy — the check belongs at the point of entry, where it can be explained.
 */
export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasColumn('employees', 'pan_number');
  if (exists) {
    console.log('  employees.pan_number already present');
    return;
  }
  await knex.schema.alterTable('employees', (t) => {
    t.string('pan_number', 10);
  });
  console.log('  added employees.pan_number');
}

export async function down(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasColumn('employees', 'pan_number');
  if (!exists) return;
  await knex.schema.alterTable('employees', (t) => {
    t.dropColumn('pan_number');
  });
  console.log('  dropped employees.pan_number — any PANs recorded there are gone');
}
