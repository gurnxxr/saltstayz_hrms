import type { Knex } from 'knex';

/**
 * PostgreSQL advisory locks.
 *
 * SQLite serialised writers, so "read the current total, decide, then insert" inside a transaction
 * was implicitly race-free. PostgreSQL uses MVCC: two concurrent transactions each see the state
 * from before the other started, so both can pass the same check and both insert. These locks
 * restore the old guarantee for the few places that depend on it.
 *
 * pg_advisory_xact_lock is held until the transaction commits or rolls back — there is nothing to
 * release manually, and a crashed connection frees it automatically.
 */
export const LOCK = {
  /** Hiring guardrail: serialise hires competing for the same property's budget/headcount. */
  HIRE_BUDGET: 811001,
  /** Generation of the next MH-#### employee code. */
  EMPLOYEE_CODE: 811002,
  /** Generation of the next JOB-###### id. */
  JOB_ID: 811003,
  /** Leave applications for one employee (balance + overlap check then insert). */
  LEAVE_APPLY: 811004,
  /** Adding an applicant to one vacancy (duplicate check then insert). */
  CANDIDATE_APPLY: 811005,
  /**
   * One payroll month, keyed by `monthKeyOf(month, year)`.
   *
   * Held by `refreshPayslipAfterAttendanceChange` around its state re-check and write, so a
   * concurrent lock cannot land between the two.
   *
   * INCOMPLETE, deliberately recorded rather than implied: `lockRun` does NOT take this lock and
   * does not run in a transaction — it reads the run, builds the register, and flips the status as
   * separate statements. So a re-price committing inside that window can leave the frozen register
   * CSV disagreeing with the payslip it was built from. Closing it means threading a transaction
   * handle through `getRunDetails` and `getSalaryRegister` too, which is a bigger change than the
   * one this lock was added for. Do not read this constant as "the month is serialised".
   */
  PAYROLL_MONTH: 811006,
} as const;

/**
 * Blocks until any other transaction holding the same (key, key2) pair finishes. Requires a real
 * transaction — outside one, each statement is its own transaction and the lock would be released
 * immediately, which is why callers must pass `trx`.
 */
export async function advisoryXactLock(trx: Knex.Transaction, key: number, key2 = 0): Promise<void> {
  await trx.raw('SELECT pg_advisory_xact_lock(?, ?)', [key, key2]);
}

/** True when the given Knex handle is a transaction (advisory xact locks are only valid there). */
export function isTransaction(cx: Knex | Knex.Transaction): cx is Knex.Transaction {
  return Boolean((cx as any)?.isTransaction);
}
