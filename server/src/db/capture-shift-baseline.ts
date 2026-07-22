/**
 * Captures everything the Shift Management rework is about to make unrecoverable.
 *
 * Run this ONCE against real data before any of the rework ships. It is strictly read-only.
 *
 * Three things are captured:
 *
 *  1. `payslips.json` — every figure of every payslip ever issued. This is the reference the
 *     final stage diffs against to prove no paid month moved.
 *
 *  2. `roster-provenance.json` — which months were actually driven by a published roster.
 *     Payroll computes this per run but never stores it, so once the roster stops being
 *     written there is no way to tell afterwards whether a past month followed the roster or
 *     fell back to the company work week.
 *
 *  3. `weekly-patterns.json` — each employee's observed off-day pattern and usual shift,
 *     derived from published roster cells. This is the input for working out who should be
 *     mapped to which shift, and it can only be derived while the roster is still populated.
 *
 * Output goes to server/data/ (gitignored) because it contains employee names.
 *
 *   npm run baseline:capture --workspace=server
 *   npm run baseline:capture --workspace=server -- --out some/other/dir
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import db from '../config/database';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Day of week for a 'YYYY-MM-DD' string, without timezone drift. */
function dowOf(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Monday-start week key for a 'YYYY-MM-DD' string. */
function mondayOf(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const shift = (dt.getUTCDay() + 6) % 7; // Mon = 0
  dt.setUTCDate(dt.getUTCDate() - shift);
  return dt.toISOString().slice(0, 10);
}

function outDir(): string {
  const flag = process.argv.indexOf('--out');
  const dir = flag !== -1 && process.argv[flag + 1]
    ? path.resolve(process.argv[flag + 1])
    : path.join(process.cwd(), 'data', 'shift-rework-baseline');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function write(dir: string, name: string, data: unknown): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  const kb = Math.round(fs.statSync(file).size / 1024);
  console.log(`  wrote ${name} (${kb} KB)`);
  return file;
}

async function capturePayslips(dir: string) {
  console.log('\n1. Payslips — the reference for proving nothing moved');
  const periods = await db('payslip_history')
    .distinct('year', 'month').orderBy(['year', 'month']) as Array<{ year: number; month: number }>;
  console.log(`   ${periods.length} period(s) with payslips`);

  const out: any[] = [];
  // Month at a time: snapshots are large and this can run against a full year of history.
  for (const p of periods) {
    const rows = await db('payslip_history')
      .where({ month: p.month, year: p.year })
      .select('id', 'employee_id', 'month', 'year', 'pay_date', 'gross_earnings',
        'total_deduction', 'net_pay', 'ctc', 'run_id', 'calc_version', 'snapshot')
      .orderBy('employee_id');
    for (const r of rows) {
      let snapshot: unknown = null;
      try { snapshot = JSON.parse(r.snapshot); } catch { snapshot = { __unparseable: true }; }
      out.push({
        id: r.id,
        employee_id: r.employee_id,
        month: r.month,
        year: r.year,
        pay_date: r.pay_date,
        gross_earnings: r.gross_earnings,
        total_deduction: r.total_deduction,
        net_pay: r.net_pay,
        ctc: r.ctc,
        run_id: r.run_id,
        calc_version: r.calc_version,
        snapshot,
      });
    }
    console.log(`   ${String(p.month).padStart(2, '0')}/${p.year}: ${rows.length} payslip(s)`);
  }

  const runs = await db('payroll_runs')
    .select('id', 'month', 'year', 'status', 'employee_count', 'total_net', 'total_ctc',
      'locked_at', 'unlocked_at', 'unlock_reason')
    .orderBy(['year', 'month']);

  write(dir, 'payslips.json', { captured_at: new Date().toISOString(), runs, payslips: out });
  return { periods: periods.length, payslips: out.length };
}

async function captureRosterProvenance(dir: string) {
  console.log('\n2. Roster provenance — which months actually followed a roster');
  if (!(await db.schema.hasTable('shift_rosters'))) {
    console.log('   the roster table has already been dropped — nothing to capture');
    write(dir, 'roster-provenance.json', { captured_at: new Date().toISOString(), periods: [], covered_weeks_by_employee: {} });
    return { periods: 0, cells: 0 };
  }
  const rows = await db('shift_rosters')
    .select('employee_id', 'date', 'day_type', 'is_published', 'property_id');
  console.log(`   ${rows.length} roster cell(s) total`);

  // Per month: how many employees had at least one PUBLISHED cell. Payroll only ever
  // trusted published cells, so an unpublished month silently ran on the work week.
  const byPeriod = new Map<string, { published: Set<number>; draft: Set<number>; cells: number; publishedCells: number }>();
  // Per employee: the Monday-start weeks that had a published cell — that was the unit of
  // roster authority, not the month.
  const coveredWeeks = new Map<number, Set<string>>();

  for (const r of rows) {
    const iso = String(r.date).slice(0, 10);
    const key = `${iso.slice(0, 4)}-${iso.slice(5, 7)}`;
    if (!byPeriod.has(key)) byPeriod.set(key, { published: new Set(), draft: new Set(), cells: 0, publishedCells: 0 });
    const p = byPeriod.get(key)!;
    p.cells += 1;
    if (r.is_published) {
      p.publishedCells += 1;
      p.published.add(r.employee_id);
      if (!coveredWeeks.has(r.employee_id)) coveredWeeks.set(r.employee_id, new Set());
      coveredWeeks.get(r.employee_id)!.add(mondayOf(iso));
    } else {
      p.draft.add(r.employee_id);
    }
  }

  const periods = [...byPeriod.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, v]) => ({
    period,
    total_cells: v.cells,
    published_cells: v.publishedCells,
    employees_with_published: v.published.size,
    employees_draft_only: [...v.draft].filter((e) => !v.published.has(e)).length,
    roster_driven: v.publishedCells > 0,
  }));
  for (const p of periods) {
    console.log(`   ${p.period}: ${p.published_cells}/${p.total_cells} published, ${p.employees_with_published} employee(s) roster-driven`);
  }

  write(dir, 'roster-provenance.json', {
    captured_at: new Date().toISOString(),
    periods,
    covered_weeks_by_employee: Object.fromEntries(
      [...coveredWeeks.entries()].map(([emp, weeks]) => [emp, [...weeks].sort()]),
    ),
  });
  return { periods: periods.length, cells: rows.length };
}

