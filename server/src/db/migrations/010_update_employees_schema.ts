import type { Knex } from 'knex';

// Idempotent guards. Migration 003 was later simplified to emit nearly the final
// employees schema, so these historical add/drop steps must no-op when the column
// is already in the target state — otherwise a from-scratch `db:migrate` fails on
// duplicate/missing columns. (The live DB already recorded this migration and won't
// re-run it; guards only matter for fresh setups.)
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
  await addColumn(knex, 'personal_email', (t) => t.string('personal_email', 255));

  for (const col of [
    'aadhaar_number', 'bank_branch_name', 'cancelled_cheque_url',
    'photo_url', 'nationality_id', 'date_of_exit',
  ]) {
    await dropColumn(knex, col);
  }

  await knex.schema.dropTableIfExists('nationalities');
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('nationalities'))) {
    await knex.schema.createTable('nationalities', (table) => {
      table.increments('id').primary();
      table.string('name', 100).unique().notNullable();
      table.timestamps(true, true);
    });
  }

  await addColumn(knex, 'date_of_exit', (t) => t.date('date_of_exit'));
  await addColumn(knex, 'nationality_id', (t) =>
    t.integer('nationality_id').unsigned().references('id').inTable('nationalities').onDelete('SET NULL'));
  await addColumn(knex, 'photo_url', (t) => t.string('photo_url', 500));
  await addColumn(knex, 'cancelled_cheque_url', (t) => t.string('cancelled_cheque_url', 500));
  await addColumn(knex, 'bank_branch_name', (t) => t.string('bank_branch_name', 100));
  await addColumn(knex, 'aadhaar_number', (t) => t.string('aadhaar_number', 12));
  await dropColumn(knex, 'personal_email');
}
