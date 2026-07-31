import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import db from '../config/database';
import { approveRegularisation, requestRegularisation } from './regularisation.service';
import {
  runPayroll, lockRun, getRunDetails, getPayslipForStaff, getSalaryRegister,
  refreshPayslipAfterAttendanceChange,
} from './payslip.service';
import { updatePaySchedule } from './paySchedule.service';
import { ensureStructureComponents } from '../db/structureComponents';

/**
 * Does an approved regularisation actually reach the MONEY?
 *
 * The engine always priced a regularised day correctly. The bug was one layer up: approval wrote
 * the attendance row and stopped, so a month whose payroll had already been generated kept its
 * pre-regularisation figure — and that stored figure is what the review grid, the salary register,
 * the bank hand-off and the lock snapshot all read. Locking froze it permanently, and there is no
 * arrears mechanism anywhere in this codebase for it to land in later.
 *
 * So the assertion that matters is on the STORED payslip, never on a live recompute: a live
 * recompute was always right, which is exactly why the bug survived.
 *
 * Runs only against a throwaway database — it generates and locks real payroll runs.
 */
const ON_THROWAWAY = /hrms_(test|qa)/.test(process.env.DATABASE_URL || '');

const MONTH = 4;      // April 2026 — wholly in the past, no overlap with the fixtures in
const YEAR = 2026;    // payableDays.db.test.ts (May) or leave.holidays.db.test.ts.
const d = (day: number) => `${YEAR}-04-${String(day).padStart(2, '0')}`;

