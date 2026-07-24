import type { Knex } from 'knex';

/**
 * Adds `department_id` to `salary_structures`, so a template can be scoped to a
 * department (the "Departments" tab) the same way `job_title_id` scopes one to a
 * designation.
 *
 * A template is exactly one of three kinds, kept apart by these two columns:
 *   • designation template — job_title_id set, department_id null
 *   • department template  — department_id set, job_title_id null
 *   • generic template     — both null
 *
 * Department templates are a MANUAL library only: unlike designation templates they
 * are never auto-applied to a new hire's pay or to an offer. Nothing that resolves
 * a template for money (getStructureByJobTitle, the offer/CTC path, the generic
 * seed fallback) will pick one up — the seed fallback query is narrowed to
 * `department_id IS NULL` for exactly that reason.
 *
 * Nullable, no FK constraint — matching the table's existing `job_title_id` /
 * `employee_id`, which are also plain nullable integers. The department is matched
 * to employees by name (`departments.name` = `employees.dept_name`) at read time,
 * so a bad id simply resolves to no employees rather than corrupting anything.
 */
export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasColumn('salary_structures', 'department_id');
  if (exists) {
    console.log('  salary_structures.department_id already present');
    return;
  }
  await knex.schema.alterTable('salary_structures', (t) => {
    t.integer('department_id');
  });
  console.log('  added salary_structures.department_id');
}

export async function down(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasColumn('salary_structures', 'department_id');
  if (!exists) return;
  await knex.schema.alterTable('salary_structures', (t) => {
    t.dropColumn('department_id');
  });
  console.log('  dropped salary_structures.department_id — any department templates are now unscoped');
}
