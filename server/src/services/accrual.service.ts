import type { Knex } from 'knex';
import db from '../config/database';
import { businessToday } from '../utils/businessDate';
import { getTemplateRulesForEmployees, type LeaveRule } from './leaveTemplate.service';
import { buildSchedule, monthsOfService, type AccrualRule, type AccrualSchedule } from './accrualEngine';

// ─────────────────────────────────────────────────────────────────────────────
// Writing the accrual ledger.
//
// The arithmetic is all in `accrualEngine.ts`, which is pure. This file is the part that talks to
// the database: which employees accrue, which of their leave types accrue, and inserting the rows
// the engine says are due.
//
// It deliberately does NOT import leave.service. Balances, the period rollover and the apply gate
// live there and read the ledger; this writes it. Keeping the dependency one-way means neither has
// to be careful about import order, and there is no cycle to reason about.
// ─────────────────────────────────────────────────────────────────────────────

/** How the ledger records where a credit came from. See migration 034 for what each means. */
export type AccrualSource = 'accrual' | 'opening' | 'adjustment';

/** The engine's view of a template row. `default_days` is the annual figure — see the engine. */
export function accrualRuleOf(rule: LeaveRule): AccrualRule {
  return {
    daysPerYear: rule.default_days,
    waitingMonths: rule.accrual_waiting_months ?? 0,
    carryForwardMax: rule.carry_forward_max,
    maxBalance: rule.max_balance,
  };
}

/**
 * Whether this leave type earns over time for this employee.
 *
 * A type with `accrual_enabled` but zero days a year would accrue nothing forever; treating it as
 * not-accruing keeps it on the old lump-sum path rather than silently zeroing the balance.
 */
export function isAccruing(rule: LeaveRule | undefined | null): boolean {
  return !!rule && rule.accrual_enabled && rule.default_days > 0;
}

export interface AccrualPlanRow {
  employee_id: number;
  employee_code: string | null;
  employee_name: string;
  date_of_joining: string;
  leave_type_id: number;
  leave_type: string;
  months_of_service: number;
  schedule: AccrualSchedule;
  /** Credits already in the ledger for this employee × type × period. */
  existing_days: number;
  /** Credits this run would add — the dry run prints these and `--apply` writes them. */
  missing: Array<{ credited_on: string; days: number; source: AccrualSource }>;
}

export interface AccrualPeriod { id: number; start_date: string; end_date: string; name?: string }

/** The period accruals are written into. Everything here is scoped to exactly one. */
export async function currentAccrualPeriod(cx: Knex | Knex.Transaction = db): Promise<AccrualPeriod | null> {
  return (await cx('leave_periods').where('is_current', true).first()) ?? null;
}

/**
 * What the ledger SHOULD contain, and what is missing from it. Writes nothing.
 *
 * This is the shared core: the daily job applies its result, and the backfill script prints it for
 * a human first. One computation behind both means the report cannot describe something different
 * from what the write does.
 *
 * `includeOpening` is off by default because the daily job must never write opening rows. An
 * opening is "what you start the period holding", and only two things know that honestly: the
 * rollover (which has last period's real unused balance) and the one-time backfill (which has the
 * employee's prior service). The job only knows the theoretical accrual, so an employee who spent
 * every day of last year's leave would be handed their full carry-forward limit back.
 */