describe.skipIf(!ON_THROWAWAY)('an approved regularisation reaches the money', () => {
  let empId: number;
  let approverId: number;
  let structureId: number;

  const storedNet = async () => Number(
    (await db('payslip_history').where({ employee_id: empId, month: MONTH, year: YEAR }).first())?.net_pay ?? 0,
  );

  const fileAndApprove = async (day: number, type = 'present') => {
    const { id } = await requestRegularisation(empId, {
      start_date: d(day), end_date: d(day), requested_status: type, reason: 'I worked this day',
    }) as any;
    return approveRegularisation(id, approverId, 'admin');
  };

  beforeAll(async () => {
    // Every day is a working day, so the month's shape can't drift under the assertions.
    await updatePaySchedule({
      work_week: [0, 1, 2, 3, 4, 5, 6],
      salary_calculation_method: 'calendar_days',
      unmarked_day_policy: 'present',
      holidays_paid: true,
    });
    await db('pay_schedule_settings').update({ work_pattern_effective_from: null });

    await db('employees').whereIn('employee_code', ['RMT-001', 'RMT-MGR']).del();
    const [{ id: mgr }] = await db('employees').insert({
      employee_code: 'RMT-MGR', first_name: 'Reg', last_name: 'Approver',
      date_of_joining: '2024-01-01', is_active: true,
    }).returning('id');
    approverId = mgr;

    const [{ id }] = await db('employees').insert({
      employee_code: 'RMT-001', first_name: 'Regular', last_name: 'Isation',
      date_of_joining: '2024-01-01', is_active: true, reporting_manager_id: mgr,
    }).returning('id');
    empId = id;

    // A salary the payslip engine can compute. Deliberately the SIMPLEST structure that works: one
    // "remainder" line, which by definition absorbs the whole prorated base — so gross earnings
    // track the pay factor exactly and any movement in net pay is attributable to attendance and
    // nothing else. `ensureStructureComponents` is the seed's own helper, so the component rows are
    // real ones; it does not create Basic/HRA (a different seed owns those), which is why this
    // builds its line by hand rather than through `standardLines`.
    await db('salary_structures').where('name', 'RMT Structure').del();
    const componentIds = await ensureStructureComponents(db);
    const [{ id: sid }] = await db('salary_structures').insert({
      name: 'RMT Structure', payment_basis: 'monthly', default_base: 31000,
      city: 'Haryana', is_active: true,
    }).returning('id');
    structureId = sid;
    await db('salary_structure_components').insert({
      structure_id: structureId,
      component_id: componentIds['Other Allowance'],
      calculation_type: 'remainder',
      value: 0,
      sort_order: 0,
    });
    await db('salary_structure_assignments').insert({
      employee_id: empId, structure_id: structureId, base: 31000,
    });
  });

  afterAll(async () => {
    await db('attendance_regularisations').where('employee_id', empId).del();
    await db('attendance_records').where('employee_id', empId).del();
    await db('payslip_history').where({ month: MONTH, year: YEAR }).del();
    await db('payroll_runs').where({ month: MONTH, year: YEAR }).del();
    await db('salary_structure_assignments').where('employee_id', empId).del();
    await db('salary_structure_components').where('structure_id', structureId).del();
    await db('salary_structures').where('id', structureId).del();
    await db('employees').whereIn('id', [empId, approverId]).del();
    await updatePaySchedule({
      work_week: [0, 1, 2, 3, 4, 5, 6],
      salary_calculation_method: 'actual_days',
      unmarked_day_policy: 'present',
      holidays_paid: true,
    });
    await db.destroy();
  });

  beforeEach(async () => {
    await db('attendance_regularisations').where('employee_id', empId).del();
    await db('attendance_records').where('employee_id', empId).del();
    await db('payslip_history').where({ month: MONTH, year: YEAR }).del();
    await db('payroll_runs').where({ month: MONTH, year: YEAR }).del();
  });

  it('the STORED payslip rises by exactly one day — the whole point', async () => {
    await db('attendance_records').insert({ employee_id: empId, date: d(10), status: 'absent' });
    await runPayroll(MONTH, YEAR, null);

    const before = await storedNet();
    const beforeDays = (await getRunDetails(MONTH, YEAR)).slips
      .find((s: any) => s.employee_id === empId)?.days;
    expect(beforeDays.lop_days).toBe(1);
    expect(beforeDays.payment_days).toBe(29);   // April has 30 days

    const res: any = await fileAndApprove(10);
    expect(res.pay.outcome).toBe('refreshed');

    const after = await storedNet();
    expect(after).toBeGreaterThan(before);

    // And the grid — which reads the stored snapshot, not a live recompute — agrees.
    const details = await getRunDetails(MONTH, YEAR);
    const slip: any = details.slips.find((s: any) => s.employee_id === empId);
    expect(slip.days.lop_days).toBe(0);
    expect(slip.days.payment_days).toBe(30);
    expect(Math.round(slip.net_pay)).toBe(Math.round(after));
  });

  it('the stored figure and the live one agree afterwards — no more two answers', async () => {
    await db('attendance_records').insert({ employee_id: empId, date: d(10), status: 'absent' });
    await runPayroll(MONTH, YEAR, null);
    await fileAndApprove(10);

    const stored = await storedNet();
    const live: any = await getPayslipForStaff(empId, MONTH, YEAR);
    expect(Math.round(live.breakdown.net_pay)).toBe(Math.round(stored));
  });

  it('a month that was never run creates no payslip and no run', async () => {
    await db('attendance_records').insert({ employee_id: empId, date: d(10), status: 'absent' });

    const res: any = await fileAndApprove(10);
    expect(res.pay.outcome).toBe('no_payslip');

    // The guard that matters: inventing a slip would let the run totals re-aggregate, and
    // inventing a run would conjure a payroll nobody started.
    expect(await db('payslip_history').where({ month: MONTH, year: YEAR }).count('id as c').first())
      .toMatchObject({ c: '0' });
    expect(await db('payroll_runs').where({ month: MONTH, year: YEAR }).first()).toBeUndefined();
    // The attendance correction still landed.
    const row = await db('attendance_records').where({ employee_id: empId, date: d(10) }).first();
    expect(row.is_regularised).toBe(true);
  });

  it('a locked month refuses the request outright, and nothing moves', async () => {
    await db('attendance_records').insert({ employee_id: empId, date: d(10), status: 'absent' });
    await runPayroll(MONTH, YEAR, null);
    await lockRun(MONTH, YEAR, null, true);   // confirm past the coverage gate

    const frozen = await storedNet();
    await expect(fileAndApprove(10)).rejects.toThrow(/locked/i);

    expect(await storedNet()).toBe(frozen);
    const row = await db('attendance_records').where({ employee_id: empId, date: d(10) }).first();
    expect(row.status).toBe('absent');            // attendance untouched too
    expect(row.is_regularised).toBeFalsy();
  });

  it('a month frozen under old pay rules is refused at FILING time, not silently accepted', async () => {
    // The trap this closes: the old guard tested only `status === 'locked'`, so a request could be
    // approved into a legacy-frozen month where runPayroll and upsertAdjustment both refuse — the
    // attendance changed, the employee was told it was fixed, and the money could never follow.
    await db('attendance_records').insert({ employee_id: empId, date: d(10), status: 'absent' });
    await runPayroll(MONTH, YEAR, null);
    await db('payslip_history').where({ month: MONTH, year: YEAR }).update({ calc_version: 1 });

    await expect(requestRegularisation(empId, {
      start_date: d(10), end_date: d(10), requested_status: 'present', reason: 'worked',
    })).rejects.toThrow(/frozen|no longer exist/i);

    const row = await db('attendance_records').where({ employee_id: empId, date: d(10) }).first();
    expect(row.status).toBe('absent');
  });

  it('attendance changed after the run marks the month out of date, and the lock refuses', async () => {
    await runPayroll(MONTH, YEAR, null);
    expect((await getRunDetails(MONTH, YEAR)).staleness.count).toBe(0);

    // A bulk upload, not a regularisation — the staleness check is derived from timestamps, so it
    // catches every writer of attendance, not just the one that prompted this work.
    await db('attendance_records').insert({ employee_id: empId, date: d(12), status: 'absent' });

    const details = await getRunDetails(MONTH, YEAR);
    expect(details.staleness.count).toBe(1);
    expect(details.staleness.employee_ids).toContain(empId);
    expect((details.slips as any[]).find((s) => s.employee_id === empId)?.stale).toBe(true);

    // Blocked, and deliberately NOT confirm-through: the correct fix is one click away.
    await expect(lockRun(MONTH, YEAR, null, true)).rejects.toThrow(/out of date/i);

    await runPayroll(MONTH, YEAR, null);
    expect((await getRunDetails(MONTH, YEAR)).staleness.count).toBe(0);
    await expect(lockRun(MONTH, YEAR, null, true)).resolves.toBeTruthy();
  });

  it('a refresh on a month with no payslip for that employee does nothing', async () => {
    await runPayroll(MONTH, YEAR, null);
    await db('payslip_history').where({ employee_id: empId, month: MONTH, year: YEAR }).del();

    const res = await refreshPayslipAfterAttendanceChange(empId, MONTH, YEAR);
    expect(res.outcome).toBe('no_payslip');
    expect(await db('payslip_history').where({ employee_id: empId, month: MONTH, year: YEAR }).first())
      .toBeUndefined();
  });

  // ── The two races the adversarial review found ──

  it('the register frozen at lock matches the payslips it was built from', async () => {
    // lockRun used to read the run, build the register, and flip the status as separate
    // autocommit statements. A re-price landing in that window left the frozen bank CSV — which a
    // locked month then serves verbatim FOREVER — disagreeing with the payslip row the employee
    // sees, with no arrears path to reconcile them. It is now one transaction under the month lock.
    await db('attendance_records').insert({ employee_id: empId, date: d(10), status: 'absent' });
    await runPayroll(MONTH, YEAR, null);
    await lockRun(MONTH, YEAR, null, true);

    const run = await db('payroll_runs').where({ month: MONTH, year: YEAR }).first();
    expect(run.status).toBe('locked');
    expect(run.register_snapshot).toBeTruthy();

    const stored = await storedNet();
    const row = String(run.register_snapshot).split('\n').find((l: string) => l.startsWith('RMT-001'));
    expect(row).toBeTruthy();
    // Net pay is the last numeric column before the bank details.
    expect(row).toContain(String(Math.round(stored)));

    // And the exported register still serves that exact snapshot rather than recomputing.
    expect(await getSalaryRegister(MONTH, YEAR)).toBe(run.register_snapshot);
  });

  it('locking is idempotent and cannot be re-entered', async () => {
    await runPayroll(MONTH, YEAR, null);
    const first = await lockRun(MONTH, YEAR, null, true);
    const again = await lockRun(MONTH, YEAR, null, true);
    expect(again.status).toBe('locked');
    expect(again.locked_at).toEqual(first.locked_at);   // the second call is a no-op, not a re-lock
  });

  it('a payslip is stale exactly when attendance is NEWER than it, not the other way round', async () => {
    // The direction the whole lock gate rests on. The re-price stamps updated_at from BEFORE its
    // compute read anything, so an attendance write landing mid-compute is necessarily newer than
    // the payslip that does not contain it. Stamping write-time would invert this for that window
    // and report a wrong payslip as fresh — and lockRun refuses on this check, so a clean result
    // reads as "safe to pay".
    await runPayroll(MONTH, YEAR, null);
    await db('attendance_records').insert({ employee_id: empId, date: d(12), status: 'absent' });

    const anchorTime = new Date('2026-06-01T12:00:00Z');
    await db('payslip_history').where({ employee_id: empId, month: MONTH, year: YEAR })
      .update({ updated_at: anchorTime });

    // Attendance touched AFTER the payslip was priced → the payslip cannot contain it.
    await db('attendance_records').where({ employee_id: empId, date: d(12) })
      .update({ updated_at: new Date(anchorTime.getTime() + 1000) });
    expect((await getRunDetails(MONTH, YEAR)).staleness.count).toBe(1);

    // Touched BEFORE → the payslip already reflects it, and nothing is reported.
    await db('attendance_records').where({ employee_id: empId, date: d(12) })
      .update({ updated_at: new Date(anchorTime.getTime() - 1000) });
    expect((await getRunDetails(MONTH, YEAR)).staleness.count).toBe(0);
  });

  it('the stale gate can be overridden, but only with a written reason that is recorded', async () => {
    // The gate must not be able to permanently prevent closing the books. Two real dead ends no
    // re-run clears: a month frozen under old pay rules (runPayroll refuses outright), and an
    // active employee whose payslip cannot be regenerated (no salary structure — runPayroll skips
    // them at 422, and the purge only drops slips for INACTIVE employees). So there is a way past,
    // and it is deliberately NOT the coverage gate's confirm flag.
    await runPayroll(MONTH, YEAR, null);
    await db('attendance_records').insert({ employee_id: empId, date: d(12), status: 'absent' });
    expect((await getRunDetails(MONTH, YEAR)).staleness.count).toBe(1);

    // `confirm` waves through thin attendance. It must NOT wave through a figure known to be wrong.
    await expect(lockRun(MONTH, YEAR, null, true)).rejects.toThrow(/out of date/i);
    // Nor does an empty or whitespace reason.
    await expect(lockRun(MONTH, YEAR, null, true, '   ')).rejects.toThrow(/out of date/i);

    // The message names who, so the admin can go and look.
    await expect(lockRun(MONTH, YEAR, null, true)).rejects.toThrow(/RMT-001/);

    const locked = await lockRun(MONTH, YEAR, null, true, 'Employee has no salary structure; a re-run skips them.');
    expect(locked.status).toBe('locked');

    const run = await db('payroll_runs').where({ month: MONTH, year: YEAR }).first();
    expect(run.lock_override_reason).toContain('no salary structure');
    expect(run.lock_override_reason).toContain('1 payslip(s) out of date');
  });

  it('a clean lock records no override reason', async () => {
    // Absence of a reason has to mean "the gate was satisfied", not "somebody forgot to explain".
    await runPayroll(MONTH, YEAR, null);
    await lockRun(MONTH, YEAR, null, true);
    const run = await db('payroll_runs').where({ month: MONTH, year: YEAR }).first();
    expect(run.lock_override_reason).toBeNull();
  });

  it('the approval records what happened to pay, for whoever asks months later', async () => {
    await db('attendance_records').insert({ employee_id: empId, date: d(10), status: 'absent' });
    await runPayroll(MONTH, YEAR, null);
    await fileAndApprove(10);

    const reg = await db('attendance_regularisations')
      .where('employee_id', empId).orderBy('id', 'desc').first();
    expect(reg.pay_refresh_status).toBe('refreshed');
  });
});
