import type { Knex } from 'knex';

/**
 * Give each job title an (optional) owning department, so the Create-Vacancy form can filter
 * Job Title by the selected Department and illogical combinations (e.g. Security + Housekeeping
 * Attendant) can't be posted.
 *
 * NO automatic backfill. We tried deriving each title's department from existing data (the
 * department it was posted under, or where its current staff sit), but the association is noisy
 * — staff are scattered across departments unrelated to their title — so the guesses were mostly
 * wrong, and a wrong mapping is worse than none (it hides the right title under the wrong
 * department). Every title starts unassigned (NULL), stays selectable in every department, and an
 * admin sets the real mapping in Admin -> Organization -> Job Titles. That is the intended
 * org-level decision, not something to infer.
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('job_titles', 'department_id'))) {
    await knex.schema.alterTable('job_titles', (t) => {
      t.integer('department_id').references('id').inTable('departments').onDelete('SET NULL');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('job_titles', 'department_id')) {
    await knex.schema.alterTable('job_titles', (t) => t.dropColumn('department_id'));
  }
}
