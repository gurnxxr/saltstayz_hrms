/**
 * Proposes a work week for every employee, for a human to review before anything is written.
 *
 * Nobody's weekly off is recorded anywhere today, and the roster it could once have been derived
 * from was dropped in migration 006 — so there is no source of truth to read, only the shape of
 * the organisation to infer from. That makes guessing dangerous: a wrong pattern silently changes
 * the divisor every deduction is measured against.
 *
 * So this REPORTS by default and writes nothing. It proposes from department and location, prints
 * what it cannot know, and produces a CSV to correct. Only `--apply --in <file>` writes, and only
 * rows the reviewer marked APPROVED.
 *
 *   npm run patterns:report --workspace=server
 *   npm run patterns:report --workspace=server -- --apply --in server/data/work-week-proposal-<stamp>.csv
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import db from '../config/database';
import { buildCsv, parseCsv } from '../utils/csv';
import {
  cloneTemplateWithWorkWeek, getDefaultTemplateId, setEmployeeTemplate,
} from '../services/leaveTemplate.service';

/** The patterns on offer. Names are what HR will see on the template screen. */
const PATTERNS = {
  corporate: { name: 'Corporate (Mon–Fri)', rules: [{ day: 0, weeks: null }, { day: 6, weeks: null }] },
  corporate_alt_sat: {
    name: 'Corporate — Sunday + 2nd & 4th Saturday',
    rules: [{ day: 0, weeks: null }, { day: 6, weeks: [2, 4] }],
  },
  hotel_ops: { name: 'Hotel Operations (Sunday off)', rules: [{ day: 0, weeks: null }] },
} as const;
type PatternKey = keyof typeof PATTERNS;

/**
 * Departments the owner has marked as "2nd & 4th Saturday off". Empty by default, on purpose —
 * marking one is a one-line change that shows up in a diff and can be argued with.
 */
const ALT_SATURDAY_DEPARTMENTS: string[] = [];

/** Hotel operations: on the floor, six days, Sunday off. */
const OPERATIONS_DEPARTMENTS = ['food & beverage', 'front desk', 'housekeeping', 'security', 'cooking'];

/** Head office. Both spellings appear in the data. */
const CORPORATE_DEPARTMENTS = ['centre', 'center', 'service'];
const CORPORATE_BRANCHES = ['corporate office'];

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();

interface Proposal {
  employee_code: string;
  employee_name: string;
  department: string;
  property: string;
  proposed: PatternKey | null;
  reason: string;
  flag: string;
}

