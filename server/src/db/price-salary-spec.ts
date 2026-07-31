/**
 * What the owner's salary spec costs, before anybody flips a switch.
 *
 * The spec asks for three settings changes, and every one of them moves money for every employee:
 *
 *   • Salary calculation method  →  "days in the calendar month" (today: whatever is stored)
 *   • Missed Punch pays          →  50%  (today: whatever the rule says)
 *   • HHD pays                   →  25%  (today: whatever the rule says)
 *
 * Two of those LOWER pay, and the divisor change re-prices every open month for everybody at once.
 * That is not something to discover from a payslip after the fact, so this prices it first.
 *
 * WRITES NOTHING. It reads the engine's own verdict for each employee, then recomputes the
 * shortfall arithmetically under the spec's tag values from the same day counts. Both halves are
 * exact — no sampling, no estimate — and the script checks its own arithmetic against the engine
 * before trusting it (see RECONSTRUCTION CHECK below); any employee it cannot reproduce is
 * reported rather than quietly averaged in.
 *
 * The one figure that IS an estimate is rupees. Gross earnings reconcile to the prorated base
 * (payslip.calc.ts builds a remainder line to make them), so gross moves with the pay factor and
 * `base x (after - now)` is accurate. NET is not modelled: PF, ESI, PT and LWF do not all scale
 * linearly, and PT in particular picks its slab off the prorated gross. Read the rupee column as
 * "gross impact", and re-run the month for exact net once the settings are actually changed.
 *
 *   npm run spec:price --workspace=server
 *   npm run spec:price --workspace=server -- --month 7 --year 2026
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import db from '../config/database';
import { computePayableDays } from '../services/payableDays.service';
import { getPaySchedule } from '../services/paySchedule.service';
import { buildCsv } from '../utils/csv';

/** What each tag pays under the owner's spec. Loss per day is 1 minus this. */
const SPEC_PAYS: Record<string, number> = {
  present: 1,
  absent: 0,
  half_day: 0.5,
  hhd: 0.25,
  short_punch: 0.5,
  miss_punch: 0.5,
  no_punch: 1,
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const num = (v: any) => (v == null ? 0 : Number(v) || 0);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * Rebuild a month's loss-of-pay from its day counts under a given set of tag values.
 *
 * Deliberately mirrors the engine's ladder rather than inventing one:
 *   • paid_leave and future cost nothing; unpaid_leave is always a whole day (hardcoded in the
 *     engine, not a configurable rule).
 *   • unmarked costs a day only when the org policy says an unmarked day means absent.
 *   • not_employed is NOT a loss — it is subtracted separately, from the calendar side.
 *   • A regularised day is already counted under `present`, so it correctly costs nothing here.
 */
function lopFromCounts(counts: any, pays: Record<string, number>, unmarkedIsAbsent: boolean): number {
  const loss = (code: string) => 1 - (pays[code] ?? 1);
  return round2(
    num(counts.absent) * loss('absent')
    + num(counts.half_day) * loss('half_day')
    + num(counts.hhd) * loss('hhd')
    + num(counts.short_punch) * loss('short_punch')
    + num(counts.miss_punch) * loss('miss_punch')
    + num(counts.no_punch) * loss('no_punch')
    + num(counts.unpaid_leave) * 1
    + num(counts.unmarked) * (unmarkedIsAbsent ? 1 : 0),
  );
}

(async () => {
  const now = new Date();
  const month = Number(arg('month') ?? now.getMonth() + 1);
  const year = Number(arg('year') ?? now.getFullYear());
  const label = `${String(month).padStart(2, '0')}/${year}`;

  const run = await db('payroll_runs').where({ month, year }).first();
  if (run?.status === 'locked') {
    console.error(`\n  ${label} is LOCKED. Its figures cannot move and pricing it proves nothing.`);
    console.error('  Pass --month/--year for an open month.\n');
    await db.destroy();
    process.exit(1);
  }

  const schedule: any = await getPaySchedule();
  const unmarkedIsAbsent = schedule.unmarked_day_policy === 'absent';

  // Today's stored tag values, so "now" is measured against reality rather than an assumption.
  const ruleRows = await db('attendance_pay_rules').select('code', 'pay_fraction');
  const nowPays: Record<string, number> = {};
  for (const r of ruleRows) nowPays[r.code] = num(r.pay_fraction);

  console.log(`\n  Pricing the salary spec for ${label}`);
  console.log(`  Payroll run: ${run ? run.status : 'not generated yet'}`);
  console.log(`  Method today: ${schedule.salary_calculation_method}`
    + (schedule.salary_calculation_method === 'fixed_days' ? ` (${schedule.fixed_working_days} days)` : ''));
  console.log(`  Unmarked working day counts as: ${schedule.unmarked_day_policy}`);
  const moving = ['miss_punch', 'hhd', 'no_punch', 'absent', 'half_day', 'short_punch', 'present']
    .filter((c) => nowPays[c] !== undefined && nowPays[c] !== SPEC_PAYS[c])
    .map((c) => `${c} ${nowPays[c] * 100}% → ${SPEC_PAYS[c] * 100}%`);
  console.log(`  Tag values that move: ${moving.length ? moving.join(' · ') : 'none — already on the spec'}\n`);

  const employees = await db('employees')
    .where('is_active', true)
    .select('id', 'employee_code', 'first_name', 'last_name', 'branch_name')
    .orderBy('employee_code');

  const rows: any[] = [];
  const mismatched: string[] = [];
  const noSalary: string[] = [];
  let coverMarkable = 0;
  let coverUnevidenced = 0;

  for (const e of employees) {
    const d: any = await computePayableDays(e.id, month, year);

    // RECONSTRUCTION CHECK — rebuild today's loss from today's counts with today's rules and
    // compare to what the engine actually charged. They must agree, or this script's model of the
    // ladder is wrong and every "after" figure below it is worthless. Report, never average away.
    const rebuiltNow = lopFromCounts(d.counts, nowPays, unmarkedIsAbsent);
    if (Math.abs(rebuiltNow - num(d.lop_days)) > 0.011) {
      mismatched.push(`${e.employee_code} ${e.first_name} ${e.last_name}: engine ${d.lop_days}, rebuilt ${rebuiltNow}`);
      continue;
    }

    const base = await db('salary_structure_assignments').where('employee_id', e.id).first()
      .then((a: any) => num(a?.base));
    if (base <= 0) { noSalary.push(`${e.employee_code} ${e.first_name} ${e.last_name}`); continue; }

    const periodDays = num(d.period_days);
    const nowPaid = num(d.payment_days);
    const nowFactor = num(d.working_days) > 0 ? nowPaid / num(d.working_days) : 0;

    // After: the calendar month is the divisor, and rest days and holidays are already inside it,
    // so paid days are the month minus the days outside the employment span minus what was lost.
    const afterLop = lopFromCounts(d.counts, SPEC_PAYS, unmarkedIsAbsent);
    const afterPaid = round2(Math.min(periodDays,
      Math.max(0, periodDays - num(d.not_employed_calendar_days) - afterLop)));
    const afterFactor = periodDays > 0 ? afterPaid / periodDays : 0;

    const grossNow = base * nowFactor;
    const grossAfter = base * afterFactor;

    coverMarkable += num(d.counts.present) + num(d.counts.half_day) + num(d.counts.hhd)
      + num(d.counts.absent) + num(d.counts.miss_punch) + num(d.counts.short_punch)
      + num(d.counts.no_punch) + num(d.counts.paid_leave) + num(d.counts.unpaid_leave)
      + num(d.counts.unmarked);
    coverUnevidenced += num(d.counts.unmarked) + num(d.counts.no_punch);

    rows.push({
      code: e.employee_code,
      name: `${e.first_name} ${e.last_name}`.trim(),
      branch: e.branch_name || 'Unassigned',
      base,
      period_days: periodDays,
      now_divisor: num(d.working_days),
      now_lop: num(d.lop_days),
      now_paid: nowPaid,
      after_lop: afterLop,
      after_paid: afterPaid,
      day_delta: round2(afterPaid - nowPaid),
      gross_now: Math.round(grossNow),
      gross_after: Math.round(grossAfter),
      gross_delta: Math.round(grossAfter - grossNow),
      no_punch: num(d.counts.no_punch),
      hhd: num(d.counts.hhd),
      miss_punch: num(d.counts.miss_punch),
    });
  }

  if (!rows.length) {
    console.log('  No employees could be priced. Nothing to report.\n');
    await db.destroy();
    return;
  }

  const totalNow = rows.reduce((s, r) => s + r.gross_now, 0);
  const totalAfter = rows.reduce((s, r) => s + r.gross_after, 0);
  const delta = totalAfter - totalNow;
  const up = rows.filter((r) => r.gross_delta > 0);
  const down = rows.filter((r) => r.gross_delta < 0);

  console.log(`  ── Company total (${rows.length} employees) ──`);
  console.log(`  Gross now:    ${inr(totalNow)}`);
  console.log(`  Gross after:  ${inr(totalAfter)}`);
  console.log(`  Change:       ${delta >= 0 ? '+' : ''}${inr(delta)}  (${totalNow > 0 ? ((delta / totalNow) * 100).toFixed(1) : '0'}%)`);
  console.log(`  ${up.length} paid more · ${down.length} paid less · ${rows.length - up.length - down.length} unchanged\n`);

  const byBranch = new Map<string, { n: number; now: number; after: number }>();
  for (const r of rows) {
    const cur = byBranch.get(r.branch) || { n: 0, now: 0, after: 0 };
    cur.n += 1; cur.now += r.gross_now; cur.after += r.gross_after;
    byBranch.set(r.branch, cur);
  }
  console.log('  ── By property ──');
  for (const [branch, v] of [...byBranch.entries()].sort((a, b) => (b[1].after - b[1].now) - (a[1].after - a[1].now))) {
    const d2 = v.after - v.now;
    console.log(`  ${branch.padEnd(28)} ${String(v.n).padStart(4)} emp   ${inr(v.now).padStart(14)} → ${inr(v.after).padStart(14)}   ${d2 >= 0 ? '+' : ''}${inr(d2)}`);
  }

  console.log('\n  ── The ten biggest movers ──');
  for (const r of [...rows].sort((a, b) => Math.abs(b.gross_delta) - Math.abs(a.gross_delta)).slice(0, 10)) {
    console.log(`  ${r.code.padEnd(10)} ${r.name.padEnd(24)} ${String(r.now_paid).padStart(6)} → ${String(r.after_paid).padStart(6)} days   ${r.gross_delta >= 0 ? '+' : ''}${inr(r.gross_delta)}`
      + `   (NP ${r.no_punch}, HHD ${r.hhd}, MP ${r.miss_punch})`);
  }

  // The gate that decides whether this month may be locked, measured the new way.
  const gatePct = num(schedule.attendance_gate_pct);
  const unevidencedPct = coverMarkable > 0 ? Math.round((coverUnevidenced / coverMarkable) * 1000) / 10 : 0;
  console.log('\n  ── Attendance evidence (the lock gate) ──');
  console.log(`  ${coverUnevidenced} of ${coverMarkable} working days would be paid with nothing showing the person worked — ${unevidencedPct}% (gate ${gatePct}%).`);
  console.log(`  ${unevidencedPct > gatePct ? 'OVER the gate — locking this month will require an explicit confirmation.' : 'Within the gate.'}`);

  if (mismatched.length) {
    console.log(`\n  !! ${mismatched.length} employee(s) EXCLUDED — this script could not reproduce the engine's own loss figure,`);
    console.log('     so its "after" number could not be trusted for them. Investigate before relying on the totals:');
    for (const m of mismatched.slice(0, 10)) console.log(`     ${m}`);
    if (mismatched.length > 10) console.log(`     ... and ${mismatched.length - 10} more`);
  }
  if (noSalary.length) {
    console.log(`\n  ${noSalary.length} employee(s) skipped — no salary assigned, so they cannot be priced either way.`);
  }

  const dir = path.join(process.cwd(), 'data');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `salary-spec-cost-${year}-${String(month).padStart(2, '0')}.csv`);
  const cols = ['code', 'name', 'branch', 'base', 'period_days', 'now_divisor', 'now_lop', 'now_paid',
    'after_lop', 'after_paid', 'day_delta', 'gross_now', 'gross_after', 'gross_delta',
    'no_punch', 'hhd', 'miss_punch'] as const;
  fs.writeFileSync(out, buildCsv([...cols], rows.map((r) => cols.map((c) => r[c]))), 'utf8');
  console.log(`\n  Per-employee detail: ${out}`);
  console.log('  Rupees are GROSS impact. Net moves differently — PF, ESI, PT and LWF do not all scale.\n');

  await db.destroy();
})().catch(async (e) => {
  console.error(e);
  await db.destroy();
  process.exit(1);
});
