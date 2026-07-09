import type { Knex } from 'knex';

// Regularisation revamp: status-based, date-range corrections + a calendar marker.
//
// The regularisation flow moves from "submit punches → re-derive status" to
// "pick what the day should be (a status type) over a date range". This adds:
//   attendance_regularisations.requested_status — the picked type (np|mp|sp|absent|present)
//   attendance_regularisations.end_date         — range end (existing `date` = range start)
//   attendance_records.is_regularised           — 1 once a regularisation writes the day,
//                                                  so the calendar can mark it "R"
//
// SQLite: add columns one ALTER at a time (guarded so re-running is safe).

async function addColumn(
  knex: Knex, table: string, name: string, build: (t: Knex.AlterTableBuilder) => void,
) {
  if (!(await knex.schema.hasColumn(table, name))) {
    await knex.schema.alterTable(table, build);
  }
}

export async function up(knex: Knex): Promise<void> {
  await addColumn(knex, 'attendance_regularisations', 'requested_status', (t) => t.string('requested_status', 20));
  await addColumn(knex, 'attendance_regularisations', 'end_date', (t) => t.date('end_date'));
  await addColumn(knex, 'attendance_records', 'is_regularised', (t) => t.boolean('is_regularised').notNullable().defaultTo(false));
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('attendance_records', 'is_regularised')) {
    await knex.schema.alterTable('attendance_records', (t) => t.dropColumn('is_regularised'));
  }
  for (const col of ['end_date', 'requested_status']) {
    if (await knex.schema.hasColumn('attendance_regularisations', col)) {
      await knex.schema.alterTable('attendance_regularisations', (t) => t.dropColumn(col));
    }
  }
}
