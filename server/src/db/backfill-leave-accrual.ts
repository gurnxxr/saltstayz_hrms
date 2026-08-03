/**
 * Gives existing staff credit for the service they have already done, once.
 *
 * When accrual is switched on for a leave type, the daily job only credits anniversaries from that
 * day forward. Somebody who joined four years ago would sit at zero until their next anniversary
 * and be refused leave they have plainly earned. This is the one-time catch-up:
 *
 *   - every anniversary inside the CURRENT leave period that has already passed, as `accrual` rows
 *   - one `opening` row for service BEFORE the period, capped at the type's carry-forward limit
 *
 * The cap is what stops a long-serving employee landing an implausible balance. Four years at
 * 15 days a year is 60 days of theoretical accrual; a carry-forward limit of 10 means 10 arrive
 * and 50 lapse, exactly as they would have at each year end had accrual been running all along.
 * A type with NO carry-forward limit brings nothing in at all — its balance lapses annually, so
 * there is nothing to carry.
 *
 * REPORTS BY DEFAULT, writes nothing. `--apply` writes, and is idempotent — the ledger's unique
 * index means running it twice credits nobody twice.
 *
 *   npm run leave:backfill --workspace=server
 *   npm run leave:backfill --workspace=server -- --apply
 *   npm run leave:backfill --workspace=server -- --as-of 2026-08-31   (what-if, still read-only)
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import db from '../config/database';
import { buildCsv } from '../utils/csv';
import { businessToday } from '../utils/businessDate';
import {
  currentAccrualPeriod, planAccruals, writeAccruals, type AccrualPlanRow,
} from '../services/accrual.service';
import { getEffectiveBalances } from '../services/leave.service';

const n2 = (v: number) => Math.round(v * 100) / 100;

/** Employees the report has to name rather than silently omit. */
async function unbackfillable() {
  return db('employees').where('is_active', true).whereNull('date_of_joining')
    .select('id', 'employee_code', 'first_name', 'last_name');
}

function summarise(plan: AccrualPlanRow[], asOf: string) {
  const byType = new Map<string, { people: number; rows: number; days: number; capped: number }>();
  for (const p of plan) {
    const s = byType.get(p.leave_type) ?? { people: 0, rows: 0, days: 0, capped: 0 };
    s.people += 1;
    s.rows += p.missing.length;
    s.days += p.missing.reduce((a, m) => a + m.days, 0);
    if (p.schedule.capped) s.capped += 1;
    byType.set(p.leave_type, s);
  }
  console.log(`\nAs of ${asOf}:\n`);
  console.log('  Leave type            People   Rows   Days to credit   Hit the ceiling');
  console.log('  ' + '─'.repeat(72));
  for (const [type, s] of [...byType].sort()) {
    console.log(
      `  ${type.padEnd(20)}  ${String(s.people).padStart(6)}  ${String(s.rows).padStart(5)}  `
      + `${String(n2(s.days)).padStart(14)}   ${String(s.capped).padStart(15)}`,
    );
  }
  if (!byType.size) console.log('  (nothing — no leave type has accrual switched on)');
  console.log('');
}

