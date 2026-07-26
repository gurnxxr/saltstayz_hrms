import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import db from '../config/database';
import { computePayableDays } from './payableDays.service';
import { updatePaySchedule } from './paySchedule.service';

/**
 * The day-by-day truth table for pay.
 *
 * This is the one place in the suite that talks to a database, and it earns that because the
 * failure mode it guards is silent: every other test here checks arithmetic on numbers handed
 * to it, while the question that actually costs money is "what does ONE day of each attendance
 * code do to someone's pay?" — and that answer only exists once a real row, a real pay rule and
 * a real work calendar meet.
 *
 * It SKIPS unless DATABASE_URL points at a throwaway database whose name contains `hrms_test`
 * or `hrms_qa`. Two reasons: `npm test` stays runnable with no setup (every other test is pure),
 * and the suite can never truncate or rewrite rows in a real database by accident.
 *
 * To run it:
 *   createdb hrms_test
 *   DATABASE_URL=postgres://…/hrms_test npm run db:migrate --workspace=server
 *   DATABASE_URL=postgres://…/hrms_test npm test --workspace=server
 */
const TARGET = process.env.DATABASE_URL || '';
const ON_THROWAWAY = /hrms_(test|qa)/.test(TARGET);

// June 2026 — wholly in the past, so no day falls into the "future, not yet payable" branch.
const YEAR = 2026;
const MONTH = 6;
const d = (day: number) => `${YEAR}-06-${String(day).padStart(2, '0')}`;

