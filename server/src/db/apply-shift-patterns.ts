import 'dotenv/config';
import db from '../config/database';
import { parseOffDayRules } from '../services/shiftPattern';

/**
 * Works out each shift's off days from the weekly roster that is being retired, and reports
 * them for review before anything is changed.
 *
 * Off days now live on the shift, but the roster recorded them per employee — so this only
 * proposes a pattern where every employee on a shift was rostered the same way. Where they
 * disagree, it says so and proposes nothing: that needs a person to decide whether to split
 * the shift or standardise it, and guessing would change someone's pay.
 *
 * Reports by default; only writes with --apply.
 *
 *   npm run patterns:report --workspace=server
 *   npm run patterns:report --workspace=server -- --apply
 */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const dowOf = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
const occurrenceOf = (iso: string) => Math.floor((Number(iso.slice(8, 10)) - 1) / 7) + 1;

interface Observed {
  /** offCount[weekday][occurrence] and workCount[weekday][occurrence] */
  off: number[][];
  work: number[][];
  weeks: Set<string>;
}

const emptyObserved = (): Observed => ({
  off: Array.from({ length: 7 }, () => new Array(6).fill(0)),
  work: Array.from({ length: 7 }, () => new Array(6).fill(0)),
  weeks: new Set(),
});

/** Turns what was observed into an off-day pattern, or explains why it can't. */
function derivePattern(o: Observed): { rules: any[]; issues: string[] } {
  const rules: any[] = [];
  const issues: string[] = [];

  for (let day = 0; day < 7; day++) {
    const offTotal = o.off[day].reduce((a, b) => a + b, 0);
    const workTotal = o.work[day].reduce((a, b) => a + b, 0);
    if (offTotal === 0) continue; // never an off day

    if (workTotal === 0) {
      rules.push({ day, weeks: null }); // off every time it came round
      continue;
    }

    // Sometimes off, sometimes worked — only a pattern if it splits cleanly by which
    // occurrence of the month it was, which is how alternate-Saturday arrangements look.
    const offWeeks: number[] = [];
    let clean = true;
    for (let occ = 1; occ <= 5; occ++) {
      const off = o.off[day][occ];
      const work = o.work[day][occ];
      if (off > 0 && work > 0) { clean = false; break; }
      if (off > 0) offWeeks.push(occ);
    }
    if (clean && offWeeks.length) rules.push({ day, weeks: offWeeks });
    else issues.push(`${DAYS[day]} was sometimes off and sometimes worked with no clear pattern (off ${offTotal}x, worked ${workTotal}x)`);
  }

  return { rules, issues };
}

const sameRules = (a: any[], b: any[]) =>
  JSON.stringify([...a].sort((x, y) => x.day - y.day)) === JSON.stringify([...b].sort((x, y) => x.day - y.day));

