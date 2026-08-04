/**
 * Generate a marked-grid attendance sheet for testing the upload screen.
 *
 * The grid importer (`services/attendanceGrid.service.ts`) is the one place in the app that takes a
 * whole month of attendance in a single file, and it is awkward to exercise by hand: one row per
 * employee, one column per day, and the employee codes have to match the target database
 * byte-for-byte or the rows are silently skipped. This builds that file.
 *
 * The ATTENDANCE IS INVENTED. Nothing here reads a real punch or a real absence — the point is to
 * put plausible-looking volume through the importer, the payroll engine and the reports, not to
 * reproduce anything that happened. Runs are deterministic (a fixed seed) so the same month always
 * produces the same sheet and two people comparing results are looking at the same data.
 *
 *   npm run attendance:grid --workspace=server -- --month=2026-07
 *   npm run attendance:grid --workspace=server -- --month=2026-08 --out=../sample-upload-data/x.csv
 *
 * Upload it at Admin → Attendance, picking the SAME month in the date field. A different month is
 * rejected or lands the rows in the wrong place.
 */
import fs from 'fs';
import path from 'path';
import db from '../config/database';

/** The codes the importer understands (`CODE_MAP` in attendanceGrid.service.ts). */
const CODES = ['P', 'A', 'HD', 'SP', 'MP', 'NP', 'HHD'] as const;
type Code = typeof CODES[number];

/** Column order of the summary block, matching the dashboard export the client already uses. */
const SUMMARY: Code[] = ['P', 'A', 'HD', 'SP', 'MP', 'NP', 'HHD'];

/**
 * Roughly what a hotel month looks like: mostly present, a tail of exceptions. Weighted rather than
 * uniform because a sheet that is 1/7th "no punch" tells you nothing about whether the payroll
 * numbers that come out the other side are plausible.
 */
const WEIGHTS: Array<[Code, number]> = [
  ['P', 62], ['A', 8], ['HD', 7], ['SP', 8], ['MP', 9], ['NP', 4], ['HHD', 2],
];

/** Deterministic PRNG (mulberry32) — same seed, same sheet, on any machine. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rand: () => number): Code {
  const total = WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let n = rand() * total;
  for (const [code, w] of WEIGHTS) {
    n -= w;
    if (n <= 0) return code;
  }
  return 'P';
}

const daysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate();
const pad = (n: number) => String(n).padStart(2, '0');

/** The header spelling the template uses: DD-MM-YYYY. Carries its own year, so no weekday guard. */
const headerDate = (y: number, m: number, d: number) => `${pad(d)}-${pad(m)}-${y}`;

/** RFC4180-ish: quote anything containing a comma, quote or newline. */
function csvCell(v: string | number): string {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

interface Person { code: string; name: string; }

/**
 * Every employee code the repository knows about, from BOTH sources, deduplicated.
 *
 * - the database this script is pointed at (`employees`, active only), and
 * - the 37 codes hard-coded in `import-csv.ts`, which are the real SaltStayz roster.
 *
 * Both are included because a sheet is uploaded to whichever environment is being tested, and the
 * two environments do not hold the same people. A code the target does not recognise costs nothing
 * — `uploadMarkedGrid` skips it and lists it under `unmatched` — whereas a MISSING code means that
 * person silently has no attendance for the month, which is the failure that is hard to notice.
 */
async function roster(): Promise<Person[]> {
  const rows = await db('employees')
    .where('is_active', true)
    .select('employee_code', 'first_name', 'last_name')
    .orderBy('employee_code');

  const seen = new Map<string, Person>();
  for (const r of rows) {
    const code = String(r.employee_code).trim();
    const name = `${r.first_name || ''} ${r.last_name || ''}`.trim();
    if (code) seen.set(code, { code, name: name || code });
  }

  // Merge the tracked roster without importing the module — it opens a db connection on import.
  const src = fs.readFileSync(path.join(__dirname, 'import-csv.ts'), 'utf-8');
  const re = /code:\s*'([^']+)'[^}]*?name:\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (!seen.has(m[1])) seen.set(m[1], { code: m[1], name: m[2] });
  }

  return [...seen.values()].sort((a, b) => {
    const na = /^\d+$/.test(a.code); const nb = /^\d+$/.test(b.code);
    if (na && nb) return Number(a.code) - Number(b.code);
    if (na !== nb) return na ? -1 : 1;
    return a.code.localeCompare(b.code);
  });
}

async function main() {
  const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
  const month = arg('month') || '2026-07';
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`--month must be YYYY-MM, got "${month}"`);
  const [year, mon] = month.split('-').map(Number);
  const days = daysInMonth(year, mon);

  const people = await roster();
  if (!people.length) throw new Error('No active employees found — is DATABASE_URL pointing at the right database?');

  const header = [
    'Emp Code', 'Empname',
    'Present', 'Absent', 'Half Day', 'Short Present', 'Missed Punch', 'No Punch', 'HHD',
    ...Array.from({ length: days }, (_, i) => headerDate(year, mon, i + 1)),
  ];

  const lines = [header.map(csvCell).join(',')];
  const tally: Record<Code, number> = { P: 0, A: 0, HD: 0, SP: 0, MP: 0, NP: 0, HHD: 0 };

  people.forEach((p, idx) => {
    // Seeded per employee AND per month, so adding someone does not reshuffle everyone else's row.
    const rand = rng(year * 1_000_000 + mon * 10_000 + idx * 7 + 13);
    const cells: Code[] = Array.from({ length: days }, () => pick(rand));

    // Guarantee every row shows at least two different exception codes. Without this the weighting
    // leaves a handful of rows as an unbroken run of P, which tests nothing.
    if (new Set(cells.filter((c) => c !== 'P')).size < 2) {
      cells[Math.floor(rand() * days)] = 'HD';
      cells[Math.floor(rand() * days)] = 'MP';
    }

    const counts = SUMMARY.map((code) => cells.filter((c) => c === code).length);
    // The summary block is decorative to the importer but a person WILL read it, and a sheet whose
    // own totals disagree with its own cells is worse than one with no totals at all.
    const sum = counts.reduce((a, b) => a + b, 0);
    if (sum !== days) throw new Error(`row ${p.code}: counts sum to ${sum}, expected ${days}`);
    cells.forEach((c) => { tally[c] += 1; });

    lines.push([p.code, p.name, ...counts, ...cells].map(csvCell).join(','));
  });

  const out = arg('out')
    ? path.resolve(process.cwd(), arg('out')!)
    : path.join(__dirname, '../../../sample-upload-data', `attendance-grid-${month}.csv`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${lines.join('\n')}\n`, 'utf-8');

  const cellCount = people.length * days;
  console.log(`${out}`);
  console.log(`  ${people.length} employees x ${days} days = ${cellCount} marks, month ${month}`);
  console.log('  ' + SUMMARY.map((c) => `${c}=${tally[c]} (${Math.round((tally[c] / cellCount) * 100)}%)`).join('  '));
  console.log('\nUpload at Admin -> Attendance with the month set to ' + month + '.');
  console.log('Marks landing on a weekly off or holiday are reported as "off_calendar" and not written — that is the importer working as designed.');

  await db.destroy();
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
