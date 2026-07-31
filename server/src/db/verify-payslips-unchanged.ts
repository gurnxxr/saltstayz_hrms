import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import db from '../config/database';
import * as payslip from '../services/payslip.service';

/**
 * Proves that no month which has already been paid has moved.
 *
 * This is the acceptance test for the whole Shift Management rework. Run
 * `npm run baseline:capture` BEFORE any of the rework ships, then run this after — it compares
 * every figure of every payslip ever issued against that copy, to the rupee, with no tolerance.
 * Payroll is whole rupees; a tolerance would hide exactly the bug this exists to catch.
 *
 * Two comparisons, because they can fail independently:
 *
 *   STORED — the saved payslip row against the baseline. Catches anything that rewrote history
 *   in the database.
 *
 *   SERVED — what the app hands back today against the baseline. Catches a read path that
 *   recomputes instead of serving the frozen copy, even though the stored row is intact.
 *
 * With --shadow it also recomputes each month under the CURRENT rules and reports how far that
 * would have drifted. Those differences are expected and are the point: they show the freeze is
 * doing real work rather than the old and new engines happening to agree.
 *
 *   npm run baseline:verify --workspace=server
 *   npm run baseline:verify --workspace=server -- --shadow
 *   npm run baseline:verify --workspace=server -- --in some/other/dir
 */

