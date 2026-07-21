import type { Knex } from 'knex';

// When a hire is blocked (over headcount / band / budget), Cluster HR can raise an
// exception request. Admin approves (which creates the employee, recording the
// variance) or rejects. Snapshot columns freeze the numbers at request time for audit.
export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('manpower_exceptions')) return;
  await knex.schema.createTable('manpower_exceptions', (t) => {
    t.increments('id').primary();
    t.integer('property_id').unsigned().notNullable()
      .references('id').inTable('properties').onDelete('CASCADE');
    t.integer('job_title_id').unsigned().notNullable()
      .references('id').inTable('job_titles').onDelete('CASCADE');
    t.integer('requested_by').unsigned().references('id').inTable('users').onDelete('SET NULL');

    t.string('candidate_name', 150).notNullable();
    t.decimal('requested_ctc', 12, 2).notNullable();
    t.string('exception_type', 20).notNullable(); // over_band | over_headcount | over_budget

    // Snapshot of the sanction/availability at request time
    t.decimal('band_min', 12, 2);
    t.decimal('band_max', 12, 2);
    t.decimal('sanctioned_budget_monthly', 14, 2);
    t.decimal('committed_amount', 14, 2);
    t.decimal('remaining_budget', 14, 2);
    t.integer('sanctioned_headcount');
    t.integer('non_left_headcount');
    t.decimal('suggested_ctc', 12, 2);
    t.decimal('variance_amount', 12, 2); // how much over the allowed figure

    t.date('join_date');
    t.text('request_reason');

    t.string('status', 12).notNullable().defaultTo('pending'); // pending | approved | rejected
    t.text('admin_note');
    t.integer('reviewed_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('reviewed_at');
    t.integer('created_employee_id').unsigned()
      .references('id').inTable('employees').onDelete('SET NULL');

    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('manpower_exceptions');
}
