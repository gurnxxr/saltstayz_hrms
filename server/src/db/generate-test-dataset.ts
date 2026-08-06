/**
 * Generate a complete, cross-referenced test dataset — one file per CSV surface in the app.
 *
 * Testing one upload in isolation proves very little. Payroll is only interesting if the employee
 * has a property, the property has a state, the state has statutory rates, the month has holidays
 * and the attendance has variety. So every file here references the others: an employee in the
 * attendance sheet exists in the employee sheet, works at a property in the property sheet, and
 * sits in a department that scopes their holidays.
 *
 * ALL OF IT IS INVENTED. The names, the ID numbers and the attendance are fabricated to look
 * plausible. Nothing here describes a real person.
 *
 *   npm run testdata --workspace=server
 *   npm run testdata --workspace=server -- --employees=400 --out=../test-data
 *
 * Deterministic: same inputs, byte-identical files, so two people comparing results are looking at
 * the same data. Master data (job titles, departments, shifts) is READ FROM THE DATABASE this is
 * pointed at, and only values that actually exist are emitted — `Job Title` is the one column that
 * hard-rejects a row, and an unmatched `Department` imports with a warning but then receives no
 * department-scoped holiday, silently changing that person's payable days.
 */
import fs from 'fs';
import path from 'path';
import db from '../config/database';

// ─── deterministic randomness ───

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: () => number, xs: T[]): T => xs[Math.floor(r() * xs.length)];
const between = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

// ─── name pools (no commas — four of the parsers split on them naively) ───

const FIRST = ['Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Reyansh', 'Krishna', 'Ishaan', 'Rohan', 'Kabir',
  'Ananya', 'Diya', 'Aadhya', 'Saanvi', 'Myra', 'Anika', 'Riya', 'Neha', 'Priya', 'Kavya',
  'Rahul', 'Amit', 'Suresh', 'Manish', 'Deepak', 'Vikram', 'Sanjay', 'Rajesh', 'Nikhil', 'Karan',
  'Pooja', 'Sneha', 'Meera', 'Divya', 'Shreya', 'Nisha', 'Ritu', 'Swati', 'Payal', 'Anjali'];
const LAST = ['Sharma', 'Verma', 'Gupta', 'Singh', 'Kumar', 'Mehta', 'Joshi', 'Patel', 'Reddy', 'Nair',
  'Iyer', 'Chopra', 'Kapoor', 'Malhotra', 'Bansal', 'Agarwal', 'Sinha', 'Rao', 'Menon', 'Pillai'];

/**
 * Ten properties across six states, chosen so their deductions genuinely differ.
 *
 * Labour Welfare Fund is configured per state and behaves differently in each (see
 * migration 059): Haryana is a capped percentage every month, Delhi is a fixed amount in JUNE AND
 * DECEMBER ONLY, Chandigarh is a smaller fixed amount every month, UP and Uttarakhand have a row
 * that is deliberately switched off, and a state with no row at all — Karnataka here — is zero for
 * an entirely different reason. Generating May, June and July is what makes the Delhi case visible:
 * the same person pays in June and nothing either side of it.
 */
const PROPERTIES = [
  { name: 'SaltStayz Cyber Hub', hotel: 'HT-301', city: 'Gurugram', state: 'Haryana', address: 'DLF Cyber City Phase 2', category: 'Business' },
  { name: 'SaltStayz Sohna Road', hotel: 'HT-302', city: 'Gurugram', state: 'Haryana', address: 'Sector 48 Sohna Road', category: 'Business' },
  { name: 'SaltStayz Aerocity', hotel: 'HT-303', city: 'New Delhi', state: 'Delhi', address: 'Hospitality District Aerocity', category: 'Business' },
  { name: 'SaltStayz Saket', hotel: 'HT-304', city: 'New Delhi', state: 'Delhi', address: 'District Centre Saket', category: 'Boutique' },
  { name: 'SaltStayz Sector 17', hotel: 'HT-305', city: 'Chandigarh', state: 'Chandigarh', address: 'Sector 17 City Centre', category: 'Business' },
  { name: 'SaltStayz Sector 62', hotel: 'HT-306', city: 'Noida', state: 'Uttar Pradesh', address: 'Sector 62 Noida', category: 'Business' },
  { name: 'SaltStayz Agra Fort', hotel: 'HT-307', city: 'Agra', state: 'Uttar Pradesh', address: 'Fatehabad Road', category: 'Heritage' },
  { name: 'SaltStayz Rishikesh', hotel: 'HT-308', city: 'Rishikesh', state: 'Uttarakhand', address: 'Tapovan Laxman Jhula', category: 'Resort' },
  { name: 'SaltStayz Indiranagar', hotel: 'HT-309', city: 'Bengaluru', state: 'Karnataka', address: '100 Feet Road Indiranagar', category: 'Business' },
  { name: 'SaltStayz Whitefield', hotel: 'HT-310', city: 'Bengaluru', state: 'Karnataka', address: 'ITPL Main Road Whitefield', category: 'Business' },
];