async function captureWeeklyPatterns(dir: string) {
  console.log('\n3. Weekly patterns — each employee\'s observed off days and usual shift');
  if (!(await db.schema.hasTable('shift_rosters'))) {
    console.log('   the roster table has already been dropped — patterns can no longer be derived');
    write(dir, 'weekly-patterns.json', { captured_at: new Date().toISOString(), employees: [] });
    return { employees: 0, confident: 0 };
  }
  const rows = await db('shift_rosters as r')
    .leftJoin('shift_types as st', 'st.id', 'r.shift_type_id')
    .where('r.is_published', true)
    .select('r.employee_id', 'r.date', 'r.day_type', 'r.shift_type_id', 'st.name as shift_name');
  console.log(`   ${rows.length} published cell(s) to learn from`);

  const byEmp = new Map<number, {
    working: number[]; off: number[]; shifts: Map<number, { n: number; name: string }>; weeks: Set<string>;
  }>();

  for (const r of rows) {
    const iso = String(r.date).slice(0, 10);
    if (!byEmp.has(r.employee_id)) {
      byEmp.set(r.employee_id, {
        working: new Array(7).fill(0), off: new Array(7).fill(0), shifts: new Map(), weeks: new Set(),
      });
    }
    const e = byEmp.get(r.employee_id)!;
    e.weeks.add(mondayOf(iso));
    const d = dowOf(iso);
    if (r.day_type === 'weekly_off') e.off[d] += 1;
    else {
      e.working[d] += 1;
      if (r.shift_type_id) {
        const cur = e.shifts.get(r.shift_type_id) ?? { n: 0, name: r.shift_name ?? `#${r.shift_type_id}` };
        cur.n += 1;
        e.shifts.set(r.shift_type_id, cur);
      }
    }
  }

  const employees = await db('employees')
    .whereIn('id', [...byEmp.keys()].length ? [...byEmp.keys()] : [-1])
    .select('id', 'employee_code', 'first_name', 'last_name', 'branch_name');
  const empById = new Map(employees.map((e: any) => [e.id, e]));

  const out = [...byEmp.entries()].map(([employee_id, e]) => {
    const emp = empById.get(employee_id);
    const weeks = e.weeks.size;
    // A day is a confident off day when it was rostered off in most of the weeks we saw and
    // was never rostered as working.
    const offDays: number[] = [];
    const unclear: string[] = [];
    for (let d = 0; d < 7; d++) {
      const off = e.off[d], work = e.working[d];
      if (off === 0 && work === 0) continue; // never rostered either way
      if (off > 0 && work === 0) offDays.push(d);
      else if (off > 0 && work > 0) unclear.push(`${DOW[d]} (off ${off}x, worked ${work}x)`);
    }
    const topShift = [...e.shifts.entries()].sort((a, b) => b[1].n - a[1].n)[0];
    const shiftSpread = e.shifts.size;

    return {
      employee_id,
      employee_code: emp?.employee_code ?? null,
      name: emp ? `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim() : null,
      property: emp?.branch_name ?? null,
      weeks_observed: weeks,
      off_days: offDays,
      off_days_label: offDays.map((d) => DOW[d]),
      inconsistent_days: unclear,
      usual_shift_id: topShift?.[0] ?? null,
      usual_shift_name: topShift?.[1].name ?? null,
      usual_shift_share: topShift ? Number((topShift[1].n / Math.max(1, e.working.reduce((a, b) => a + b, 0))).toFixed(2)) : null,
      distinct_shifts: shiftSpread,
      // Confident enough to apply without review: enough weeks seen, one shift, clean offs.
      confident: weeks >= 3 && shiftSpread === 1 && unclear.length === 0 && offDays.length > 0,
    };
  }).sort((a, b) => (a.employee_code ?? '').localeCompare(b.employee_code ?? ''));

  const confident = out.filter((e) => e.confident).length;
  console.log(`   ${out.length} employee(s) with a pattern; ${confident} confident, ${out.length - confident} need review`);

  write(dir, 'weekly-patterns.json', { captured_at: new Date().toISOString(), employees: out });
  return { employees: out.length, confident };
}

async function main() {
  const dir = outDir();
  console.log(`Capturing baseline to ${dir}`);
  console.log('Read-only — nothing in the database is modified.');

  const p = await capturePayslips(dir);
  const r = await captureRosterProvenance(dir);
  const w = await captureWeeklyPatterns(dir);

  const summary = [
    `Shift rework baseline — captured ${new Date().toISOString()}`,
    ``,
    `Payslips        ${p.payslips} across ${p.periods} period(s)`,
    `Roster cells    ${r.cells} across ${r.periods} period(s)`,
    `Patterns        ${w.employees} employee(s), ${w.confident} confident / ${w.employees - w.confident} need review`,
    ``,
    `payslips.json          reference for proving no paid month moved`,
    `roster-provenance.json which months actually followed a published roster`,
    `weekly-patterns.json   who works which shift, and their off days`,
    ``,
    `Contains employee names — server/data/ is gitignored. Do not commit or share.`,
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'summary.txt'), summary, 'utf8');

  console.log(`\n${summary}\n`);
  await db.destroy();
}

main().catch(async (e) => { console.error(`\n${e.message}\n`); await db.destroy(); process.exit(1); });
