import type { Knex } from 'knex';

// Idempotent guards — see note in 010. Migration 003 already creates dept_name /
// branch_name, so these adds must no-op on a from-scratch run.
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
  await addColumn(knex, 'dept_name', (t) => t.string('dept_name', 100));
  await addColumn(knex, 'branch_name', (t) => t.string('branch_name', 100));
}

export async function down(knex: Knex): Promise<void> {
  await dropColumn(knex, 'dept_name');
  await dropColumn(knex, 'branch_name');
}