export async function planAccruals(opts: {
  period: AccrualPeriod;
  asOf?: string;
  employeeIds?: number[];
  includeOpening?: boolean;
} ): Promise<AccrualPlanRow[]> {
  const asOf = opts.asOf ?? businessToday();
  const { period } = opts;

  const employeesQuery = db('employees')
    .where('is_active', true)
    .whereNotNull('date_of_joining')
    .select('id', 'employee_code', 'first_name', 'last_name', 'date_of_joining')
    .orderBy('id');
  if (opts.employeeIds) employeesQuery.whereIn('id', opts.employeeIds);
  const employees = await employeesQuery;
  if (!employees.length) return [];

  const employeeIds = employees.map((e: any) => e.id);
  const [rules, leaveTypes, existing] = await Promise.all([
    getTemplateRulesForEmployees(employeeIds),
    db('leave_types').select('id', 'name'),
    db('leave_accruals')
      .where('leave_period_id', period.id)
      .whereIn('employee_id', employeeIds)
      .select('employee_id', 'leave_type_id', 'credited_on', 'source', 'days'),
  ]);

  const typeName = new Map<number, string>(leaveTypes.map((t: any) => [t.id, t.name]));
  // Keyed the same way the unique constraint is, so "already there" here and "conflict" in the
  // database can never disagree.
  const have = new Set<string>();
  const storedDays = new Map<string, number>();
  for (const r of existing) {
    have.add(`${r.employee_id}:${r.leave_type_id}:${String(r.credited_on).slice(0, 10)}:${r.source}`);
    const k = `${r.employee_id}:${r.leave_type_id}`;
    storedDays.set(k, (storedDays.get(k) ?? 0) + Number(r.days));
  }

  const out: AccrualPlanRow[] = [];
  for (const emp of employees) {
    const doj = String(emp.date_of_joining).slice(0, 10);
    for (const rule of (rules.get(emp.id) ?? new Map<number, LeaveRule>()).values()) {
      if (!isAccruing(rule)) continue;
      const schedule = buildSchedule({
        dateOfJoining: doj,
        rule: accrualRuleOf(rule),
        periodStart: period.start_date,
        periodEnd: period.end_date,
        asOf,
      });

      const due: Array<{ credited_on: string; days: number; source: AccrualSource }> = [];
      if (opts.includeOpening && schedule.opening > 0) {
        due.push({ credited_on: period.start_date, days: schedule.opening, source: 'opening' });
      }
      for (const c of schedule.credits) {
        due.push({ credited_on: c.credited_on, days: c.days, source: 'accrual' });
      }

      const missing = due.filter(
        (d) => !have.has(`${emp.id}:${rule.leave_type_id}:${d.credited_on}:${d.source}`),
      );
      if (!missing.length && !schedule.credits.length && !schedule.opening) continue;

      out.push({
        employee_id: emp.id,
        employee_code: emp.employee_code ?? null,
        employee_name: `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim(),
        date_of_joining: doj,
        leave_type_id: rule.leave_type_id,
        leave_type: typeName.get(rule.leave_type_id) ?? `#${rule.leave_type_id}`,
        months_of_service: monthsOfService(doj, asOf),
        schedule,
        existing_days: storedDays.get(`${emp.id}:${rule.leave_type_id}`) ?? 0,
        missing,
      });
    }
  }
  return out;
}

/** Inserts credits, ignoring any the ledger already holds. Returns how many rows were new. */
export async function writeAccruals(
  plan: AccrualPlanRow[], periodId: number, note?: string, cx: Knex | Knex.Transaction = db,
): Promise<number> {
  const rows = plan.flatMap((p) => p.missing.map((m) => ({
    employee_id: p.employee_id,
    leave_type_id: p.leave_type_id,
    leave_period_id: periodId,
    credited_on: m.credited_on,
    days: m.days,
    source: m.source,
    note: note ?? null,
  })));
  if (!rows.length) return 0;

  // The constraint is the idempotency, not the `missing` filter above: two runs overlapping would
  // both compute the same missing set from the same pre-run snapshot, and only the index stops the
  // second one double-crediting.
  //
  // `onConflict()` takes no columns deliberately — the unique index is PARTIAL (derived sources
  // only, see migration 034), and Postgres cannot infer a partial index from a bare column list.
  // A bare ON CONFLICT DO NOTHING matches it; naming the columns would raise
  // "no unique or exclusion constraint matching the ON CONFLICT specification".
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const inserted = await cx('leave_accruals')
      .insert(rows.slice(i, i + 500))
      .onConflict()
      .ignore()
      .returning('id');
    written += inserted.length;
  }
  return written;
}

export interface AccrualRunResult {
  period: string;
  as_of: string;
  employees: number;
  credited: number;
  skipped_no_period?: true;
}

/**
 * The daily tick: credit everyone whose anniversary has arrived and is not already in the ledger.
 *
 * Safe to run repeatedly — that is the whole point of the unique key. It recomputes the full period
 * every time rather than tracking a cursor, so a server that was down for a fortnight catches up on
 * its next boot with no special handling, and a partial run leaves nothing half-done.
 */
export async function runDailyAccrual(asOf?: string): Promise<AccrualRunResult> {
  const at = asOf ?? businessToday();
  const period = await currentAccrualPeriod();
  if (!period) return { period: '—', as_of: at, employees: 0, credited: 0, skipped_no_period: true };

  const plan = await planAccruals({ period, asOf: at });
  const credited = await writeAccruals(plan, period.id);
  return {
    period: period.name ?? String(period.id),
    as_of: at,
    employees: new Set(plan.filter((p) => p.missing.length).map((p) => p.employee_id)).size,
    credited,
  };
}