async function report(asOf: string, apply: boolean) {
  const period = await currentAccrualPeriod();
  if (!period) throw new Error('There is no current leave period. Set one on Leave → Control Panel → Leave Periods first.');
  console.log(`\nLeave period: ${period.name ?? period.id} (${period.start_date} → ${period.end_date})`);

  const plan = await planAccruals({ period, asOf, includeOpening: true });
  if (!plan.length) {
    console.log('\nNo leave type has accrual switched on for anybody, so there is nothing to backfill.');
    console.log('Turn it on per leave type at Leave → Control Panel → Templates.\n');
    return;
  }

  // Balances BEFORE, read through the same function every screen reads, so "balance now" here is
  // what the employee is being shown at this moment. Note it is read with accrual ALREADY ON, so
  // for anyone who has taken leave it will be negative until this backfill runs — which is the
  // whole reason the backfill exists, and the reason to run it the same day accrual is enabled.
  const employeeIds = [...new Set(plan.map((p) => p.employee_id))];
  const before = new Map<string, { available: number; taken: number; pending: number }>();
  for (const b of await getEffectiveBalances(employeeIds, period.id)) {
    before.set(`${b.employee_id}:${b.leave_type_id}`, { available: b.available, taken: b.taken, pending: b.pending });
  }

  const rows = plan.map((p) => {
    const key = `${p.employee_id}:${p.leave_type_id}`;
    const b = before.get(key);
    return {
      p,
      key,
      toCredit: n2(p.missing.reduce((a, m) => a + m.days, 0)),
      // The number the reviewer is actually approving: what this employee will be able to take.
      after: b ? n2(p.schedule.spendable - b.taken - b.pending) : p.schedule.spendable,
    };
  });

  // A credit already written WITHOUT the opening row in view means the ceiling was applied to a
  // smaller total than it should have been. Only possible if the daily job ran before this script.
  const orderingRisk = plan.filter(
    (p) => p.schedule.opening > 0 && p.existing_days > 0 && p.missing.some((m) => m.source === 'opening'),
  );

  summarise(plan, asOf);

  const stamp = asOf.replace(/-/g, '');
  const dir = path.resolve(__dirname, '../../data');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `leave-accrual-backfill-${stamp}.csv`);
  fs.writeFileSync(file, buildCsv(
    ['employee_code', 'employee_name', 'date_of_joining', 'months_of_service', 'leave_type',
      'prior_service_days', 'opening_after_cap', 'credits_in_period', 'accrued_total',
      'whole_days_earned', 'already_taken', 'already_pending',
      'balance_before', 'balance_after', 'ceiling_hit', 'rows_to_write'],
    rows.map(({ p, key, toCredit, after }) => [
      p.employee_code, p.employee_name, p.date_of_joining, p.months_of_service, p.leave_type,
      n2(p.schedule.prior_accrued), n2(p.schedule.opening), p.schedule.credits.length,
      n2(p.schedule.accrued), p.schedule.spendable,
      before.get(key)?.taken ?? '', before.get(key)?.pending ?? '',
      before.get(key)?.available ?? '', after,
      p.schedule.capped ? 'yes' : '', toCredit === 0 ? 0 : p.missing.length,
    ]),
  ), 'utf8');

  const missingDoj = await unbackfillable();
  if (missingDoj.length) {
    console.log(`${missingDoj.length} active employee(s) have no joining date and cannot accrue at all:`);
    for (const e of missingDoj.slice(0, 10)) console.log(`  ${e.employee_code ?? e.id} — ${e.first_name} ${e.last_name}`);
    if (missingDoj.length > 10) console.log(`  …and ${missingDoj.length - 10} more`);
    console.log('Set their date of joining, then re-run.\n');
  }

  if (orderingRisk.length) {
    console.log(`⚠ ${orderingRisk.length} employee/type pair(s) already hold accrual credits and are `
      + 'about to receive an opening balance too.');
    console.log('  Their ceiling was worked out without the opening in view, so the total may exceed it.');
    console.log('  Harmless when no ceiling is set. Run this backfill BEFORE enabling the daily job.\n');
  }

  console.log(`Full detail (${rows.length} rows): ${file}`);
  console.log('Contains employee names — server/data/ is gitignored. Do not commit or share.\n');

  if (!apply) {
    console.log('Nothing has been written. Review the file, then:');
    console.log('  npm run leave:backfill --workspace=server -- --apply\n');
    return;
  }

  const written = await writeAccruals(plan, period.id, 'One-time accrual backfill');
  console.log(`Wrote ${written} ledger row(s).`);
  if (written < plan.reduce((a, p) => a + p.missing.length, 0)) {
    console.log('(Fewer than proposed — the rest were already in the ledger. Re-running is safe.)');
  }

  const after = await getEffectiveBalances(employeeIds, period.id);
  const moved = after.filter((b) => b.source === 'accrual'
    && b.available !== (before.get(`${b.employee_id}:${b.leave_type_id}`)?.available ?? 0));
  console.log(`${moved.length} balance(s) changed. Spot check:`);
  for (const b of moved.slice(0, 8)) {
    const was = before.get(`${b.employee_id}:${b.leave_type_id}`)?.available ?? 0;
    console.log(`  employee ${b.employee_id} · ${b.leave_type}: ${was} → ${b.available} day(s) (earned ${n2(b.accrued ?? 0)})`);
  }
  console.log('');
}

async function main() {
  const apply = process.argv.includes('--apply');
  const i = process.argv.indexOf('--as-of');
  const asOf = i !== -1 ? String(process.argv[i + 1] ?? '').slice(0, 10) : businessToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error('--as-of needs a YYYY-MM-DD date');
  // A what-if run against a future date must never write: the ledger would hold credits for
  // anniversaries that have not happened, and no later run would take them back.
  if (apply && i !== -1 && asOf !== businessToday()) {
    throw new Error('--as-of is for read-only what-ifs. Crediting a date other than today would write leave nobody has earned yet.');
  }
  await report(asOf, apply);
  await db.destroy();
}

main().catch(async (e) => { console.error(`\n${e.message}\n`); await db.destroy(); process.exit(1); });
