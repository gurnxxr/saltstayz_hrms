import type { Knex } from 'knex';

// Configurable leave-policy rules (all admin-editable from Leaves → Control Panel).
// Every rule is optional; blank/0/null = no restriction. Nothing is hard-coded.
//
//   leave_types gains the per-type policy knobs.
//   employees gains gender + probation_end_date so eligibility / after-probation
//     rules can be enforced when that data is known (null = allow).
//   leave_type_conflicts is the symmetric "cannot be clubbed with" matrix (both
//     directions stored, so a query is a simple where and unset is clean).
//
// SQLite: add columns one ALTER at a time (guarded so re-running is safe), copying
// migration 067's style.

async function addColumn(
  knex: Knex, table: string, name: string, build: (t: Knex.AlterTableBuilder) => void,
) {
  if (!(await knex.schema.hasColumn(table, name))) {
    await knex.schema.alterTable(table, build);
  }
}

export async function up(knex: Knex): Promise<void> {
  // ── leave_types: policy knobs ──
  await addColumn(knex, 'leave_types', 'min_days_per_request', (t) => t.integer('min_days_per_request'));
  await addColumn(knex, 'leave_types', 'max_days_per_request', (t) => t.integer('max_days_per_request'));
  await addColumn(knex, 'leave_types', 'advance_notice_days', (t) => t.integer('advance_notice_days'));
  await addColumn(knex, 'leave_types', 'half_day_allowed', (t) => t.boolean('half_day_allowed').notNullable().defaultTo(true));
  await addColumn(knex, 'leave_types', 'document_required_after_days', (t) => t.integer('document_required_after_days'));
  await addColumn(knex, 'leave_types', 'eligibility', (t) => t.string('eligibility', 10).notNullable().defaultTo('any')); // any | female | male
  await addColumn(knex, 'leave_types', 'after_probation_only', (t) => t.boolean('after_probation_only').notNullable().defaultTo(false));
  await addColumn(knex, 'leave_types', 'count_sandwich_days', (t) => t.boolean('count_sandwich_days').notNullable().defaultTo(false));

  // ── employees: data the eligibility / probation rules read (null = allow) ──
  await addColumn(knex, 'employees', 'gender', (t) => t.string('gender', 10)); // male | female | other
  await addColumn(knex, 'employees', 'probation_end_date', (t) => t.date('probation_end_date'));

  // ── symmetric "cannot be clubbed with" matrix ──
  if (!(await knex.schema.hasTable('leave_type_conflicts'))) {
    await knex.schema.createTable('leave_type_conflicts', (t) => {
      t.increments('id').primary();
      t.integer('leave_type_id').unsigned().notNullable().references('id').inTable('leave_types').onDelete('CASCADE');
      t.integer('conflict_leave_type_id').unsigned().notNullable().references('id').inTable('leave_types').onDelete('CASCADE');
      t.unique(['leave_type_id', 'conflict_leave_type_id']);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('leave_type_conflicts');
  for (const col of ['count_sandwich_days', 'after_probation_only', 'eligibility', 'document_required_after_days',
    'half_day_allowed', 'advance_notice_days', 'max_days_per_request', 'min_days_per_request']) {
    if (await knex.schema.hasColumn('leave_types', col)) {
      await knex.schema.alterTable('leave_types', (t) => t.dropColumn(col));
    }
  }
  for (const col of ['probation_end_date', 'gender']) {
    if (await knex.schema.hasColumn('employees', col)) {
      await knex.schema.alterTable('employees', (t) => t.dropColumn(col));
    }
  }
}
