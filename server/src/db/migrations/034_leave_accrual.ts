import type { Knex } from 'knex';

/**
 * Leave that is EARNED over time instead of granted in full on day one.
 *
 * Today a leave balance is a lump sum: `default_days` on the employee's template row, available in
 * its entirety from the moment they join. Somebody who started yesterday can apply for all twelve
 * casual leaves. The business rule is that leave accrues — after each completed month of service a
 * fixed share of the annual figure is credited.
 *
 * ── Why a ledger and not a formula ──
 *
 * `leave_accruals` is append-only: one row per credit, frozen at the moment it was made. A computed
 * model (months_of_service × rate, evaluated on every read) would be less code, and this codebase
 * has already paid for that shortcut once. Payslips carry `calc_version` and a stored snapshot
 * precisely because recomputing history moved figures people had been paid. Leave has the same
 * hazard in a quieter form: raise Privilege Leave from 15 days to 18 next year and a computed model
 * silently rewrites what everyone had LAST March — including balances they have already spent
 * against, and including the balance that an approved leave request was checked against. A ledger
 * cannot do that. What was credited stays credited; a rate change only affects credits made after
 * it.
 *
 * ── Idempotency lives in the unique key ──
 *
 * `UNIQUE (employee_id, leave_type_id, credited_on, source)` is the whole story. The daily job
 * recomputes the full schedule and inserts with ON CONFLICT DO NOTHING, so it can run twice, run
 * after a crash, or run on a server that was down for a week, and the ledger lands in the same
 * state. No advisory lock is needed and none is taken — worth stating plainly, because
 * `utils/locks.ts` has no entry covering periodic work and `PAYROLL_MONTH`'s own comment records
 * that its lock is known-incomplete. Here the constraint IS the concurrency control.
 *
 * ── The four config columns ──
 *
 * They go on `leave_template_rows`, where every other per-employee-per-type leave rule already
 * lives, so an employee's accrual is decided by the same plan that decides their notice period and
 * whether the leave is paid.
 *
 * `accrual_enabled` defaults to FALSE. Nothing about anybody's balance changes when this migration
 * runs — the third branch in `getEffectiveBalances` is unreachable until an admin switches a type
 * on. That is deliberate: Maternity (182 days) and Loss of Pay (365) must never accrue monthly, and
 * a default of true would have handed every employee 15 days of maternity leave by Christmas.
 *
 * The RATE is not a new column. It is the existing `default_days`, which the template editor already
 * labels "Days / year" — monthly credit is `default_days / 12`. Accrual changes only WHEN those days
 * arrive, not how many there are, and one number that HR already understands beats two that can
 * disagree.
 *
 * ── Why `days` is numeric(10,6) and not a float ──
 *
 * 15 days a year is 1.25 a month, which is exact. 10 days a year is 0.8333… which is not, and this
 * column is summed to produce a balance somebody is refused leave against. `numeric` sums as exact
 * decimal in Postgres; `float` accumulates error, and the error lands exactly where it hurts — a
 * total of 9.999999999999998 floors to 9, so an employee entitled to 10 days is told they have 9.
 * The engine (see `accrualEngine.ts`) is built so twelve monthly credits sum to the annual figure
 * to the last decimal place, and that guarantee is only worth anything if the column preserves it.
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('leave_accruals'))) {
    await knex.schema.createTable('leave_accruals', (t) => {
      t.increments('id');
      t.integer('employee_id').notNullable().references('id').inTable('employees').onDelete('CASCADE');
      t.integer('leave_type_id').notNullable().references('id').inTable('leave_types').onDelete('CASCADE');
      t.integer('leave_period_id').notNullable().references('id').inTable('leave_periods').onDelete('CASCADE');
      // A business date, TEXT like every other one in this schema (see .claude/rules/database.md):
      // the anniversary day the credit is FOR, not the instant the row was written.
      t.text('credited_on').notNullable();
      t.decimal('days', 10, 6).notNullable();
      // 'accrual'    — the monthly earn; written by the daily job
      // 'opening'    — what the employee starts the period holding; written by the period
      //                rollover (unused days, capped) or by the one-time backfill (prior service,
      //                capped). ONE source string for both on purpose: they mean the same thing to
      //                a balance, and two would let the same employee receive both and be credited
      //                their carry-forward limit twice.
      // 'adjustment' — a manual grant or correction by HR
      t.text('source').notNullable().defaultTo('accrual');
      t.text('note');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      // How the balance is read: one period, many employees at once.
      t.index(['leave_period_id', 'employee_id'], 'leave_accruals_period_employee_idx');
    });
    // The idempotency key, and PARTIAL on purpose.
    //
    // 'accrual' and 'opening' are DERIVED — recomputed in full on every run — so a second attempt
    // at the same credit must be a no-op. 'adjustment' is not: it is a deliberate one-off, and HR
    // encashing two days in the morning and three in the afternoon is two adjustments on one date
    // for one leave type. Under a full unique constraint the second insert would conflict, be
    // ignored, and silently fail to debit anybody — a balance quietly three days too high.
    await knex.raw(`
      CREATE UNIQUE INDEX leave_accruals_derived_unique
        ON leave_accruals (employee_id, leave_type_id, credited_on, source)
        WHERE source IN ('accrual', 'opening')
    `);
    console.log('  created leave_accruals');
  }

  const cols: Array<[string, (t: Knex.AlterTableBuilder) => void]> = [
    // Off by default — see the note above. Switching it on is what makes accrual real for a type.
    ['accrual_enabled', (t) => { t.boolean('accrual_enabled').notNullable().defaultTo(false); }],
    // Completed months that earn nothing. 0 = earning starts at the first monthly anniversary.
    ['accrual_waiting_months', (t) => { t.integer('accrual_waiting_months').notNullable().defaultTo(0); }],
    // Days that survive into the next period. NULL means none do — the balance lapses in full.
    ['carry_forward_max', (t) => { t.decimal('carry_forward_max', 10, 2).nullable(); }],
    // Optional ceiling on what one period can hold. NULL = no ceiling.
    ['max_balance', (t) => { t.decimal('max_balance', 10, 2).nullable(); }],
  ];
  for (const [name, add] of cols) {
    if (!(await knex.schema.hasColumn('leave_template_rows', name))) {
      await knex.schema.alterTable('leave_template_rows', add);
      console.log(`  added leave_template_rows.${name}`);
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const name of ['accrual_enabled', 'accrual_waiting_months', 'carry_forward_max', 'max_balance']) {
    if (await knex.schema.hasColumn('leave_template_rows', name)) {
      await knex.schema.alterTable('leave_template_rows', (t) => { t.dropColumn(name); });
    }
  }
  await knex.schema.dropTableIfExists('leave_accruals');
}
