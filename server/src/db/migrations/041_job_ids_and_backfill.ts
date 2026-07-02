import type { Knex } from 'knex';

// Every employee (every "job"/position) gets a unique JOB ID, distinct from their
// employee code. Vacancies can be mapped to the JOB ID they backfill.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('employees', (t) => { t.string('job_id', 20); });
  await knex.schema.alterTable('vacancies', (t) => { t.string('backfill_job_id', 20); }); // JOB ID this vacancy replaces

  // Backfill a sequential JOB ID for every existing employee.
  const emps = await knex('employees').select('id').orderBy('id');
  let n = 0;
  for (const e of emps as any[]) {
    n += 1;
    await knex('employees').where('id', e.id).update({ job_id: `JOB-${String(n).padStart(6, '0')}` });
  }

  // Unique index (created after backfill; CREATE UNIQUE INDEX does not rebuild the table).
  await knex.schema.alterTable('employees', (t) => { t.unique(['job_id']); });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('employees', (t) => { t.dropUnique(['job_id']); });
  await knex.schema.alterTable('employees', (t) => { t.dropColumn('job_id'); });
  await knex.schema.alterTable('vacancies', (t) => { t.dropColumn('backfill_job_id'); });
}
