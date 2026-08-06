/**
 * Make sure statutory rates exist, so payroll deducts something.
 *
 * `statutory_settings` and `state_minimum_wages` are created by the baseline migration but
 * populated by NO seed. The live values arrived through the one-time SQLite copy, so any
 * environment built from migrations + seeds — a fresh staging box, a new laptop, a restore — has
 * both tables empty. Nothing errors: EPF, ESI, LWF and Professional Tax all quietly compute as
 * zero, and the minimum-wage warning never fires for anyone. A payslip that looks plausible and
 * deducts nothing is worse than one that fails.
 *
 *   npm run statutory:ensure --workspace=server            # report what is missing
 *   npm run statutory:ensure --workspace=server -- --apply # insert only what is missing
 *
 * IDEMPOTENT and additive. It never edits or deletes an existing row — if somebody has tuned a rate
 * in the admin screen, that is the intended value and this must not stamp on it. Rates below match
 * what the archived migrations 044/050/059 established.
 */
import db from '../config/database';

/** States the business operates in. Labour Welfare Fund genuinely differs across these. */
const LWF: Record<string, Record<string, unknown>> = {
  // Percentage of wage, capped, every month.
  Haryana: { mode: 'percent', employeePct: 0.2, employeeMaxAmount: 35, employerMultiplier: 2, deductionMonths: [] },
  // Fixed, and only twice a year — which is why a June payslip differs from May and July.
  Delhi: { mode: 'fixed', employeeAmount: 0.75, employerAmount: 2.25, employerMultiplier: 3, deductionMonths: [6, 12] },
  // Fixed, every month.
  Chandigarh: { mode: 'fixed', employeeAmount: 5, employerAmount: 20, employerMultiplier: 4, deductionMonths: [] },
};
/** These have a row that is deliberately OFF — there is no LWF act to deduct under. */
const LWF_DISABLED = ['Uttar Pradesh', 'Uttarakhand'];

const EPF = {
  employeeRatePct: 12, employerRatePct: 12, pfWageCeiling: 15000,
  lopMode: 'prorate_restricted', includeEmployerInCtc: true,
};
const ESI = {
  employeeRatePct: 0.75, employerRatePct: 3.25, wageCeiling: 21000, includeEmployerInCtc: false,
};

/** A floor per state so the below-minimum-wage warning has something to compare against. */
const MIN_WAGES: Array<[string, number]> = [
  ['Haryana', 11500], ['Delhi', 12000], ['Chandigarh', 11000],
  ['Uttar Pradesh', 9500], ['Uttarakhand', 9200], ['Karnataka', 10500],
];

interface Planned { table: string; what: string; row: Record<string, unknown>; }

async function plan(): Promise<Planned[]> {
  const todo: Planned[] = [];
  const has = async (component: string, state: string | null) => {
    const q = db('statutory_settings').where('component', component);
    const row = state === null ? await q.whereNull('state').first() : await q.where('state', state).first();
    return Boolean(row);
  };

  // `statutory_settings.enabled` is an INTEGER column, not a boolean — one of the handful the
  // house rules call out by name. Postgres rejects `true` here with "invalid input syntax for
  // type integer", so 1/0 is correct rather than a SQLite leftover.
  if (!(await has('epf', null))) {
    todo.push({ table: 'statutory_settings', what: 'EPF (all states)', row: { component: 'epf', state: null, enabled: 1, config: JSON.stringify(EPF) } });
  }
  if (!(await has('esi', null))) {
    todo.push({ table: 'statutory_settings', what: 'ESI (all states)', row: { component: 'esi', state: null, enabled: 1, config: JSON.stringify(ESI) } });
  }
  for (const [state, config] of Object.entries(LWF)) {
    if (!(await has('lwf', state))) {
      todo.push({ table: 'statutory_settings', what: `LWF — ${state}`, row: { component: 'lwf', state, enabled: 1, config: JSON.stringify(config) } });
    }
  }
  for (const state of LWF_DISABLED) {
    if (!(await has('lwf', state))) {
      todo.push({ table: 'statutory_settings', what: `LWF — ${state} (switched off — no act)`, row: { component: 'lwf', state, enabled: 0, config: JSON.stringify({ mode: 'fixed', employeeAmount: 0, employerAmount: 0, deductionMonths: [] }) } });
    }
  }
  for (const [state, wage] of MIN_WAGES) {
    const row = await db('state_minimum_wages').where({ state }).first();
    if (!row) {
      todo.push({ table: 'state_minimum_wages', what: `minimum wage — ${state} ₹${wage}`, row: { state, monthly_wage: wage, effective_from: '2026-04-01' } });
    }
  }
  return todo;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const todo = await plan();

  const settings = await db('statutory_settings').count('* as c').first();
  const wages = await db('state_minimum_wages').count('* as c').first();
  console.log(`statutory_settings: ${(settings as any).c} rows · state_minimum_wages: ${(wages as any).c} rows\n`);

  if (!todo.length) {
    console.log('Nothing missing — every rate this script knows about is already configured.');
    await db.destroy();
    return;
  }

  console.log(`${todo.length} missing:`);
  for (const t of todo) console.log(`  ${t.table.padEnd(22)} ${t.what}`);

  if (!apply) {
    console.log('\nRe-run with --apply to insert these. Existing rows are never modified.');
    await db.destroy();
    return;
  }

  for (const t of todo) await db(t.table).insert(t.row);
  console.log(`\nInserted ${todo.length} rows. Existing rows untouched.`);
  console.log('Re-run payroll for a month to see the deductions appear.');
  await db.destroy();
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
