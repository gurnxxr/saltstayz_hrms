import type { Knex } from 'knex';

// Payroll v2 Phase 5b — run-pipeline hardening + lock integrity.
//   failure_report   — JSON list of per-employee failures from the last run, so a
//                       bad record is reported instead of 500-ing the whole run.
//   register_snapshot — the salary register CSV captured at lock, so a locked
//                       month's register is reproducible even if inputs change.
//   unlocked_at / unlocked_by / unlock_reason — unlock provenance (lock history is
//                       preserved; locked_by/locked_at are never cleared).

const COLS = ['failure_report', 'register_snapshot', 'unlocked_at', 'unlocked_by', 'unlock_reason'];

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('payroll_runs', (t) => {
    t.text('failure_report');
    t.text('register_snapshot');
    t.datetime('unlocked_at');
    t.integer('unlocked_by');
    t.text('unlock_reason');
  });
}

export async function down(knex: Knex): Promise<void> {
  for (const col of COLS) {
    await knex.schema.alterTable('payroll_runs', (t) => t.dropColumn(col));
  }
}
