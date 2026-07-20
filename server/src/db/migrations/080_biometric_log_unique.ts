import type { Knex } from 'knex';

// A biometric punch is uniquely identified by (employee_code, log_datetime, device_sn):
// a person cannot physically swipe the same device at the same second twice. Without a
// DB-level guard, a device re-transmitting its buffer (a common recovery behaviour) each
// time inserted fresh duplicate rows, inflating the punch stream and skewing processing.
// This collapses any duplicates an earlier ingest already created and adds a unique index;
// the ingest paths use target-less ON CONFLICT DO NOTHING so a lost race is a harmless no-op.
const INDEX = 'uq_bio_logs_emp_dt_device';

export async function up(knex: Knex): Promise<void> {
  const dupes = await knex('biometric_logs')
    .select('employee_code', 'log_datetime', 'device_sn')
    .count('* as c')
    .groupBy('employee_code', 'log_datetime', 'device_sn')
    .havingRaw('count(*) > 1');

  for (const d of dupes as any[]) {
    const rows = await knex('biometric_logs')
      .where({ employee_code: d.employee_code, log_datetime: d.log_datetime, device_sn: d.device_sn })
      .orderBy('id');
    // Keep the row most useful to processing: an already-processed one if present
    // (preserves the record it produced), else the oldest.
    const keep = rows.find((r: any) => r.is_processed) || rows[0];
    const remove = rows.filter((r: any) => r.id !== keep.id).map((r: any) => r.id);
    if (remove.length) await knex('biometric_logs').whereIn('id', remove).del();
  }

  await knex.raw(
    `CREATE UNIQUE INDEX IF NOT EXISTS ${INDEX} ON biometric_logs (employee_code, log_datetime, device_sn)`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS ${INDEX}`);
}
