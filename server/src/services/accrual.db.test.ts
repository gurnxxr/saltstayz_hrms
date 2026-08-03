import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import db from '../config/database';
import { runDailyAccrual, planAccruals, writeAccruals } from './accrual.service';
import { getEffectiveBalances, setCurrentPeriod } from './leave.service';

/**
 * The ledger against a real database: that crediting is idempotent, that the balance every screen
 * reads comes from it, and that a period rollover carries forward only what the limit allows.
 *
 * The pure arithmetic is covered in accrualEngine.test.ts and needs no database. What cannot be
 * tested there is that the job can be run again — it recomputes the WHOLE period every time rather
 * than tracking a cursor, and if that were not safe an employee would gain a month's leave every
 * night.
 *
 * There are TWO defences and they cover different things, which is worth being precise about
 * because it is easy to test only the weaker one. `planAccruals` filters out credits the ledger
 * already holds, and that alone makes sequential runs idempotent — dropping the unique index does
 * not break the run-three-times test below. The index is what covers OVERLAPPING runs, where two
 * writers each computed their plan from the same pre-run snapshot and neither can see the other's
 * rows. "a stale plan cannot be replayed" is the test that actually holds the index in place.
 *
 * SKIPS unless DATABASE_URL points at a throwaway database whose name contains `hrms_test` or
 * `hrms_qa` — same gate, and same reasons, as payableDays.db.test.ts.
 */
const TARGET = process.env.DATABASE_URL || '';
const ON_THROWAWAY = /hrms_(test|qa)/.test(TARGET);

/** 12 days a year = exactly 1 a month, so a count of credits reads as a count of days. */
const CASUAL_DAYS = 12;
/** 15 a year = 1.25 a month — the fraction the whole design turns on. */
const PRIV_DAYS = 15;

