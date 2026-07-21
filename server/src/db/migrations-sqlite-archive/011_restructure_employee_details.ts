import type { Knex } from 'knex';

// Idempotent guards — see note in 010. From-scratch, migration 003 already emits
// father_name/aadhaar_number/dept_name/branch_name and never created the legacy
// FK columns this migration drops, so each step must no-op when already in target state.
async function addColumn(knex: Knex, col: string, build: (t: Knex.AlterTableBuilder) => void) {
  if (!(await knex.schema.hasColumn('employees', col))) {
    await knex.schema.alterTable('employees', build);
  }
}
async function dropColumn(knex: Knex, col: string) {
  if (await knex.schema.hasColumn('employees', col)) {
    await knex.schema.alterTable('employees', (t) => t.dropColumn(col));
  }
}

export async function up(knex: Knex): Promise<void> {
  await addColumn(knex, 'father_name', (t) => t.string('father_name', 100));
  await addColumn(knex, 'aadhaar_number', (t) => t.string('aadhaar_number', 12));

  for (const col of [
    'personal_email', 'pan_number', 'bank_account_number', 'bank_ifsc',
    'department_id', 'property_id', 'category_id', 'employment_status_id',
  ]) {
    await dropColumn(knex, col);
  }
}

export async function down(knex: Knex): Promise<void> {
  await dropColumn(knex, 'father_name');
  await dropColumn(knex, 'aadhaar_number');

  await addColumn(knex, 'personal_email', (t) => t.string('personal_email', 255));
  await addColumn(knex, 'pan_number', (t) => t.string('pan_number', 10));
  await addColumn(knex, 'bank_account_number', (t) => t.string('bank_account_number', 20));
  await addColumn(knex, 'bank_ifsc', (t) => t.string('bank_ifsc', 11));
  await addColumn(knex, 'department_id', (t) =>
    t.integer('department_id').unsigned().references('id').inTable('departments').onDelete('SET NULL'));
  await addColumn(knex, 'property_id', (t) =>
    t.integer('property_id').unsigned().references('id').inTable('properties').onDelete('SET NULL'));
  await addColumn(knex, 'category_id', (t) =>
    t.integer('category_id').unsigned().references('id').inTable('employee_categories').onDelete('SET NULL'));
  await addColumn(knex, 'employment_status_id', (t) =>
    t.integer('employment_status_id').unsigned().references('id').inTable('employment_statuses').onDelete('SET NULL'));
}
