/**
 * Prove the generated dataset is COHERENT, not merely well-formed.
 *
 * A file can parse perfectly and still be useless: an attendance row for an employee who is not in
 * the employee sheet, an employee at a property that is not in the property sheet, a job title that
 * does not exist. Each of those imports "successfully" — the row is skipped and counted — and the
 * feature under test then has no data, which is exactly the failure that wastes an afternoon.
 *
 * So this runs the app's OWN parsers over the files and then checks every reference between them.
 *
 *   npm run testdata:verify --workspace=server
 */
import fs from 'fs';
import path from 'path';
import { parseMarkedGrid } from '../services/attendanceGrid.service';
import { parsePropertiesCsv } from '../controllers/organization.controller';
import { parseCsv } from '../utils/csv';
import db from '../config/database';

const DIR = path.join(__dirname, '../../../test-data');
const read = (f: string) => fs.readFileSync(path.join(DIR, f), 'utf-8');
/** The naive split four of the importers use — good enough here, and it proves there are no commas. */
const grid = (f: string) => read(f).split(/\r?\n/).filter((l) => l.length).map((l) => l.split(','));

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function main() {
  console.log('Structure\n');

  // ─── properties, through the real controller parser ───
  const props = parsePropertiesCsv(read('01_properties.csv'));
  const { INDIAN_STATES } = await import('../services/statutory.service');
  check('properties parse', props.length === 10, `${props.length} rows`);
  check('every property has a recognised state',
    props.every((p) => p.state && (INDIAN_STATES as string[]).includes(p.state)),
    [...new Set(props.map((p) => p.state))].join(', '));

  // ─── employees ───
  const emp = grid('03_employees.csv');
  const eh = emp[0];
  const col = (n: string) => eh.indexOf(n);
  const codes = new Set(emp.slice(1).map((r) => r[col('Employee Code')]));
  const propNames = new Set(props.map((p) => p.name));
  check('employees parse', emp.length - 1 === 150, `${emp.length - 1} rows`);
  check('every row has the same column count', emp.every((r) => r.length === eh.length));
  check('employee codes are unique', codes.size === emp.length - 1);
  check('no commas anywhere (four parsers split naively)', !read('03_employees.csv').includes('"'));

  const badBranch = emp.slice(1).filter((r) => !propNames.has(r[col('Branch Name')]));
  check('every Branch Name resolves to a property (bar the deliberate orphan)',
    badBranch.length === 1 && badBranch[0][col('Branch Name')] === 'SaltStayz Nowhere',
    `${badBranch.length} unresolved`);

  const titles = new Set((await db('job_titles').select('title')).map((r: any) => String(r.title).toLowerCase()));
  const badTitle = emp.slice(1).filter((r) => !titles.has(r[col('Job Title')].toLowerCase()));
  check('every Job Title exists (the one column that REJECTS a row)', badTitle.length === 0,
    badTitle.length ? [...new Set(badTitle.map((r) => r[col('Job Title')]))].join(', ') : '');

  const depts = new Set((await db('departments').select('name')).map((r: any) => String(r.name)));
  const badDept = emp.slice(1).filter((r) => !depts.has(r[col('Department')]));
  check('every Department exists (else no department holidays)', badDept.length === 0,
    badDept.length
      ? `${badDept.length} rows name a department this database does not have: ${[...new Set(badDept.map((r) => r[col('Department')]))].join(', ')} — create it, see SETUP.md`
      : '');

  const mgrs = emp.slice(1).map((r) => r[col('Reporting Manager Code')]).filter(Boolean);
  check('every manager code exists', mgrs.every((m) => codes.has(m)));
  // Order matters: the importer resolves against the DB row by row, so a manager further down the
  // file does not resolve and the failure is silent.
  const idxOf = new Map(emp.slice(1).map((r, i) => [r[col('Employee Code')], i]));
  const late = emp.slice(1).filter((r, i) => r[col('Reporting Manager Code')] && (idxOf.get(r[col('Reporting Manager Code')]) ?? 0) >= i);
  check('every manager appears BEFORE their reports', late.length === 0, `${late.length} out of order`);

  const pan = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
  check('every PAN matches the required shape', emp.slice(1).every((r) => pan.test(r[col('PAN Number')])));
  check('every Aadhaar is 12 digits', emp.slice(1).every((r) => /^\d{12}$/.test(r[col('Aadhaar Number')])));
  const emails = emp.slice(1).map((r) => r[col('Email')]);
  check('emails are unique', new Set(emails).size === emails.length);

  // ─── attendance grids, through the real importer ───
  console.log('\nAttendance\n');
  for (const [file, month] of [['08_attendance_grid_2026-05.csv', '2026-05'],
    ['09_attendance_grid_2026-06.csv', '2026-06'], ['10_attendance_grid_2026-07.csv', '2026-07']] as const) {
    const res = parseMarkedGrid(grid(file), { month });
    const sheetCodes = new Set(res.cells.map((c) => c.empCode));
    const orphans = [...sheetCodes].filter((c) => !codes.has(c));
    check(`${month}: parses, ${res.cells.length} marks over ${res.dates.length} days`,
      res.cells.length > 0 && res.dates.length >= 30);
    check(`${month}: no unrecognised codes`, res.unrecognized.length === 0, res.unrecognized.join(','));
    check(`${month}: no weekday mismatches`, res.weekdayMismatches.length === 0);
    check(`${month}: every employee in the sheet is in the employee file`, orphans.length === 0,
      orphans.slice(0, 5).join(','));
  }

  // Summary block must agree with the row's own cells, on every row of every month.
  let mismatches = 0;
  for (const file of ['08_attendance_grid_2026-05.csv', '09_attendance_grid_2026-06.csv', '10_attendance_grid_2026-07.csv']) {
    const m = grid(file); const h = m[0];
    const order = ['P', 'A', 'HD', 'SP', 'MP', 'NP', 'HHD'];
    const sums = ['Present', 'Absent', 'Half Day', 'Short Present', 'Missed Punch', 'No Punch', 'HHD'].map((x) => h.indexOf(x));
    const first = h.findIndex((x) => /^\d{2}-\d{2}-\d{4}$/.test(x));
    for (let r = 1; r < m.length; r += 1) {
      const cells = m[r].slice(first);
      order.forEach((c, i) => { if (Number(m[r][sums[i]]) !== cells.filter((x) => x === c).length) mismatches += 1; });
    }
  }
  check('every summary block agrees with its own cells', mismatches === 0, `${mismatches} disagreements`);

  // ─── the remaining surfaces ───
  console.log('\nOther surfaces\n');
  const bio = grid('07_attendance_biometric_week.csv');
  const bioCodes = new Set(bio.slice(1).map((r) => r[0]));
  check('biometric: every code is a known employee', [...bioCodes].every((c) => codes.has(c)));
  check('biometric: dates are DD-MM-YYYY', bio.slice(1).every((r) => /^\d{2}-\d{2}-\d{4}$/.test(r[1])));

  const shifts = grid('04_shift_assignments.csv');
  const shiftNames = new Set((await db('shift_types').where('is_active', true).select('name')).map((r: any) => String(r.name)));
  check('shifts: every code is a known employee', shifts.slice(1).every((r) => codes.has(r[0])));
  check('shifts: every shift name is an ACTIVE shift type', shifts.slice(1).every((r) => shiftNames.has(r[1])));
  check('shifts: effective_from is strictly YYYY-MM-DD', shifts.slice(1).every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r[2])));

  // parseCsv is the real RFC-4180 parser the quote-aware importers use; row 0 is the header.
  const assets = parseCsv(read('11_asset_assignments.csv')).slice(1);
  check('assets: every code is a known employee', assets.every((r) => codes.has(r[0])));

  const cands = parseCsv(read('12_recruitment_candidates.csv')).slice(1);
  check('candidates: parse with quoted commas intact',
    cands.length === 25 && cands.some((r) => r[3].includes(',')),
    `${cands.length} rows`);

  for (const f of ['06a_holidays_national.csv', '06b_holidays_delhi.csv', '06c_holidays_karnataka.csv']) {
    const h = grid(f);
    check(`${f}: dates are YYYY-MM-DD`, h.slice(1).every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r[1])));
  }

  const types = parseCsv(read('02_employment_types.csv')).slice(1);
  const typeNames = new Set(types.map((r) => r[0]));
  const restr = types.flatMap((r) => (r[3] || '').split(',').map((s) => s.trim()).filter(Boolean));
  check('employment types: every restriction names a type in the same file',
    restr.every((x) => typeNames.has(x)), [...new Set(restr.filter((x) => !typeNames.has(x)))].join(','));

  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} CHECK(S) FAILED.`}`);
  await db.destroy();
  if (failures) process.exit(1);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