const MONTHS = ['2026-05', '2026-06', '2026-07'];
/** Attendance codes the marked-grid importer understands, weighted to look like a real month. */
const CODE_WEIGHTS: Array<[string, number]> = [
  ['P', 62], ['A', 8], ['HD', 7], ['SP', 8], ['MP', 9], ['NP', 4], ['HHD', 2],
];

// ─── small helpers ───

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const daysIn = (y: number, m: number) => new Date(y, m, 0).getDate();
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const ddmmyyyy = (y: number, m: number, d: number) => `${pad(d)}-${pad(m)}-${y}`;

/** Quote only when needed. Four of the six parsers split on bare commas, so we avoid them entirely. */
function cell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  if (/[\n\r]/.test(s)) throw new Error(`newline in cell: ${s}`);
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const csv = (header: string[], rows: unknown[][]) =>
  [header, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n';

function panFor(n: number): string {
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const l = (i: number) => L[i % 26];
  return `${l(n)}${l(n + 7)}${l(n + 13)}P${l(n + 3)}${pad((n * 37) % 10000, 4)}${l(n + 5)}`;
}

interface Person {
  code: string; first: string; last: string; email: string; phone: string;
  dob: string; doj: string; lwd: string; father: string; aadhaar: string; pan: string;
  dept: string; branch: string; title: string; manager: string; status: string; ctc: number;
  note: string; // why this row exists, for MANIFEST.md
}

/**
 * The boundary cases, defined explicitly rather than left to chance.
 *
 * Each targets a specific branch in the payroll engine. `ctc` here is the monthly CTC that lands on
 * the employee row; whether it becomes the ESI/EPF base depends on the salary structure assigned
 * later, so these are chosen to sit either side of the thresholds once a typical structure is
 * applied — the MANIFEST spells out what to look for.
 */
const EDGE_CASES: Array<Partial<Person> & { note: string }> = [
  { ctc: 20999, note: 'ESI: just under the ₹21,000 ceiling — should be covered' },
  { ctc: 21000, note: 'ESI: exactly ₹21,000 — the boundary is INCLUSIVE, so still covered' },
  { ctc: 21001, note: 'ESI: ₹1 over — should NOT be covered, no ESI line' },
  { ctc: 14999, note: 'EPF: under ₹15,000 — the "if below" components join the PF base' },
  { ctc: 15000, note: 'EPF: exactly ₹15,000 — inclusive, so still "below"' },
  { ctc: 15001, note: 'EPF: just over — "if below" components drop out of the PF base' },
  { doj: '2026-05-16', note: 'Joined mid-May — May pay prorated, June and July full' },
  { doj: '2026-06-12', note: 'Joined mid-June — no May payslip at all' },
  { doj: '2026-07-21', note: 'Joined late July — only a few payable days in July' },
  // These two import as ACTIVE on purpose. The employee CSV has no last-working-day column
  // (`HEADER_ALIASES` in employee.service.ts stops at Status → is_active), so marking them
  // Inactive here would flip the flag with no leaving date attached — and payroll then produces
  // NOTHING for them in any month, not even the months they worked. Record the leaving date in
  // Employee Lifecycle → Offboarding instead; SETUP.md says so.
  { lwd: '2026-06-15', note: 'Left mid-June — set the last working day in Offboarding, then June prorates and July produces no payslip' },
  { lwd: '2026-07-10', note: 'Left mid-July — set the last working day in Offboarding, then July prorates' },
  { ctc: 9500, note: 'Low earner — the minimum-wage flag should fire once state_minimum_wages has rows' },
  { ctc: 185000, note: 'High earner — above every ceiling; no ESI, PF capped at ₹15,000 of wage' },
  { branch: 'SaltStayz Nowhere', note: 'Branch matches NO property — exercises the Haryana fallback and the state_unresolved flag' },
];

async function master() {
  const titles = (await db('job_titles').select('title').orderBy('title')).map((r: any) => String(r.title));
  const depts = (await db('departments').select('name').orderBy('name')).map((r: any) => String(r.name));
  const shifts = (await db('shift_types').where('is_active', true).select('name').orderBy('name'))
    .map((r: any) => String(r.name));
  if (!titles.length) throw new Error('No job_titles in this database — an employee row with an unknown Job Title is REJECTED, so there is nothing safe to generate. Create job titles first.');
  if (!depts.length) throw new Error('No departments in this database.');
  return { titles, depts, shifts };
}

function buildPeople(n: number, m: { titles: string[]; depts: string[] }): Person[] {
  const r = rng(20260804);
  const people: Person[] = [];
  const emails = new Set<string>();

  // Managers first — `reporting_manager_code` is resolved row-by-row against the DB, so a manager
  // defined LATER in the same file does not resolve, and the failure is silent.
  const managerCount = Math.max(PROPERTIES.length, Math.round(n * 0.08));

  for (let i = 0; i < n; i += 1) {
    const isManager = i < managerCount;
    const prop = PROPERTIES[i % PROPERTIES.length];
    const first = pick(r, FIRST);
    const last = pick(r, LAST);
    const code = `TD-${pad(i + 1, 4)}`;

    let email = `${first}.${last}${i + 1}`.toLowerCase() + '@saltstayz.test';
    while (emails.has(email)) email = `${first}.${last}${i + 1}x`.toLowerCase() + '@saltstayz.test';
    emails.add(email);

    const base: Person = {
      code, first, last, email,
      phone: `98${pad(between(r, 10000000, 99999999), 8)}`,
      dob: iso(between(r, 1975, 2004), between(r, 1, 12), between(r, 1, 28)),
      doj: iso(between(r, 2019, 2025), between(r, 1, 12), between(r, 1, 28)),
      lwd: '',
      father: `${pick(r, FIRST)} ${last}`,
      aadhaar: String(between(r, 100000000000, 999999999999)),
      pan: panFor(i + 1),
      dept: pick(r, m.depts),
      branch: prop.name,
      title: pick(r, m.titles),
      manager: isManager ? '' : `TD-${pad((i % managerCount) + 1, 4)}`,
      status: 'Active',
      ctc: isManager ? between(r, 45000, 120000) : between(r, 12000, 42000),
      note: '',
    };
    people.push(base);
  }

  // Stamp the deliberate cases onto the tail, so they are easy to find and never collide with the
  // managers at the head of the file.
  EDGE_CASES.forEach((edge, k) => {
    const target = people[people.length - 1 - k];
    Object.assign(target, edge);
    target.note = edge.note;
  });

  return people;
}

// ─── per-surface emitters ───

const employeesCsv = (p: Person[]) => csv(
  ['Employee Code', 'First Name', 'Last Name', 'Email', 'Phone', 'Date of Birth', 'Date of Joining',
    'Father Name', 'Aadhaar Number', 'PAN Number', 'Department', 'Branch Name', 'Job Title',
    'Reporting Manager Code', 'Status', 'Monthly CTC'],
  p.map((e) => [e.code, e.first, e.last, e.email, e.phone, e.dob, e.doj, e.father, e.aadhaar, e.pan,
    e.dept, e.branch, e.title, e.manager, e.status, e.ctc]),
);

const propertiesCsv = () => csv(
  ['Name', 'Hotel ID', 'City', 'State', 'Address', 'Category'],
  PROPERTIES.map((x) => [x.name, x.hotel, x.city, x.state, x.address, x.category]),
);

const shiftsCsv = (p: Person[], shifts: string[]) => {
  const r = rng(77);
  return csv(['Employee Code', 'Shift', 'Effective From'],
    p.filter((e) => e.status === 'Active')
      .map((e) => [e.code, pick(r, shifts), '2026-05-01']));   // must be YYYY-MM-DD, strictly
};

/** One month of marks per employee, with each month given a different character. */
function gridCsv(people: Person[], month: string) {
  const [y, mo] = month.split('-').map(Number);
  const n = daysIn(y, mo);
  const order = ['P', 'A', 'HD', 'SP', 'MP', 'NP', 'HHD'];
  const rows = people.map((e, idx) => {
    const r = rng(y * 100000 + mo * 1000 + idx * 7 + 11);
    const cells: string[] = [];
    for (let d = 0; d < n; d += 1) {
      const total = CODE_WEIGHTS.reduce((s, [, w]) => s + w, 0);
      let x = r() * total;
      let code = 'P';
      for (const [c, w] of CODE_WEIGHTS) { x -= w; if (x <= 0) { code = c; break; } }
      cells.push(code);
    }
    if (new Set(cells.filter((c) => c !== 'P')).size < 2) {
      cells[Math.floor(r() * n)] = 'HD';
      cells[Math.floor(r() * n)] = 'MP';
    }
    const counts = order.map((c) => cells.filter((x) => x === c).length);
    if (counts.reduce((a, b) => a + b, 0) !== n) throw new Error(`row ${e.code}: counts do not sum to ${n}`);
    return [e.code, `${e.first} ${e.last}`, ...counts, ...cells];
  });
  return csv(
    ['Emp Code', 'Empname', 'Present', 'Absent', 'Half Day', 'Short Present', 'Missed Punch', 'No Punch', 'HHD',
      ...Array.from({ length: n }, (_, i) => ddmmyyyy(y, mo, i + 1))],
    rows,
  );
}

/**
 * A week of raw punches, for the OTHER attendance importer.
 *
 * This one derives the status from the punch times rather than reading a code, so the rows are
 * shaped to exercise that: a full day, a short day, a single punch (miss punch), no punches at all
 * (absent), and an explicit HHD which overrides the punches entirely.
 */
function biometricCsv(people: Person[]) {
  const r = rng(4242);
  const rows: unknown[][] = [];
  const sample = people.filter((e) => e.status === 'Active').slice(0, 40);
  for (let d = 20; d <= 24; d += 1) {                       // Mon 20 – Fri 24 July 2026
    for (const e of sample) {
      const kind = r();
      let inT = '09:00'; let outT = '18:00'; let status = '';
      if (kind < 0.10) { inT = ''; outT = ''; status = ''; }             // absent
      else if (kind < 0.20) { outT = ''; }                               // one punch → miss punch
      else if (kind < 0.32) { outT = '13:30'; }                          // short day
      else if (kind < 0.38) { inT = ''; outT = ''; status = 'HHD'; }     // explicit override
      else if (kind < 0.50) { inT = '09:15'; outT = '19:40'; }           // long day (overtime, if the shift allows it)
      rows.push([e.code, ddmmyyyy(2026, 7, d), inT, outT, e.branch, status]);
    }
  }
  return csv(['Emp Code', 'Access Date (DD-MM-YY)', 'First_In_time (HH:MM)', 'Last_Out_time (HH:MM)', 'Location', 'Status'], rows);
}

const assetsCsv = (p: Person[]) => {
  const r = rng(909);
  const items = ['Laptop', 'Access Keycard', 'Uniform Set', 'Mobile Handset', 'Locker Key', 'Two-Way Radio'];
  const rows = p.filter((e) => e.status === 'Active').slice(0, 60).map((e, i) => {
    const item = pick(r, items);
    return [e.code, `${e.first} ${e.last}`, e.branch, item,
      `${item.slice(0, 2).toUpperCase()}-${pad(1000 + i, 4)}`, '2026-05-04',
      i % 17 === 0 ? 'returned' : 'assigned'];
  });
  return csv(['EmpCode', 'Employee Name', 'Property', 'Item', 'Serial No', 'Assigned Date', 'Status'], rows);
};

const candidatesCsv = () => {
  const r = rng(555);
  const rows = Array.from({ length: 25 }, (_, i) => {
    const f = pick(r, FIRST); const l = pick(r, LAST);
    // This parser handles quoted commas, so an address with one is a deliberate check.
    return [`${f} ${l}`, `97${pad(between(r, 10000000, 99999999), 8)}`,
      `${f}.${l}${i}`.toLowerCase() + '@example.test',
      `${between(r, 1, 200)} Main Road, ${pick(r, ['Gurugram', 'New Delhi', 'Noida', 'Bengaluru'])}`,
      `https://example.test/cv/${f}-${l}-${i}`.toLowerCase()];
  });
  return csv(['Name', 'Phone Number', 'Email Address', 'Address', 'Resume Link'], rows);
};

const employmentTypesCsv = () => csv(
  ['Employment Type', 'Is Confirmed', 'Prefix', 'Restriction for Employment Type', 'Probation Period (In Months)', 'Notice Period (In Days)'],
  [
    ['Permanent', 'Y', 'PERM', '', '', '60'],
    ['Probationer', 'N', 'PROB', 'Permanent', '6', '15'],
    ['Contract', 'N', 'CON', 'Permanent', '', '30'],
    ['Trainee', 'N', 'TRN', 'Permanent, Contract', '3', '7'],
    ['Consultant', 'N', 'CNS', '', '', '30'],
    ['Intern', 'N', 'INT', 'Permanent, Contract, Consultant', '', '7'],
  ],
);

/** Holidays split by audience — the scope itself is chosen in the upload dialog, not in the file. */
const HOLIDAY_FILES: Array<{ file: string; scope: string; rows: string[][] }> = [
  {
    file: '06a_holidays_national.csv',
    scope: 'National · every department · every property',
    rows: [['Independence Day', '2026-08-15'], ['Gandhi Jayanti', '2026-10-02'], ['Republic Day', '2027-01-26'],
      ['Holi', '2026-05-04'], ['Eid al-Adha', '2026-05-27'], ['Bakrid Holiday', '2026-06-26'],
      ['Guru Purnima', '2026-07-29']],
  },
  {
    file: '06b_holidays_delhi.csv',
    scope: 'State = Delhi · every department · Delhi properties only',
    rows: [['Delhi Statehood Day', '2026-06-11'], ['Chhath Puja', '2026-07-16']],
  },
  {
    file: '06c_holidays_karnataka.csv',
    scope: 'State = Karnataka · every department · Karnataka properties only',
    rows: [['Karnataka Rajyotsava', '2026-05-19'], ['Ugadi Observance', '2026-06-04'], ['Varamahalakshmi', '2026-07-24']],
  },
];

// ─── main ───

async function main() {
  const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
  const count = Number(arg('employees') || 150);
  const outDir = path.resolve(process.cwd(), arg('out') || path.join(__dirname, '../../../test-data'));

  const m = await master();
  const people = buildPeople(count, m);
  fs.mkdirSync(outDir, { recursive: true });

  const write = (name: string, body: string) => {
    fs.writeFileSync(path.join(outDir, name), body, 'utf-8');
    console.log(`  ${name.padEnd(34)} ${body.trim().split('\n').length - 1} rows`);
  };

  console.log(`Writing to ${outDir}\n`);
  write('01_properties.csv', propertiesCsv());
  write('02_employment_types.csv', employmentTypesCsv());
  write('03_employees.csv', employeesCsv(people));
  write('04_shift_assignments.csv', shiftsCsv(people, m.shifts.length ? m.shifts : ['General']));
  for (const h of HOLIDAY_FILES) write(h.file, csv(['Holiday Name', 'Date'], h.rows));
  write('07_attendance_biometric_week.csv', biometricCsv(people));
  MONTHS.forEach((mo, i) => write(`${pad(8 + i)}_attendance_grid_${mo}.csv`, gridCsv(people, mo)));
  write('11_asset_assignments.csv', assetsCsv(people));
  write('12_recruitment_candidates.csv', candidatesCsv());

  fs.writeFileSync(path.join(outDir, 'SETUP.md'), setupDoc(m), 'utf-8');
  fs.writeFileSync(path.join(outDir, 'MANIFEST.md'), manifestDoc(people), 'utf-8');
  console.log(`  SETUP.md / MANIFEST.md`);

  const byState = PROPERTIES.reduce((acc: Record<string, number>, p) => {
    acc[p.state] = (acc[p.state] || 0) + 1; return acc;
  }, {});
  console.log(`\n${people.length} employees · ${PROPERTIES.length} properties · ${Object.keys(byState).length} states`);
  console.log(`states: ${Object.entries(byState).map(([s, n]) => `${s} (${n})`).join(', ')}`);
  console.log(`months: ${MONTHS.join(', ')}`);
  console.log(`\nRead SETUP.md before uploading — the ORDER matters, and two steps must be done in the UI first.`);
  await db.destroy();
}

function setupDoc(m: { titles: string[]; depts: string[]; shifts: string[] }): string {
  return `# Loading this dataset

Everything here is **invented**. Names, ID numbers and attendance are fabricated to look plausible;
nothing describes a real person. Employee codes are prefixed \`TD-\` so they never collide with real
staff and can be deleted in one query afterwards.

Regenerate any time — it is deterministic, so you get the same files back:

\`\`\`bash
npm run testdata --workspace=server
\`\`\`

## Do these in the UI first

These have **no CSV upload** and everything below depends on them.

| What | Why | Present in the database this was generated from |
|---|---|---|
| **Job titles** | An unknown Job Title is the one column that **rejects the row outright**. | ${m.titles.length}: ${m.titles.join(' · ')} |
| **Departments** | An unknown department imports with a warning, but that person then receives **no department-scoped holiday**, which quietly changes their payable days. | ${m.depts.length}: ${m.depts.join(' · ')} |
| **Shift types** | Needed before attendance — see the ordering note below. | ${m.shifts.length}: ${m.shifts.join(' · ') || '(none — create at least one)'} |
| **Pay grades + property budgets** | Only needed if you want the headcount/budget/band rejections to actually fire. Without them those checks silently pass. | — |
| **One vacancy** | The candidate upload asks which vacancy the applicants are for. | — |
| **The work week** | The default leave template ships with **Saturday *and* Sunday** off. On a 31-day month that throws away 10 of every employee's 31 marks as \`off_calendar\` and pays everyone a 21-day month. A hotel does not run a five-day week — set it to Sunday only in Leave → Control Panel → Templates, **before** any attendance goes in. | Default template: days 0 and 6 |

**Monthly CTC in the employee file is not the payroll base.** It lands on \`employees.monthly_ctc\`,
which is the manpower and budget figure. Payroll reads the **salary structure assignment**, and
where an employee has none it falls back to their designation template's default. So until each
person is assigned a structure at their own base, everyone in a designation is paid the same
amount and none of the ESI or EPF boundary rows in \`MANIFEST.md\` lands on its boundary.

**Statutory rates must exist or every deduction is zero.** \`statutory_settings\` is created by the
migrations but populated by no seed, so a freshly built environment has EPF, ESI and LWF all at
zero and the state-by-state variation in this dataset is invisible. Run once:

\`\`\`bash
npm run statutory:ensure --workspace=server
\`\`\`

## Then upload, in this order

| # | File | Where |
|---|---|---|
| 01 | \`01_properties.csv\` | Admin → Properties → Upload |
| 02 | \`02_employment_types.csv\` | Admin → Employment Types → Import |
| 03 | \`03_employees.csv\` | Employees → Bulk Upload |
| 04 | \`04_shift_assignments.csv\` | Shifts → Assignments → Bulk Upload |
| 06 | \`06a/06b/06c_holidays_*.csv\` | Admin → Holidays → Upload — **set the audience per file**, see below |
| 07 | \`07_attendance_biometric_week.csv\` | Admin → Attendance → daily upload |
| 08–10 | \`08/09/10_attendance_grid_*.csv\` | Admin → Attendance → marked grid, **month picker set to match the file** |
| 11 | \`11_asset_assignments.csv\` | Employee Lifecycle → Assets → Bulk Upload |
| 12 | \`12_recruitment_candidates.csv\` | Recruitment → pick the vacancy → Bulk Upload |

Holiday audience per file — the scope is chosen in the dialog, not in the CSV:

${HOLIDAY_FILES.map((h) => `- \`${h.file}\` → ${h.scope}`).join('\n')}