/** Flattens a payslip to leaf paths so two of them can be compared field by field. */
function flatten(value: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (value === null || typeof value !== 'object') { out[prefix] = value; return out; }
  if (Array.isArray(value)) {
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
    return out;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    flatten(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

/** Field paths that differ between two payslips, with both values. */
function diffFields(a: unknown, b: unknown): Array<{ path: string; before: unknown; after: unknown }> {
  const fa = flatten(a);
  const fb = flatten(b);
  const paths = new Set([...Object.keys(fa), ...Object.keys(fb)]);
  const out: Array<{ path: string; before: unknown; after: unknown }> = [];
  for (const p of paths) {
    if (JSON.stringify(fa[p]) !== JSON.stringify(fb[p])) out.push({ path: p, before: fa[p], after: fb[p] });
  }
  return out;
}

function inputDir(): string {
  const flag = process.argv.indexOf('--in');
  return flag !== -1 && process.argv[flag + 1]
    ? path.resolve(process.argv[flag + 1])
    : path.join(process.cwd(), 'data', 'shift-rework-baseline');
}

const money = (n: unknown) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

async function main() {
  const shadow = process.argv.includes('--shadow');
  const dir = inputDir();
  const file = path.join(dir, 'payslips.json');

  if (!fs.existsSync(file)) {
    console.error(`\nNo baseline at ${file}`);
    console.error('Run `npm run baseline:capture --workspace=server` BEFORE the rework ships,');
    console.error('otherwise there is nothing to check the current figures against.\n');
    process.exit(1);
  }

  const baseline = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows: any[] = baseline.payslips ?? [];
  const baselineRuns: any[] = baseline.runs ?? [];
  console.log(`Baseline captured ${baseline.captured_at}`);
  console.log(`${rows.length} payslip(s) to check\n`);

  if (!rows.length) {
    console.error('The baseline is EMPTY — it holds no payslips at all, so it cannot prove anything.\n');
    console.error('This is a FAILURE, not a pass. It previously reported PASSED for exactly this');
    console.error('state, which meant a change to the pay engine could ship with nothing underneath');
    console.error('it and still show a green run.\n');
    console.error('Capture one against the database you are about to change, then re-run:');
    console.error('  npm run baseline:capture --workspace=server\n');
    await db.destroy();
    process.exit(1);
  }

  const periodKey = (month: number, year: number) => `${year}-${String(month).padStart(2, '0')}`;

  /**
   * Months that were already PAID when the baseline was taken.
   *
   * This distinction only matters for the SERVED check. A locked month must hand back the same
   * figures forever, so any drift is a stop-the-line failure. A draft is meant to be re-runnable,
   * so it recomputing is correct behaviour — counting the two together would either bury a real
   * failure among expected noise, or halt a release over a month nobody has been paid for.
   * STORED drift stays a failure for both: nothing should ever rewrite a saved row.
   */
  const lockedAtCapture = new Set(
    baselineRuns.filter((r: any) => r.status === 'locked').map((r: any) => periodKey(r.month, r.year)),
  );

  let storedMismatches = 0;
  let servedMismatches = 0;
  let missing = 0;
  let appeared = 0;
  let runMismatches = 0;
  let unreproducible = 0;
  let checked = 0;
  /** SERVED drift on a month that was still a draft — expected, reported, but not a failure. */
  let draftDrift = 0;
  const draftNotes: string[] = [];
  const shadowDrift: Array<{
    who: string; period: string; fields: number;
    netBefore: unknown; netAfter: unknown; paths: string[];
  }> = [];
  const failures: string[] = [];

  // Month at a time, so a big history doesn't sit in memory all at once.
  const byPeriod = new Map<string, any[]>();
  for (const r of rows) {
    const key = `${r.year}-${String(r.month).padStart(2, '0')}`;
    if (!byPeriod.has(key)) byPeriod.set(key, []);
    byPeriod.get(key)!.push(r);
  }

  for (const [period, group] of [...byPeriod.entries()].sort()) {
    let periodStored = 0, periodServed = 0, periodMissing = 0, periodAppeared = 0, periodDraft = 0;
    const wasPaid = lockedAtCapture.has(period);

    for (const base of group) {
      checked += 1;

      // ── STORED: the row in the database against the baseline ──
      const row = await db('payslip_history')
        .where({ employee_id: base.employee_id, month: base.month, year: base.year })
        .first();
      if (!row) {
        missing += 1; periodMissing += 1;
        failures.push(`${period} employee ${base.employee_id}: the payslip no longer exists`);
        continue;
      }
      let storedSnapshot: unknown = null;
      try { storedSnapshot = JSON.parse(row.snapshot); } catch { storedSnapshot = { __unparseable: true }; }

      const storedDiff = diffFields(base.snapshot, storedSnapshot);
      if (storedDiff.length) {
        storedMismatches += 1; periodStored += 1;
        failures.push(
          `${period} employee ${base.employee_id}: the SAVED payslip changed — ` +
          storedDiff.slice(0, 3).map((d) => `${d.path}: ${JSON.stringify(d.before)} -> ${JSON.stringify(d.after)}`).join('; '),
        );
      }

      // ── SERVED: what the app hands back today ──
      let served: unknown = null;
      try {
        served = await payslip.getPayslipForStaff(base.employee_id, base.month, base.year);
      } catch (e: any) {
        servedMismatches += 1; periodServed += 1;
        failures.push(`${period} employee ${base.employee_id}: could not be read back — ${e.message}`);
        continue;
      }
      const servedDiff = diffFields(base.snapshot, served);
      if (servedDiff.length) {
        const detail = servedDiff.slice(0, 3)
          .map((d) => `${d.path}: ${JSON.stringify(d.before)} -> ${JSON.stringify(d.after)}`).join('; ');
        if (wasPaid) {
          servedMismatches += 1; periodServed += 1;
          failures.push(`${period} employee ${base.employee_id}: the payslip SERVED to the app changed — ${detail}`);
        } else {
          draftDrift += 1; periodDraft += 1;
          draftNotes.push(`${period} employee ${base.employee_id}: ${detail}`);
        }
      }

      // ── SHADOW: what today's rules would produce, if we let them ──
      if (shadow) {
        try {
          const live = await payslip.computeForEmployee(base.employee_id, base.month, base.year);
          const drift = diffFields(base.snapshot, live);
          if (drift.length) {
            shadowDrift.push({
              who: String(base.employee_id),
              period,
              fields: drift.length,
              netBefore: (base.snapshot as any)?.breakdown?.net_pay,
              netAfter: (live as any)?.breakdown?.net_pay,
              // Which fields moved matters as much as by how much: a month with no lost pay
              // can shift its working-day count without the money changing at all.
              paths: drift.slice(0, 4).map((d) => `${d.path}: ${JSON.stringify(d.before)} -> ${JSON.stringify(d.after)}`),
            });
          }
        } catch { /* an employee whose salary can no longer be resolved isn't a reproducibility failure */ }
      }
    }

    // ── APPEARED: a payslip in this period that the baseline never had ──
    // Iterating the baseline alone can only ever notice rows that changed or vanished. A slip
    // INSERTED into a paid month is invisible that way, yet it moves the month's run totals,
    // because those are re-aggregated across every slip in the period.
    const liveIds = await db('payslip_history')
      .where({ month: group[0].month, year: group[0].year }).pluck('employee_id');
    const baselineIds = new Set(group.map((g: any) => g.employee_id));
    for (const id of liveIds) {
      if (!baselineIds.has(id)) {
        appeared += 1; periodAppeared += 1;
        failures.push(`${period} employee ${id}: a payslip APPEARED that the baseline never had`);
      }
    }

    const flag = (periodStored + periodServed + periodMissing + periodAppeared) ? 'CHANGED'
      : periodDraft ? `${periodDraft} recomputed (expected — draft)`
      : 'identical';
    console.log(`  ${period}  ${String(group.length).padStart(4)} payslip(s)  ${wasPaid ? 'paid ' : 'draft'}  ${flag}`);
  }

  // ── RUN TOTALS: the month's headline figures ──
  // What finance actually reports and pays against. They are an aggregate, so they can move
  // even when every individual payslip is byte-identical.
  if (!baselineRuns.length) {
    runMismatches += 1;
    failures.push(
      "the baseline holds no payroll runs, so a month's headline figures — the numbers finance " +
      'reports and pays against — were never covered here. They are an aggregate and can move ' +
      'even when every individual payslip is byte-identical.',
    );
  }
  for (const b of baselineRuns) {
    const live = await db('payroll_runs').where({ month: b.month, year: b.year }).first();
    const period = `${b.year}-${String(b.month).padStart(2, '0')}`;
    if (!live) {
      runMismatches += 1;
      failures.push(`${period}: the payroll run no longer exists`);
      continue;
    }
    for (const f of ['status', 'employee_count', 'total_net', 'total_ctc'] as const) {
      const before = b[f] === null || b[f] === undefined ? b[f] : String(b[f]);
      const after = live[f] === null || live[f] === undefined ? live[f] : String(live[f]);
      if (before !== after) {
        runMismatches += 1;
        failures.push(`${period}: the run's ${f} changed — ${JSON.stringify(b[f])} -> ${JSON.stringify(live[f])}`);
      }
    }
  }

  // ── A LOCKED run with no payslips behind it ──
  // Every other check here iterates payslips that exist, so a paid month holding none is invisible
  // to all of them. It is the worst case rather than a gap: with nothing stored, the read path
  // falls through to computing the figures live, so what a payslip screen shows for that month is
  // whatever today's engine produces — not what the person was actually paid. It moves silently
  // every time the rules change.
  const periodsWithSlips = new Set(rows.map((r: any) => periodKey(r.month, r.year)));
  for (const b of baselineRuns) {
    if (b.status !== 'locked') continue;
    const period = periodKey(b.month, b.year);
    if (periodsWithSlips.has(period)) continue;
    const live = await db('payslip_history').where({ month: b.month, year: b.year }).count('id as c').first();
    if (Number(live?.c ?? 0) > 0) continue;
    unreproducible += 1;
    failures.push(
      `${period}: the run is LOCKED — ${b.employee_count} employee(s), ${money(b.total_net)} net — ` +
      'but holds no payslips at all, so those figures cannot be reproduced from this system',
    );
  }

  console.log('');
  console.log(`Checked            ${checked}`);
  console.log(`Saved payslips     ${storedMismatches ? `${storedMismatches} CHANGED` : 'all identical'}`);
  console.log(`Served payslips    ${servedMismatches ? `${servedMismatches} CHANGED` : 'all identical'} (paid months)`);
  console.log(`Run totals         ${runMismatches ? `${runMismatches} CHANGED` : baselineRuns.length ? 'all identical' : 'NOT COVERED'}`);
  if (draftDrift) console.log(`Draft recomputed   ${draftDrift} (expected — a draft is meant to be re-runnable)`);
  if (unreproducible) console.log(`Unreproducible     ${unreproducible} paid month(s) with no payslips`);
  if (missing) console.log(`Missing            ${missing}`);
  if (appeared) console.log(`Appeared           ${appeared}`);

  if (failures.length) {
    console.log(`\nThe following moved — this is a stop-the-line failure, not something to tolerate:\n`);
    for (const f of failures.slice(0, 40)) console.log(`  ${f}`);
    if (failures.length > 40) console.log(`  …and ${failures.length - 40} more`);
  }

  if (draftNotes.length) {
    console.log(`\nDrafts that now compute differently — expected, but read them rather than`);
    console.log(`assuming: these become real money the moment someone runs and locks the month.\n`);
    for (const n of draftNotes.slice(0, 10)) console.log(`  ${n}`);
    if (draftNotes.length > 10) console.log(`  …and ${draftNotes.length - 10} more`);
  }

  if (shadow) {
    console.log(`\n── Shadow: what today's rules would have produced ──`);
    if (!shadowDrift.length) {
      console.log('  No difference. Either the calendars genuinely agree for this history, or these');
      console.log('  employees have no attendance to differ over — worth knowing which.');
    } else {
      const moneyMoved = shadowDrift.filter((d) => Math.round(Number(d.netBefore) || 0) !== Math.round(Number(d.netAfter) || 0));
      console.log(`  ${shadowDrift.length} of ${checked} payslip(s) would come out differently.`);
      console.log(`  ${moneyMoved.length} of those would change what the person is actually paid.\n`);
      for (const d of shadowDrift.slice(0, 10)) {
        const moved = Math.round(Number(d.netBefore) || 0) !== Math.round(Number(d.netAfter) || 0);
        console.log(`    ${d.period} employee ${d.who}: ${d.fields} field(s)` +
          (moved ? `, net ${money(d.netBefore)} -> ${money(d.netAfter)}` : ', net unchanged'));
        for (const p of d.paths) console.log(`        ${p}`);
      }
      if (shadowDrift.length > 10) console.log(`    …and ${shadowDrift.length - 10} more`);
      console.log(`\n  These differences are expected and are the point: they are what the freeze is`);
      console.log(`  preventing. If this list were empty the freeze would be untested, not proven.`);
      if (shadowDrift.length && !moneyMoved.length) {
        console.log(`\n  Note: the day counts moved but no pay did. That happens when nobody lost any`);
        console.log(`  pay in these months — with no deductions the proration ratio stays 1 however`);
        console.log(`  many working days there are. Months WITH absences are where money would move.`);
      }
    }
  }

  const failed = storedMismatches + servedMismatches + missing + appeared + runMismatches + unreproducible > 0;
  console.log(`\n${failed ? 'FAILED — a paid month moved.' : 'PASSED — every paid month reproduces exactly.'}\n`);
  await db.destroy();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error(`\n${e.message}\n`); await db.destroy(); process.exit(1); });
