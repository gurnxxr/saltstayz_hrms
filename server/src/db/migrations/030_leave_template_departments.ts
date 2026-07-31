import type { Knex } from 'knex';

/**
 * Let a leave template govern whole departments, so nobody has to remember to assign people
 * one at a time.
 *
 * Templates have always been per-employee (`employees.leave_template_id`), which is fine for
 * exceptions and miserable as a policy. "Housekeeping is on the Sunday-off plan" was a fact
 * somebody had to re-apply by hand for every new hire, and the only way to check it held was to
 * read 22 rows on the By Employee tab. Migration 012 explicitly deferred this — "the plan folds
 * that into 'assign the right template to those employees'" — and this is that fold.
 *
 * The UNIQUE is on department_id ALONE, not on the pair. That is the whole point: a department
 * has at most ONE governing template, because an employee has exactly one leave plan and a
 * department claimed by two templates could not say which. Enforcing it here rather than only in
 * the service means a second claim fails even if it arrives through a path that forgot to check —
 * a concurrent save, a script, a future endpoint.
 *
 * ON DELETE CASCADE both ways is right: deleting a template releases its departments (they fall
 * back to Default for future hires), and deleting a department releases its claim. Neither
 * touches `employees.leave_template_id` — people already moved onto a plan STAY on it. Silently
 * rewriting the leave entitlements of everyone in a department because somebody deleted a row is
 * exactly the kind of action that should require a human saying so.
 */

const TABLE = 'leave_template_departments';

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable(TABLE)) return;

  await knex.schema.createTable(TABLE, (t) => {
    t.increments('id');
    t.integer('template_id').notNullable().references('id').inTable('leave_templates').onDelete('CASCADE');
    // One template per department — see above. This is the constraint, not a convenience index.
    t.integer('department_id').notNullable().unique().references('id').inTable('departments').onDelete('CASCADE');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.alterTable(TABLE, (t) => {
    t.index('template_id', 'leave_template_departments_template_idx');
  });

  // Deliberately seeds nothing. Existing per-employee assignments are the current truth and
  // guessing a department's template from whatever most of its people happen to be on today
  // would hand an inferred policy the authority of a stated one.
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists(TABLE);
}