describe.skipIf(!ON_THROWAWAY)('payable days — what each attendance code does to a day of pay', () => {
  let employeeId: number;
  let paidLeaveTypeId: number;
  let unpaidLeaveTypeId: number;

  beforeAll(async () => {
    // Every day a working day, so a code's effect is never confused with a weekly off.
    await updatePaySchedule({
      work_week: [0, 1, 2, 3, 4, 5, 6],
      salary_calculation_method: 'actual_days',
      unmarked_day_policy: 'present',
      holidays_paid: true,
    });
    // No holiday may overlap the month, or that day stops being a working day.
    await db('holidays').whereBetween('date', [d(1), d(30)]).del();

    // Pin the rules this table asserts against, rather than trusting migration state.
    const rule = async (code: string, pay_fraction: number, config: Record<string, unknown> = {}) => {
      const existing = await db('attendance_pay_rules').where('code', code).first();
      const patch = { pay_fraction, config: JSON.stringify(config), updated_at: db.fn.now() };
      if (existing) await db('attendance_pay_rules').where('id', existing.id).update(patch);
      else await db('attendance_pay_rules').insert({ code, label: code, ...patch });
    };
    await rule('present', 1);
    await rule('absent', 0);
    await rule('no_punch', 0);          // pays nothing until someone reviews it
    await rule('half_day', 0.5);
    await rule('short_punch', 0.5);
    await rule('hhd', 0.5);
    await rule('miss_punch', 1, { allowance: 3, beyond_pay_fraction: 0.5 });

    await db('employees').where('employee_code', 'PDT-001').del();
    const [{ id }] = await db('employees').insert({
      employee_code: 'PDT-001', first_name: 'Truth', last_name: 'Table',
      date_of_joining: '2025-01-01', is_active: true,
    }).returning('id');
    employeeId = id;

    const leaveType = async (name: string, is_paid: boolean) => {
      const found = await db('leave_types').where('name', name).first();
      if (found) return found.id;
      const [{ id: newId }] = await db('leave_types')
        .insert({ name, is_paid, default_days: 12, is_active: true }).returning('id');
      return newId;
    };
    paidLeaveTypeId = await leaveType('PDT Paid Leave', true);
    unpaidLeaveTypeId = await leaveType('PDT Unpaid Leave', false);
  });

  afterAll(async () => {
    await db('leave_requests').where('employee_id', employeeId).del();
    await db('attendance_records').where('employee_id', employeeId).del();
    await db('employees').where('id', employeeId).del();
    await db.destroy();
  });

  beforeEach(async () => {
    await db('attendance_records').where('employee_id', employeeId).del();
    await db('leave_requests').where('employee_id', employeeId).del();
  });

  /** One attendance row. */
  const mark = (day: number, status: string, extra: Record<string, unknown> = {}) =>
    db('attendance_records').insert({ employee_id: employeeId, date: d(day), status, ...extra });

  /** An approved leave covering a single day. */
  const leave = (day: number, leaveTypeId: number) =>
    db('leave_requests').insert({
      employee_id: employeeId, leave_type_id: leaveTypeId,
      start_date: d(day), end_date: d(day), days: 1, status: 'approved', reason: 'truth table',
    });

  /** The loss-of-pay the engine assigned to one date. */
  async function lopOn(day: number) {
    const res = await computePayableDays(employeeId, MONTH, YEAR);
    return res.trace.find((t) => t.date === d(day));
  }

  it('Present costs nothing', async () => {
    await mark(1, 'present');
    expect((await lopOn(1))?.lop).toBe(0);
  });

  it('Absent costs the whole day', async () => {
    await mark(2, 'absent');
    expect((await lopOn(2))?.lop).toBe(1);
  });

  it('No Punch costs the whole day until someone reviews it', async () => {
    // The policy that matters most here: it shipped paying in full, which meant a broken
    // fingerprint reader silently paid a property for days nobody could evidence.
    await mark(3, 'no_punch');
    const day = await lopOn(3);
    expect(day?.status).toBe('no_punch');
    expect(day?.lop).toBe(1);
  });

  it('Half Day costs half, and consumes half a day of leave', async () => {
    await mark(4, 'half_day');
    const res = await computePayableDays(employeeId, MONTH, YEAR);
    expect(res.trace.find((t) => t.date === d(4))?.lop).toBe(0.5);
    expect(res.leave_debit_days).toBe(0.5);
  });

  it('Short Punch costs half', async () => {
    await mark(5, 'short_punch');
    expect((await lopOn(5))?.lop).toBe(0.5);
  });

  it('Half-day holiday costs half', async () => {
    await mark(6, 'hhd');
    expect((await lopOn(6))?.lop).toBe(0.5);
  });

  it('the first three missed punches in a month are free, the fourth is not', async () => {
    for (const day of [7, 8, 9, 10]) await mark(day, 'miss_punch');
    const res = await computePayableDays(employeeId, MONTH, YEAR);
    const lops = [7, 8, 9, 10].map((day) => res.trace.find((t) => t.date === d(day))?.lop);
    expect(lops).toEqual([0, 0, 0, 0.5]);
  });

  it('an approved PAID leave protects a day the register marked No Punch', async () => {
    await mark(11, 'no_punch');
    await leave(11, paidLeaveTypeId);
    const day = await lopOn(11);
    expect(day?.status).toBe('paid_leave');
    expect(day?.lop).toBe(0);
  });

  it('an approved UNPAID leave still costs the day', async () => {
    await mark(12, 'absent');
    await leave(12, unpaidLeaveTypeId);
    const day = await lopOn(12);
    expect(day?.status).toBe('unpaid_leave');
    expect(day?.lop).toBe(1);
  });

  it('a day with no attendance row follows the unmarked-day policy', async () => {
    const day = await lopOn(14);
    expect(day?.status).toBe('unmarked');
    expect(day?.lop).toBe(0); // policy is 'present'
  });

  it('an approved regularisation pays a day the person says they worked', async () => {
    await mark(16, 'no_punch', { is_regularised: true });
    const day = await lopOn(16);
    expect(day?.lop).toBe(0);
  });

  it('a regularised ABSENT day is still not paid', async () => {
    // "Mark me absent" is no longer a request an employee can raise, but rows approved before
    // that change still exist. Full-pay-on-approval must not extend to a day the person
    // themselves declared they did not work, or a legacy row quietly pays for it.
    await mark(15, 'absent', { is_regularised: true });
    expect((await lopOn(15))?.lop).toBe(1);
  });

  it('totals the month correctly across a mix of codes', async () => {
    await mark(1, 'present');
    await mark(2, 'absent');        // 1
    await mark(3, 'no_punch');      // 1
    await mark(4, 'half_day');      // 0.5
    await mark(5, 'short_punch');   // 0.5
    await mark(6, 'hhd');           // 0.5
    const res = await computePayableDays(employeeId, MONTH, YEAR);
    expect(res.lop_days).toBe(3.5);
    // 30 working days in June, minus 3.5 lost.
    expect(res.working_days).toBe(30);
    expect(res.payment_days).toBe(26.5);
  });
});