## Four ordering rules that change the data, not just pass/fail

1. **Shift assignments before attendance.** The daily importer reads the shift in force on each date
   to learn that shift's "absent below N hours" and "half day below N hours" thresholds. With no
   shift those are zero, so a short day **can never come out as a half day** — it silently records
   as present. Load attendance first and the half-day test rows are wrong.
2. **Holidays before the attendance grids.** The grid writes nothing for a mark landing on a holiday
   or weekly off, reporting it as \`off_calendar\`. Load holidays afterwards and it will have
   recorded days it should have ignored.
3. **Nothing locked.** A locked payroll run refuses shift assignments dated at or after its month,
   and makes the grid skip those days entirely.
4. **Leaving dates go in Offboarding, not in the CSV.** The employee uploader has no last-working-day
   column — only \`Status\`, which flips the active flag on its own. Mark somebody Inactive with no
   leaving date and payroll produces **nothing** for them in any month, including the months they
   actually worked. The two leavers below therefore import as Active; give them their last working
   days in Employee Lifecycle → Offboarding to make the mid-month-leaver cases behave.

## What to check after loading

- **Employees** — 150 rows, spread across 10 properties and 6 states.
- **Attendance** — the grid upload reports \`off_calendar\` for weekly offs and holidays. That is the
  work calendar winning over the sheet, and it is correct.
- **Payroll** — run May, June and July. Compare the same Delhi employee across all three: they
  should pay Labour Welfare Fund **in June only**. Compare a Karnataka employee: zero in every
  month, because Karnataka has no LWF row at all.
- **MANIFEST.md** lists every deliberately-placed edge case and what it should produce.

## Known limits

- **Gender never imports.** The employee uploader has no column for it, so everyone lands with no
  gender recorded and is excluded from any gender-restricted leave. Not fixed here.
- **No logins are created.** Bulk-imported staff cannot sign in — testing employee self-service
  needs logins made in the admin screen.
- **No commas inside any cell** in the properties, employees, holidays or biometric files. Those
  four parsers split on bare commas. The candidate file does handle quoted commas, and has one.
`;
}