function propose(emp: any, knownProperties: Set<string>): Proposal {
  const dept = norm(emp.dept_name);
  const branch = norm(emp.branch_name);
  const base = {
    employee_code: emp.employee_code ?? '',
    employee_name: `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim(),
    department: emp.dept_name ?? '',
    property: emp.branch_name ?? '',
    // A branch that matches no property is a separate defect, reported alongside rather than
    // folded in: it costs them state holidays and their Professional Tax / LWF / minimum-wage
    // rates, none of which a work week fixes.
    flag: branch && !knownProperties.has(branch) ? 'property not recognised' : '',
  };

  if (!dept) {
    return { ...base, proposed: null, reason: 'NEEDS A DECISION — no department recorded' };
  }
  if (CORPORATE_BRANCHES.includes(branch) || CORPORATE_DEPARTMENTS.includes(dept)) {
    return { ...base, proposed: 'corporate', reason: 'head office' };
  }
  if (ALT_SATURDAY_DEPARTMENTS.map(norm).includes(dept)) {
    return { ...base, proposed: 'corporate_alt_sat', reason: 'marked as alternate-Saturday' };
  }
  if (OPERATIONS_DEPARTMENTS.includes(dept)) {
    return { ...base, proposed: 'hotel_ops', reason: 'hotel operations' };
  }
  if (dept === 'management') {
    return {
      ...base, proposed: null,
      reason: 'NEEDS A DECISION — Management sits at properties, not head office. Six-day or Mon–Fri?',
    };
  }
  return { ...base, proposed: null, reason: `NEEDS A DECISION — department "${emp.dept_name}" is not mapped` };
}

async function report() {
  const employees = await db('employees').where('is_active', true)
    .select('employee_code', 'first_name', 'last_name', 'dept_name', 'branch_name')
    .orderBy(['dept_name', 'employee_code']);
  const properties = await db('properties').pluck('name');
  const known = new Set(properties.map(norm));

  const proposals = employees.map((e: any) => propose(e, known));
  const decided = proposals.filter((p) => p.proposed);
  const undecided = proposals.filter((p) => !p.proposed);

  console.log(`\n${employees.length} active employee(s)\n`);
  console.log('PROPOSED');
  for (const key of Object.keys(PATTERNS) as PatternKey[]) {
    const group = decided.filter((p) => p.proposed === key);
    if (!group.length) continue;
    console.log(`\n  ${PATTERNS[key].name} — ${group.length} employee(s)`);
    const byDept = new Map<string, number>();
    for (const p of group) byDept.set(p.department || '(none)', (byDept.get(p.department || '(none)') ?? 0) + 1);
    for (const [dept, n] of [...byDept.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`      ${String(n).padStart(4)}  ${dept}`);
    }
  }

  if (undecided.length) {
    console.log(`\nNEEDS A DECISION — ${undecided.length} employee(s). No pattern proposed; --apply skips them.`);
    const byReason = new Map<string, Proposal[]>();
    for (const p of undecided) {
      if (!byReason.has(p.reason)) byReason.set(p.reason, []);
      byReason.get(p.reason)!.push(p);
    }
    for (const [reason, group] of byReason) {
      console.log(`\n  ${reason}  (${group.length})`);
      for (const p of group.slice(0, 10)) {
        console.log(`      ${p.employee_code.padEnd(10)} ${p.employee_name.padEnd(26)} ${p.property}`);
      }
      if (group.length > 10) console.log(`      …and ${group.length - 10} more`);
    }
  }

  const flagged = proposals.filter((p) => p.flag);
  if (flagged.length) {
    const branches = [...new Set(flagged.map((p) => p.property))];
    console.log(`\nSEPARATE DEFECT — ${flagged.length} employee(s) are at a location that is not a`);
    console.log(`configured property (${branches.join(', ')}). They receive NATIONAL HOLIDAYS ONLY, and`);
    console.log('no state is resolved for their Professional Tax, Labour Welfare Fund or minimum wage.');
    console.log('A work week does not fix that — it needs a property record or a corrected location.');
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.join(process.cwd(), 'data');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `work-week-proposal-${stamp}.csv`);
  fs.writeFileSync(file, buildCsv(
    ['employee_code', 'employee_name', 'department', 'property', 'proposed_work_week', 'reason', 'flag', 'decision'],
    proposals.map((p) => [
      p.employee_code, p.employee_name, p.department, p.property,
      p.proposed ? PATTERNS[p.proposed].name : '', p.reason, p.flag,
      p.proposed ? 'APPROVED' : '',
    ]),
  ), 'utf8');

  console.log(`\nReview file: ${file}`);
  console.log('Edit `proposed_work_week` and `decision` as needed, then:');
  console.log(`  npm run patterns:report --workspace=server -- --apply --in "${file}"`);
  console.log('\nOnly rows whose decision is APPROVED are written. Contains employee names —');
  console.log('server/data/ is gitignored. Do not commit or share.\n');
}

async function apply(inFile: string) {
  if (!fs.existsSync(inFile)) throw new Error(`No such file: ${inFile}`);
  const rows = parseCsv(fs.readFileSync(inFile, 'utf8'));
  if (!rows.length) throw new Error('The review file is empty.');

  const header = rows[0].map((h) => norm(h));
  const col = (n: string) => header.indexOf(n);
  const iCode = col('employee_code'); const iWeek = col('proposed_work_week'); const iDec = col('decision');
  if (iCode === -1 || iWeek === -1 || iDec === -1) {
    throw new Error('The file needs employee_code, proposed_work_week and decision columns.');
  }

  const byName = new Map<string, PatternKey>();
  for (const key of Object.keys(PATTERNS) as PatternKey[]) byName.set(norm(PATTERNS[key].name), key);

  const defaultId = await getDefaultTemplateId();
  if (defaultId == null) throw new Error('There is no Default leave template to copy the leave plan from.');

  // Only the templates the file actually asks for. Each one is the Default plan verbatim, with a
  // different work week — so moving somebody changes their days off and nothing else.
  const templateIds = new Map<PatternKey, number>();
  const ensure = async (key: PatternKey) => {
    if (!templateIds.has(key)) {
      const t = await cloneTemplateWithWorkWeek(defaultId, PATTERNS[key].name, PATTERNS[key].rules as any);
      console.log(`  ${t.created ? 'created' : 'reusing'} template "${t.name}"`);
      templateIds.set(key, t.id);
    }
    return templateIds.get(key)!;
  };

  let applied = 0; const skipped: string[] = [];
  for (const row of rows.slice(1)) {
    const code = String(row[iCode] ?? '').trim();
    if (!code) continue;
    if (norm(row[iDec]) !== 'approved') { skipped.push(`${code}: not approved`); continue; }
    const key = byName.get(norm(row[iWeek]));
    if (!key) { skipped.push(`${code}: work week "${row[iWeek]}" is not one of the known patterns`); continue; }
    const emp = await db('employees').where('employee_code', code).select('id').first();
    if (!emp) { skipped.push(`${code}: no such employee`); continue; }
    await setEmployeeTemplate(emp.id, await ensure(key));
    applied += 1;
  }

  console.log(`\nApplied to ${applied} employee(s).`);
  if (skipped.length) {
    console.log(`Skipped ${skipped.length}:`);
    for (const s of skipped.slice(0, 20)) console.log(`  ${s}`);
    if (skipped.length > 20) console.log(`  …and ${skipped.length - 20} more`);
  }
  console.log('');
}

async function main() {
  const wantsApply = process.argv.includes('--apply');
  const inIdx = process.argv.indexOf('--in');
  const inFile = inIdx !== -1 ? process.argv[inIdx + 1] : null;

  if (wantsApply && !inFile) {
    console.error('\n--apply needs --in <reviewed file>.\n');
    console.error('Applying the machine\'s own unreviewed proposal is the exact thing this is');
    console.error('built to prevent: nobody\'s weekly off is recorded anywhere, so every one of');
    console.error('these is an inference, and a wrong one changes what people are paid.\n');
    process.exit(1);
  }

  if (wantsApply) await apply(path.resolve(inFile!));
  else await report();
  await db.destroy();
}

main().catch(async (e) => { console.error(`\n${e.message}\n`); await db.destroy(); process.exit(1); });
