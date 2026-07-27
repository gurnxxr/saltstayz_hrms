import type { Knex } from 'knex';

/**
 * Separates WHERE somebody works from WHICH UNIT they report into.
 *
 * `employees.branch_name` has been doing both jobs. Most rows hold a hotel — "SaltStayz Gurgaon" —
 * and those resolve against `properties` to give the employee their state, and with it their
 * Professional Tax, Labour Welfare Fund and minimum-wage floor. But a large minority hold a
 * business unit instead — "Corporate Office", "Projects", "Corporate Office Sales" — which is not
 * a place at all and matches no property.
 *
 * That overload is why ~37 people resolve to no property and fall back to a default state: not
 * because their hotel is missing from the catalog, but because the field never held a hotel for
 * them in the first place. One column cannot answer two questions, and the one it was silently
 * failing to answer decides payroll.
 *
 * So the unit gets its own column, and `branch_name` keeps meaning the property.
 *
 * NAMING, deliberately: `branch_name` is NOT renamed. Around thirty queries filter, group and
 * join on it — analytics, leave scoping, manpower budgets, the payroll register — and renaming it
 * a week before launch would touch every one of them for no behavioural gain. It is labelled
 * "Property Name" in the UI, which is what it means. The new column is `branch_unit` rather than
 * anything closer to `branch_name`, so the two can never be confused in a query.
 */
export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('employees', 'branch_unit')) return;
  await knex.schema.alterTable('employees', (t) => {
    // Free text, like dept_name. There is no catalog of units yet, and inventing one now would
    // mean guessing the list from data that has never been curated.
    t.text('branch_unit');
  });

  // Nothing is backfilled. The values exist in the HR source export, not in this database — and
  // copying `branch_name` across would assert that everybody's unit equals their hotel, which is
  // exactly the conflation being undone. It is filled in from the employee upload, or by hand.
  const [{ count }]: any = await knex('employees').where('is_active', true).count('id as count');
  console.log(`  employees.branch_unit added — empty for all ${count} active employee(s).`);
  console.log('  Fill it from the employee CSV upload (column: branch_unit), or on the employee page.');
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('employees', 'branch_unit')) {
    await knex.schema.alterTable('employees', (t) => t.dropColumn('branch_unit'));
  }
}