function manifestDoc(people: Person[]): string {
  const edges = people.filter((p) => p.note);
  return `# What is deliberately in this data

Everything below was placed on purpose. If one of these does not behave as described, that is a
finding — either in the app or in this dataset.

## Boundary cases

| Employee | Set to | What should happen |
|---|---|---|
${edges.map((e) => `| \`${e.code}\` ${e.first} ${e.last} | ${e.lwd ? `left ${e.lwd}` : e.doj > '2026-01-01' ? `joined ${e.doj}` : e.branch === 'SaltStayz Nowhere' ? 'unknown property' : `₹${e.ctc}/month`} | ${e.note} |`).join('\n')}

## Statutory variation by state

The ten properties sit in six states so that identical people are paid differently:

| State | Properties | Labour Welfare Fund |
|---|---|---|
| Haryana | 2 | percentage of wage, capped at ₹35 — **every month** |
| Delhi | 2 | fixed — **June and December only**, so June differs from May and July |
| Chandigarh | 1 | fixed ₹5 employee / ₹20 employer — every month |
| Uttar Pradesh | 2 | a row exists but is switched off → zero |
| Uttarakhand | 1 | same → zero |
| Karnataka | 2 | **no row at all** → zero, for a different reason |

The clearest single check: take one Delhi employee and one Karnataka employee on similar pay, and
compare their May, June and July payslips. The Delhi one should differ in June. If all six states
produce identical deductions, \`statutory_settings\` is empty — see SETUP.md.

## Attendance shape

Three months, each generated with its own seed so they are not interchangeable. Roughly 62% present,
with the rest spread across absent, half day, short present, missed punch, no punch and
half-day-with-leave. Every employee has at least two different exception codes, so no row is a
featureless run of P.

The summary columns in each grid are recomputed from that row's own cells, so they always agree
with the day-by-day marks. The importer ignores them; a person reading the file does not.
`;
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