describe.skipIf(!ON_THROWAWAY)('leave accrual ledger', () => {
  let employeeId: number;
  let templateId: number;
  let casualId: number;
  let privId: number;
  let periodId: number;
  let nextPeriodId: number;
  let wasCurrentId: number | null = null;

  const ledger = () => db('leave_accruals').where('employee_id', employeeId);

  beforeAll(async () => {
    await db('employees').where('employee_code', 'ACR-001').del();
    await db('leave_types').where('name', 'like', 'ACR %').del();
    await db('leave_templates').where('name', 'like', 'ACR %').del();
    await db('leave_periods').where('name', 'like', 'ACR %').del();

    [{ id: casualId }] = await db('leave_types')
      .insert({ name: 'ACR Casual', default_days: CASUAL_DAYS, is_active: true, is_paid: true })
      .returning('id');
    [{ id: privId }] = await db('leave_types')
      .insert({ name: 'ACR Privilege', default_days: PRIV_DAYS, is_active: true, is_paid: true })
      .returning('id');

    [{ id: templateId }] = await db('leave_templates')
      .insert({ name: 'ACR Plan', is_default: false, is_active: true, off_day_rules: JSON.stringify([]) })
      .returning('id');
    await db('leave_template_rows').insert([
      {
        template_id: templateId, leave_type_id: casualId, default_days: CASUAL_DAYS,
        accrual_enabled: true, accrual_waiting_months: 0, carry_forward_max: null, max_balance: null,
      },
      {
        template_id: templateId, leave_type_id: privId, default_days: PRIV_DAYS,
        accrual_enabled: true, accrual_waiting_months: 3, carry_forward_max: 5, max_balance: null,
      },
    ]);

    // Joined on the 10th, two years before the period starts, so there is prior service to cap
    // and an unambiguous anniversary day inside it.
    [{ id: employeeId }] = await db('employees').insert({
      employee_code: 'ACR-001', first_name: 'Accrual', last_name: 'Tester',
      date_of_joining: '2024-01-10', is_active: true, leave_template_id: templateId,
      branch_name: 'ACR Property', dept_name: 'ACR Department',
    }).returning('id');

    const current = await db('leave_periods').where('is_current', true).first();
    wasCurrentId = current?.id ?? null;
    [{ id: periodId }] = await db('leave_periods')
      .insert({ name: 'ACR 2026-27', start_date: '2026-04-01', end_date: '2027-03-31', is_current: false })
      .returning('id');
    [{ id: nextPeriodId }] = await db('leave_periods')
      .insert({ name: 'ACR 2027-28', start_date: '2027-04-01', end_date: '2028-03-31', is_current: false })
      .returning('id');
  });

  afterAll(async () => {
    if (wasCurrentId) await db('leave_periods').where('id', wasCurrentId).update({ is_current: true });
    await db('leave_accruals').where('employee_id', employeeId).del();
    await db('employees').where('id', employeeId).del();
    await db('leave_template_rows').where('template_id', templateId).del();
    await db('leave_templates').where('id', templateId).del();
    await db('leave_types').whereIn('id', [casualId, privId]).del();
    await db('leave_periods').whereIn('id', [periodId, nextPeriodId]).del();
    await db.destroy();
  });

  beforeEach(async () => {
    await db('leave_accruals').where('employee_id', employeeId).del();
    await db('leave_requests').where('employee_id', employeeId).del();
    await db('leave_periods').update({ is_current: false });
    await db('leave_periods').where('id', periodId).update({ is_current: true });
  });

  /** Credits everything up to `asOf`, opening balance included, the way the backfill does. */
  const backfillTo = async (asOf: string) => {
    const period = await db('leave_periods').where('id', periodId).first();
    const plan = await planAccruals({ period, asOf, employeeIds: [employeeId], includeOpening: true });
    return writeAccruals(plan, periodId, 'test backfill');
  };

  it('credits the anniversaries that have passed, and only those', async () => {
    await backfillTo('2026-07-15');
    const rows = await ledger().where({ leave_type_id: casualId, source: 'accrual' }).orderBy('credited_on');
    expect(rows.map((r: any) => r.credited_on)).toEqual([
      '2026-04-10', '2026-05-10', '2026-06-10', '2026-07-10',
    ]);
  });

  it('is idempotent — three runs in a row leave the ledger untouched', async () => {
    await backfillTo('2026-07-15');
    const before = await ledger().orderBy('id').select('employee_id', 'leave_type_id', 'credited_on', 'days', 'source');

    for (let i = 0; i < 3; i += 1) await runDailyAccrual('2026-07-15');

    const after = await ledger().orderBy('id').select('employee_id', 'leave_type_id', 'credited_on', 'days', 'source');
    expect(after).toEqual(before);
  });

  it('a stale plan cannot be replayed — the constraint, not the filter, stops the double credit', async () => {
    // Two overlapping runs: both build their plan from the same empty ledger, so BOTH think every
    // credit is missing. The filter in planAccruals cannot help — only the unique index can. This
    // is the test that fails if migration 034's index is dropped or its columns change.
    const period = await db('leave_periods').where('id', periodId).first();
    const plan = await planAccruals({ period, asOf: '2026-07-15', employeeIds: [employeeId], includeOpening: true });

    const first = await writeAccruals(plan, periodId, 'run A');
    const second = await writeAccruals(plan, periodId, 'run B');   // the same plan, again

    expect(first).toBeGreaterThan(0);
    expect(second).toBe(0);
    expect(Number((await ledger().count('id as c').first() as any).c)).toBe(first);
  });

  it('credits forward when the clock moves on, and stops again', async () => {
    await backfillTo('2026-07-15');
    const was = Number((await ledger().count('id as c').first() as any).c);

    const moved = await runDailyAccrual('2026-09-30');
    expect(moved.credited).toBe(4); // August and September, for both leave types
    expect(Number((await ledger().count('id as c').first() as any).c)).toBe(was + 4);

    const again = await runDailyAccrual('2026-09-30');
    expect(again.credited).toBe(0);
  });

  it('the balance every screen reads comes from the ledger, floored', async () => {
    await backfillTo('2026-07-15');
    const balances = await getEffectiveBalances([employeeId], periodId);

    const casual = balances.find((b) => b.leave_type_id === casualId)!;
    expect(casual.source).toBe('accrual');
    expect(casual.accrued).toBe(4);        // four months at 1/month, nothing carried (limit null)
    expect(casual.available).toBe(4);
    expect(casual.used_days).toBeNull();   // the stored counter is not what accrual reads

    const priv = balances.find((b) => b.leave_type_id === privId)!;
    // 5 carried in (capped from ~2 years of prior service) + 4 months × 1.25.
    expect(priv.accrued).toBe(10);
    expect(priv.available).toBe(10);
    expect(priv.next_credit_on).toBe('2026-08-10');
  });

  it('shows whole days while the ledger keeps the fraction', async () => {
    await backfillTo('2026-06-15'); // three credits of 1.25 on top of the 5 carried
    const priv = (await getEffectiveBalances([employeeId], periodId, { leaveTypeIds: [privId] }))[0];
    expect(priv.accrued).toBe(8.75);
    expect(priv.allocated).toBe(8);  // floored for display
    expect(priv.available).toBe(8);  // and for spending
  });

  it('twelve months of 1.25 come to exactly fifteen through the database', async () => {
    // The reason `days` is numeric and not float: summed as doubles this lands on 14.999999999999998
    // and floors to 14, showing an employee a day less than the policy promises.
    await backfillTo('2027-03-31');
    const row = await ledger().where({ leave_type_id: privId, source: 'accrual' })
      .sum('days as d').count('id as c').first() as any;
    expect(Number(row.c)).toBe(12);
    expect(Number(row.d)).toBe(15);
  });

  it('subtracts approved and pending leave from what was earned', async () => {
    await backfillTo('2026-07-15');
    await db('leave_requests').insert([
      {
        employee_id: employeeId, leave_type_id: casualId, start_date: '2026-05-04',
        end_date: '2026-05-04', days: 1, status: 'approved', reason: 'test',
      },
      {
        employee_id: employeeId, leave_type_id: casualId, start_date: '2026-06-08',
        end_date: '2026-06-08', days: 1, status: 'pending', reason: 'test',
      },
    ]);
    const casual = (await getEffectiveBalances([employeeId], periodId, { leaveTypeIds: [casualId] }))[0];
    expect(casual.taken).toBe(1);
    expect(casual.pending).toBe(1);
    expect(casual.available).toBe(2); // 4 earned − 1 − 1
  });

  it('carries forward up to the limit at a rollover, and lapses the rest', async () => {
    await backfillTo('2027-03-31'); // a full year: Casual 12, Privilege 5 + 15 = 20
    await setCurrentPeriod(nextPeriodId);

    const opening = await ledger().where({ leave_period_id: nextPeriodId }).orderBy('leave_type_id');
    // Casual has no carry-forward limit, so nothing at all comes across.
    expect(opening.map((r: any) => r.leave_type_id)).toEqual([privId]);
    expect(Number(opening[0].days)).toBe(5);
    expect(opening[0].source).toBe('opening');
  });

  it('does not write an opening balance when the admin flips back to an earlier period', async () => {
    await backfillTo('2027-03-31');
    await setCurrentPeriod(nextPeriodId);
    await db('leave_accruals').where('leave_period_id', nextPeriodId).del();

    // Going backwards is somebody looking at last year, not a rollover.
    await setCurrentPeriod(periodId);
    expect(await ledger().where({ leave_period_id: nextPeriodId }).first()).toBeUndefined();
  });

  it('running the backfill after a rollover does not grant the limit twice', async () => {
    await backfillTo('2027-03-31');
    await setCurrentPeriod(nextPeriodId);

    const period = await db('leave_periods').where('id', nextPeriodId).first();
    const plan = await planAccruals({ period, asOf: '2027-04-30', employeeIds: [employeeId], includeOpening: true });
    await writeAccruals(plan, nextPeriodId, 'second pass');

    const openings = await ledger().where({ leave_period_id: nextPeriodId, source: 'opening' });
    expect(openings).toHaveLength(1);
    expect(Number(openings[0].days)).toBe(5);
  });
});
