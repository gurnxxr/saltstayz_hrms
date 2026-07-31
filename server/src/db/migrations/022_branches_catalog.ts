import type { Knex } from 'knex';

/**
 * A managed list of branches — the business units employees report into.
 *
 * `employees.branch_unit` arrived in migration 021 as free text, because there was no curated
 * list to point it at. Free text is how the location field ended up meaning two different things,
 * so the unit gets a catalog before the same thing happens twice: typed by hand, "Corporate
 * Office", "Corporate office" and "Corp Office" become three branches that no report can add up.
 *
 * Deliberately a plain name list, exactly like `property_categories` and `departments`. A branch
 * is not a place: it carries no address and no state, and NOTHING about payroll is resolved from
 * it. Which state's Professional Tax, Labour Welfare Fund and minimum wage apply comes from the
 * PROPERTY someone works at, and must keep coming from there — a branch that could also carry a
 * state would recreate the ambiguity this whole change exists to remove.
 */
export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('branches')) return;
  await knex.schema.createTable('branches', (t) => {
    t.increments('id');
    t.string('name', 100).notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  // Case-insensitive, so "Projects" and "projects" cannot both exist. Employees reference a
  // branch by name, so two rows differing only in case would split one unit's headcount in two.
  await knex.schema.raw('CREATE UNIQUE INDEX branches_name_ci_unique ON branches (lower(name))');

  // Seed from whatever employees already carry, so an existing database starts with the real
  // list rather than an empty one. Nothing is invented — if branch_unit is empty everywhere
  // (which it is on a fresh install), this adds nothing.
  const existing: Array<{ branch_unit: string }> = await knex('employees')
    .whereNotNull('branch_unit').whereRaw("trim(branch_unit) <> ''")
    .distinct('branch_unit');
  const names = [...new Set(existing.map((r) => r.branch_unit.trim()))].sort();
  if (names.length) {
    await knex('branches').insert(names.map((name) => ({ name })));
    console.log(`  branches: seeded ${names.length} from existing employee records — ${names.join(', ')}`);
  } else {
    console.log('  branches: created, empty. Add them in Admin → Organization → Branches.');
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('branches')) await knex.schema.dropTable('branches');
}
