import type { Knex } from 'knex';

/**
 * Why a month was locked while its payslips were known to be out of date.
 *
 * The stale-payslip gate blocks the lock and deliberately offers no confirm-through, because the
 * fix is normally one re-run away. But it CAN dead-end, and in two ways that no amount of re-running
 * clears:
 *
 *   • the month is frozen under legacy pay rules, so `runPayroll` refuses outright; or
 *   • an active employee's payslip cannot be regenerated (no salary structure — `runPayroll` skips
 *     them at 422 and the purge only drops slips for INACTIVE employees), so their stale row
 *     survives every re-run.
 *
 * A gate that can permanently prevent closing the books is its own kind of bug. So there is an
 * override — and because using it means knowingly paying a figure the system has said is wrong, it
 * demands a typed reason and is recorded here rather than passing silently. Nullable, and null on
 * every month locked the ordinary way: absence of a reason means the gate was satisfied, not that
 * somebody forgot to give one.
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('payroll_runs'))) return;
  if (await knex.schema.hasColumn('payroll_runs', 'lock_override_reason')) return;
  await knex.schema.alterTable('payroll_runs', (t) => {
    t.text('lock_override_reason').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('payroll_runs'))) return;
  if (!(await knex.schema.hasColumn('payroll_runs', 'lock_override_reason'))) return;
  await knex.schema.alterTable('payroll_runs', (t) => {
    t.dropColumn('lock_override_reason');
  });
}
