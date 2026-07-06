import type { Knex } from 'knex';

// Employee Lifecycle module: Promotion / Transfer / Exit Interview.
//
// Promotions and transfers APPLY immediately (the employee record is updated
// in the same transaction) and these tables keep the auditable history with
// from/to snapshots. Exit interviews are a scheduled → completed record with
// structured feedback for attrition insight.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('employee_promotions', (t) => {
    t.increments('id').primary();
    t.integer('employee_id').unsigned().notNullable().references('id').inTable('employees').onDelete('CASCADE');
    t.date('promotion_date').notNullable();
    t.integer('from_job_title_id');
    t.integer('to_job_title_id').notNullable();
    t.decimal('from_base', 12, 2); // salary base before (null = no assignment then)
    t.decimal('to_base', 12, 2);   // salary base after (null = salary unchanged)
    t.text('note');
    t.integer('created_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('employee_transfers', (t) => {
    t.increments('id').primary();
    t.integer('employee_id').unsigned().notNullable().references('id').inTable('employees').onDelete('CASCADE');
    t.date('transfer_date').notNullable();
    t.string('from_branch', 150);
    t.string('to_branch', 150);   // null = property unchanged
    t.string('from_dept', 150);
    t.string('to_dept', 150);     // null = department unchanged
    t.text('note');
    t.integer('created_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('exit_interviews', (t) => {
    t.increments('id').primary();
    t.integer('employee_id').unsigned().notNullable().references('id').inTable('employees').onDelete('CASCADE');
    t.date('interview_date').notNullable();
    t.string('status', 12).notNullable().defaultTo('scheduled'); // scheduled | completed
    t.string('reason_for_leaving', 60);
    t.integer('overall_rating');      // 1–5, set on completion
    t.boolean('would_recommend');     // set on completion
    t.text('feedback');
    t.text('suggestions');
    t.integer('interviewer_id').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.integer('created_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('exit_interviews');
  await knex.schema.dropTableIfExists('employee_transfers');
  await knex.schema.dropTableIfExists('employee_promotions');
}
