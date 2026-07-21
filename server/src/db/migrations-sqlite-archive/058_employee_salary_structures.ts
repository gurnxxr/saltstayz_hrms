import type { Knex } from 'knex';
import { cloneStructureForEmployee } from '../structureComponents';

// Salary Structure → per-employee configuration.
//
// `salary_structures` becomes polymorphic: a structure is either a TEMPLATE
// (job_title_id set or generic; employee_id NULL) or an EMPLOYEE structure
// (employee_id set; job_title_id NULL). Each employee's assignment is repointed
// from the shared designation template to a private clone, so editing one
// employee's lines no longer affects colleagues. Payslips are unchanged (the
// clone preserves lines + base). Templates stay for recruitment/offers/seeding.
//
// NB: employee_id is added as a PLAIN column (no FK). A referencing column would
// force SQLite to rebuild salary_structures, and dropping the old table fails
// because salary_structure_components / _assignments reference it (FKs on).
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('salary_structures', 'employee_id'))) {
    await knex.schema.alterTable('salary_structures', (t) => {
      t.integer('employee_id'); // owner employee for a private structure; null = template
    });
  }
  await knex.raw(
    'CREATE UNIQUE INDEX IF NOT EXISTS salary_structures_employee_unique ON salary_structures(employee_id) WHERE employee_id IS NOT NULL',
  );

  // Clone each assigned employee's shared structure into a private copy and
  // repoint the assignment. Skips assignments already on a private structure so
  // the step is safe to re-run.
  const assignments = await knex('salary_structure_assignments as a')
    .join('employees as e', 'e.id', 'a.employee_id')
    .select(
      'a.id as assignment_id', 'a.employee_id', 'a.structure_id', 'a.base',
      'e.first_name', 'e.last_name', 'e.employee_code',
    );

  for (const a of assignments) {
    const src = await knex('salary_structures').where('id', a.structure_id).first();
    if (!src || src.employee_id != null) continue; // already private → skip
    const name = `${a.first_name ?? ''} ${a.last_name ?? ''} · ${a.employee_code ?? a.employee_id}`.trim();
    const newId = await cloneStructureForEmployee(knex, {
      srcStructureId: a.structure_id,
      employeeId: a.employee_id,
      name,
      base: Number(a.base),
    });
    await knex('salary_structure_assignments').where('id', a.assignment_id).update({ structure_id: newId });
  }
}

export async function down(knex: Knex): Promise<void> {
  // Non-restoring (matches the project's forward-only posture). Dropping the
  // column would rebuild salary_structures and trip the child FKs, so we only
  // drop the private index; the employee_id column is left in place.
  await knex.raw('DROP INDEX IF EXISTS salary_structures_employee_unique');
}