const describe = (rules: any[]) =>
  rules.length === 0 ? '(none)' : rules
    .slice().sort((a, b) => a.day - b.day)
    .map((r) => (r.weeks ? `${DAYS[r.day]}(${r.weeks.join(',')})` : DAYS[r.day]))
    .join(' ');

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(apply ? 'APPLYING derived off-day patterns\n' : 'Reporting derived off-day patterns (nothing will be changed)\n');

  if (!(await db.schema.hasTable('shift_rosters'))) {
    console.log('The roster table has been dropped, so there is nothing left to derive patterns from.');
    console.log('Set each shift\'s off days by hand on the Shift Type screen.\n');
    await db.destroy();
    return;
  }

  const cells = await db('shift_rosters')
    .where('is_published', true)
    .select('employee_id', 'date', 'day_type');
  console.log(`Read ${cells.length} published roster cell(s)`);
  if (!cells.length) {
    console.log('\nNo published roster to learn from. Set each shift\'s off days by hand on the Shift Type screen.');
    await db.destroy();
    return;
  }

  // What each employee was actually rostered.
  const byEmployee = new Map<number, Observed>();
  for (const c of cells) {
    const iso = String(c.date).slice(0, 10);
    if (!byEmployee.has(c.employee_id)) byEmployee.set(c.employee_id, emptyObserved());
    const o = byEmployee.get(c.employee_id)!;
    o.weeks.add(iso.slice(0, 7));
    const day = dowOf(iso);
    const occ = occurrenceOf(iso);
    if (c.day_type === 'weekly_off') o.off[day][occ] += 1;
    else o.work[day][occ] += 1;
  }

  // The shift each of those employees is on now.
  const assignments = await db('employee_shift_assignments as a')
    .join('shift_types as st', 'st.id', 'a.shift_type_id')
    .whereIn('a.employee_id', [...byEmployee.keys()])
    .select('a.employee_id', 'st.id as shift_id', 'st.name as shift_name', 'st.weekly_off_days')
    .orderBy('a.effective_from');
  const shiftOf = new Map<number, any>();
  for (const a of assignments) shiftOf.set(a.employee_id, a); // latest wins

  const employees = await db('employees')
    .whereIn('id', [...byEmployee.keys()])
    .select('id', 'employee_code', 'first_name', 'last_name');
  const empById = new Map(employees.map((e: any) => [e.id, e]));

  // Group the derived patterns by shift.
  const byShift = new Map<number, { name: string; existing: any[]; groups: Map<string, { rules: any[]; who: string[] }>; problems: string[] }>();
  const unassigned: string[] = [];

  for (const [employeeId, observed] of byEmployee) {
    const emp = empById.get(employeeId);
    const who = emp ? `${emp.employee_code} ${emp.first_name} ${emp.last_name}`.trim() : `#${employeeId}`;
    const shift = shiftOf.get(employeeId);
    if (!shift) { unassigned.push(who); continue; }

    const { rules, issues } = derivePattern(observed);
    if (!byShift.has(shift.shift_id)) {
      byShift.set(shift.shift_id, {
        name: shift.shift_name,
        existing: parseOffDayRules(shift.weekly_off_days),
        groups: new Map(),
        problems: [],
      });
    }
    const entry = byShift.get(shift.shift_id)!;
    for (const i of issues) entry.problems.push(`${who}: ${i}`);

    const key = describe(rules);
    if (!entry.groups.has(key)) entry.groups.set(key, { rules, who: [] });
    entry.groups.get(key)!.who.push(who);
  }

  // ── Report ──
  const toApply: Array<{ id: number; name: string; rules: any[] }> = [];
  console.log('');
  for (const [shiftId, entry] of byShift) {
    const patterns = [...entry.groups.entries()];
    console.log(`${entry.name}  (currently ${describe(entry.existing)})`);
    for (const [label, group] of patterns) {
      console.log(`   ${label.padEnd(28)} ${group.who.length} employee(s)`);
      if (group.who.length <= 4) for (const w of group.who) console.log(`      ${w}`);
    }

    if (entry.problems.length) {
      console.log(`   NEEDS REVIEW — no clear pattern:`);
      for (const p of entry.problems.slice(0, 4)) console.log(`      ${p}`);
      if (entry.problems.length > 4) console.log(`      …and ${entry.problems.length - 4} more`);
    } else if (patterns.length > 1) {
      console.log(`   NEEDS REVIEW — employees on this shift had different off days.`);
      console.log(`      Either split them onto separate shifts, or agree one pattern and set it by hand.`);
    } else if (entry.existing.length && !sameRules(entry.existing, patterns[0][1].rules)) {
      console.log(`   SKIPPED — the shift already has a different pattern set; not overwriting it.`);
    } else if (entry.existing.length) {
      console.log(`   already matches`);
    } else {
      console.log(`   → would set ${describe(patterns[0][1].rules)}`);
      toApply.push({ id: shiftId, name: entry.name, rules: patterns[0][1].rules });
    }
    console.log('');
  }

  if (unassigned.length) {
    console.log(`${unassigned.length} employee(s) were rostered but have no shift assigned — assign one first:`);
    for (const w of unassigned.slice(0, 10)) console.log(`   ${w}`);
    if (unassigned.length > 10) console.log(`   …and ${unassigned.length - 10} more`);
    console.log('');
  }

  console.log(`${toApply.length} shift(s) can be set automatically; ${byShift.size - toApply.length} need a person to look.`);

  if (!apply) {
    console.log('\nNothing was changed. Re-run with --apply once the above looks right.');
    await db.destroy();
    return;
  }

  for (const s of toApply) {
    await db('shift_types').where('id', s.id)
      .update({ weekly_off_days: JSON.stringify(s.rules), updated_at: db.fn.now() });
    console.log(`  set ${s.name} → ${describe(s.rules)}`);
  }
  console.log(`\nApplied to ${toApply.length} shift(s).`);
  await db.destroy();
}

main().catch(async (e) => { console.error(`\n${e.message}\n`); await db.destroy(); process.exit(1); });
