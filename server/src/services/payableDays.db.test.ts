import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import db from '../config/database';
import { computePayableDays, leaveDatesFor } from './payableDays.service';
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
    // Pin the calendar inputs too, for the same reason the pay rules are pinned below: a test
    // that depends on whatever migration state this database happens to be in proves nothing.
    // No clamp (so a pattern applies to any date), and no work week on the Default template
    // (so the code-only cases below are not quietly reading someone's Saturday off).
    await db('pay_schedule_settings').update({ work_pattern_effective_from: null });
    await db('leave_templates').update({ off_day_rules: JSON.stringify([]) });
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
    await db('leave_templates').where('name', 'like', 'PDT %').del();
    await db('holidays').where('name', 'like', 'PDT %').del();
    // NOT db.destroy() — the calendar-month block below runs after this one and needs the pool.
    // It closes the connection in its own afterAll, as the last thing in the file.
  });

  beforeEach(async () => {
    await db('attendance_records').where('employee_id', employeeId).del();
    await db('leave_requests').where('employee_id', employeeId).del();
    await db('holidays').where('name', 'like', 'PDT %').del();
    // Back to "no work week", so each test states its own.
    await db('employees').where('id', employeeId).update({ leave_template_id: null });
  });

  /**
   * Put the employee on a leave template that declares this work week.
   *
   * This is the axis the whole change is about: the leave template says which days of the week
   * someone does not work, and that is what decides whether an unevidenced day costs them.
   */
  async function onWorkWeek(name: string, rules: Array<{ day: number; weeks: number[] | null }>) {
    await db('leave_templates').where('name', name).del();
    const [{ id }] = await db('leave_templates')
      .insert({ name, is_default: false, is_active: true, off_day_rules: JSON.stringify(rules) })
      .returning('id');
    await db('employees').where('id', employeeId).update({ leave_template_id: id });
  }

  const SUNDAY_OFF = [{ day: 0, weeks: null }];
  const SAT_AND_SUN_OFF = [{ day: 0, weeks: null }, { day: 6, weeks: null }];
  const SUNDAY_PLUS_ALT_SATURDAY = [{ day: 0, weeks: null }, { day: 6, weeks: [2, 4] }];

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

  // ── The weekly off: whether a day was one you were SCHEDULED to work ──
  // June 2026 starts on a Monday. Sundays fall on 7, 14, 21, 28; Saturdays on 6, 13, 20, 27.

  it('the SAME No Punch costs a full day on a working day and nothing on a rest day', async () => {
    // This is the owner's report, written down. HR's register marks a rest day "NP" because of
    // course there was no punch — nobody was working. Deciding pay from that code alone charged
    // a full day for it. What has to decide is whether the person was scheduled to work at all.
    await onWorkWeek('PDT Hotel Ops', SUNDAY_OFF);
    await mark(7, 'no_punch');   // Sunday — their rest day
    await mark(8, 'no_punch');   // Monday — a scheduled working day

    const res = await computePayableDays(employeeId, MONTH, YEAR);
    const sunday = res.trace.find((t) => t.date === d(7));
    const monday = res.trace.find((t) => t.date === d(8));

    expect(sunday?.kind).toBe('weekly_off');
    expect(sunday?.status).toBeNull();      // the code is never even consulted
    expect(sunday?.lop).toBe(0);
    expect(monday?.kind).toBe('working');
    expect(monday?.status).toBe('no_punch');
    expect(monday?.lop).toBe(1);
    expect(res.lop_days).toBe(1);           // one lost day, not two
  });

  it('a six-day week prices the month against 26 days, not 30', async () => {
    // The denominator is what a lost day costs: salary ÷ working days. Treating a six-day
    // employee as working all 30 makes every deduction ~15% too small, and treating them as
    // Mon–Fri makes it ~18% too large. Neither was ever configured — both were defaults.
    await onWorkWeek('PDT Hotel Ops', SUNDAY_OFF);
    const res = await computePayableDays(employeeId, MONTH, YEAR);
    expect(res.working_days).toBe(26);
    expect(res.weekly_offs).toBe(4);
    expect(res.calendar_source).toBe('template');
    expect(res.calendar_name).toBe('PDT Hotel Ops');
  });

  it('a five-day week prices it against 22', async () => {
    await onWorkWeek('PDT Corporate', SAT_AND_SUN_OFF);
    const res = await computePayableDays(employeeId, MONTH, YEAR);
    expect(res.working_days).toBe(22);
    expect(res.weekly_offs).toBe(8);
  });

  it('every Sunday plus the 2nd and 4th Saturday prices it against 24', async () => {
    // The arrangement the owner asked about. It needs no new machinery — it is one rule — but
    // the occurrence is POSITIONAL, so it is worth pinning to actual dates: in June 2026 the
    // 2nd Saturday is the 13th and the 4th is the 27th.
    await onWorkWeek('PDT Corporate — Alt Saturday', SUNDAY_PLUS_ALT_SATURDAY);
    const res = await computePayableDays(employeeId, MONTH, YEAR);
    expect(res.working_days).toBe(24);
    expect(res.weekly_offs).toBe(6);
    const kindOn = (day: number) => res.trace.find((t) => t.date === d(day))?.kind;
    expect(kindOn(6)).toBe('working');      // 1st Saturday — worked
    expect(kindOn(13)).toBe('weekly_off');  // 2nd — off
    expect(kindOn(20)).toBe('working');     // 3rd — worked
    expect(kindOn(27)).toBe('weekly_off');  // 4th — off
  });

  it('a holiday landing on a rest day does not add a day to the divisor', async () => {
    // Tested the other way round — holiday before off-day — a public holiday falling on someone's
    // rest day became a PAID HOLIDAY and entered the salary divisor, a day nobody was rostered
    // for. That silently changed the price of every lost day in the month. It yields 27 here.
    await onWorkWeek('PDT Hotel Ops', SUNDAY_OFF);
    // all_departments/all_properties are as load-bearing as is_national: a holiday reaches
    // nobody until it says who it is for (migration 025). Left off, this holiday would simply
    // not exist for anyone and the assertion below would be testing nothing.
    await db('holidays').insert({
      name: 'PDT Rest-day Holiday', date: d(14), is_national: true,
      all_departments: true, all_properties: true,
    });

    const res = await computePayableDays(employeeId, MONTH, YEAR);
    expect(res.working_days).toBe(26);
    expect(res.holidays).toBe(0);
    expect(res.weekly_offs).toBe(4);
    const day = res.trace.find((t) => t.date === d(14));
    expect(day?.kind).toBe('weekly_off');
    expect(day?.holiday_name).toBe('PDT Rest-day Holiday'); // still named — it just moves no money
  });

  it('a holiday on a working day still counts as one, and is paid', async () => {
    // The control for the case above: same pattern, holiday moved to the Monday.
    await onWorkWeek('PDT Hotel Ops', SUNDAY_OFF);
    await db('holidays').insert({
      name: 'PDT Working-day Holiday', date: d(15), is_national: true,
      all_departments: true, all_properties: true,
    });

    const res = await computePayableDays(employeeId, MONTH, YEAR);
    expect(res.working_days).toBe(26);
    expect(res.holidays).toBe(1);
    expect(res.trace.find((t) => t.date === d(15))?.kind).toBe('holiday');
    expect(res.lop_days).toBe(0);
  });

  it('every day says which named policy decided it', async () => {
    // "Why was this Sunday paid?" had no answer anywhere in the system, which is how an entire
    // company came to be treated as working seven days a week without anyone choosing that.
    await onWorkWeek('PDT Hotel Ops', SUNDAY_OFF);
    const res = await computePayableDays(employeeId, MONTH, YEAR);
    for (const t of res.trace) {
      expect(t.decided_by).toBeTruthy();
      expect(t.decided_by_name).toBeTruthy();
    }
    expect(res.trace.find((t) => t.date === d(7))?.decided_by).toBe('template');
    expect(res.trace.find((t) => t.date === d(7))?.decided_by_name).toBe('PDT Hotel Ops');
  });

  it('falls back to a NAMED policy, never an anonymous one, when nothing is assigned', async () => {
    // With no template of their own and no pattern on Default, the org work week decides — but
    // it has to say so, so an unconfigured employee is visible rather than silently normal.
    const res = await computePayableDays(employeeId, MONTH, YEAR);
    expect(res.calendar_source).toBe('work_week');
    expect(res.calendar_name).toBe('Company work week');
  });

  it('a pattern cannot reach back into a month that was already priced', async () => {
    // Patterns are configured today but evaluated across history. Without a clamp, saving one
    // this morning re-prices a month that has already been paid.
    await onWorkWeek('PDT Hotel Ops', SUNDAY_OFF);
    await db('pay_schedule_settings').update({ work_pattern_effective_from: `${YEAR}-07-01` });
    try {
      const res = await computePayableDays(employeeId, MONTH, YEAR); // June — before the boundary
      expect(res.working_days).toBe(30);   // the old calendar, untouched
      expect(res.weekly_offs).toBe(0);
      expect(res.calendar_source).toBe('work_week');
    } finally {
      await db('pay_schedule_settings').update({ work_pattern_effective_from: null });
    }
  });

  it('a leave debits and marks the SAME days, so the balance and the calendar agree', async () => {
    // These used to be two different answers. The balance counted working days while the calendar
    // was marked for every date in the range, so a Friday-to-Monday leave took 2 days off the
    // balance and wrote 4 "on leave" marks. Harmless only while payroll ignored rest days — with
    // a six-day week, an unpaid mark on that Saturday costs a day nobody asked for.
    await onWorkWeek('PDT Hotel Ops', SUNDAY_OFF);
    // Fri 5 June → Mon 8 June. Sunday the 7th is their rest day.
    const dates = await leaveDatesFor(employeeId, d(5), d(8), false);
    expect(dates).toEqual([d(5), d(6), d(8)]);   // 3 days, Sunday dropped
    expect(dates).not.toContain(d(7));
  });

  it('the sandwich rule takes the bridging rest days, and takes them on both sides', async () => {
    // When a leave type counts sandwich days, the rest day between two leave days is consumed —
    // so it must be BOTH debited and marked. Asymmetry either way is how the two drifted apart.
    await onWorkWeek('PDT Hotel Ops', SUNDAY_OFF);
    const dates = await leaveDatesFor(employeeId, d(5), d(8), true);
    expect(dates).toEqual([d(5), d(6), d(7), d(8)]);
    expect(dates).toContain(d(7));
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

/**
 * The calendar-month divisor — the owner's salary spec.
 *
 * Salary divides over the days in the month (28/29/30/31), and weekly offs and holidays are PAID
 * days sitting inside that total. So a lost day costs 1/31 of a 31-day month rather than 1/26 of
 * its working days, and paid days can never exceed the month's length — which is the bug in the
 * spreadsheet this came from, where one employee reached 35.5 paid days in a 31-day month.
 *
 * Its own describe block with its own beforeAll/afterAll, so the method can never leak into the
 * block above and the two cannot depend on ordering.
 */
describe.skipIf(!ON_THROWAWAY)('calendar-month divisor', () => {
  // May 2026: 31 days, wholly in the past. Sundays fall on 3/10/17/24/31, so a Sunday-off
  // employee has exactly 26 working days in a 31-day month — the contrast this block is about.
  const MAY = 5;
  const MYEAR = 2026;
  const m = (day: number) => `${MYEAR}-05-${String(day).padStart(2, '0')}`;
  let empId: number;

  beforeAll(async () => {
    await updatePaySchedule({
      work_week: [0, 1, 2, 3, 4, 5, 6],
      salary_calculation_method: 'calendar_days',
      unmarked_day_policy: 'present',
      holidays_paid: true,
    });
    await db('pay_schedule_settings').update({ work_pattern_effective_from: null });

    const rule = async (code: string, pay_fraction: number, config: Record<string, unknown> = {}) => {
      const existing = await db('attendance_pay_rules').where('code', code).first();
      const patch = { pay_fraction, config: JSON.stringify(config), updated_at: db.fn.now() };
      if (existing) await db('attendance_pay_rules').where('id', existing.id).update(patch);
      else await db('attendance_pay_rules').insert({ code, label: code, ...patch });
    };
    // The owner's value table.
    await rule('present', 1);
    await rule('absent', 0);
    await rule('half_day', 0.5);
    await rule('hhd', 0.5);
    await rule('short_punch', 0.5);
    await rule('no_punch', 1);
    await rule('miss_punch', 0.75, { allowance: 0, beyond_pay_fraction: 0.5 });

    await db('employees').where('employee_code', 'CDT-001').del();
    const [{ id }] = await db('employees').insert({
      employee_code: 'CDT-001', first_name: 'Calendar', last_name: 'Month',
      date_of_joining: '2025-01-01', is_active: true,
    }).returning('id');
    empId = id;
  });

  afterAll(async () => {
    await db('attendance_records').where('employee_id', empId).del();
    await db('employees').where('id', empId).del();
    await db('leave_templates').where('name', 'like', 'CDT %').del();
    await db('holidays').where('name', 'like', 'CDT %').del();
    // Hand the shared settings back exactly as the other block expects to find them.
    await updatePaySchedule({
      work_week: [0, 1, 2, 3, 4, 5, 6],
      salary_calculation_method: 'actual_days',
      unmarked_day_policy: 'present',
      holidays_paid: true,
    });
    await db.destroy();  // last block in the file — close the pool here
  });

  beforeEach(async () => {
    await db('attendance_records').where('employee_id', empId).del();
    await db('holidays').where('name', 'like', 'CDT %').del();
    await db('employees').where('id', empId).update({
      leave_template_id: null, date_of_joining: '2025-01-01', last_working_day: null,
    });
  });

  const markM = (day: number, status: string) =>
    db('attendance_records').insert({ employee_id: empId, date: m(day), status });

  async function sundayOff() {
    await db('leave_templates').where('name', 'CDT Sunday Off').del();
    const [{ id }] = await db('leave_templates').insert({
      name: 'CDT Sunday Off', is_default: false, is_active: true,
      off_day_rules: JSON.stringify([{ day: 0, weeks: null }]),
    }).returning('id');
    await db('employees').where('id', empId).update({ leave_template_id: id });
  }

  it('a lost day costs 1/31 of the month, not 1/26 of its working days', async () => {
    await sundayOff();
    await markM(4, 'absent');   // a Monday
    const res = await computePayableDays(empId, MAY, MYEAR);
    expect(res.scheduled_working_days).toBe(26);  // the month really does have 26 working days
    expect(res.working_days).toBe(31);            // but the salary divides over 31
    expect(res.lop_days).toBe(1);
    expect(res.payment_days).toBe(30);
    // The price of the lost day: 1/31, not 1/26.
    expect(1 - res.payment_days / res.working_days).toBeCloseTo(1 / 31, 6);
  });

  it('weekly offs and holidays are paid days inside the month', async () => {
    await sundayOff();
    await db('holidays').insert({
      name: 'CDT May Day', date: m(1), is_national: true, is_recurring: false,
      all_departments: true, all_properties: true,
    });
    const res = await computePayableDays(empId, MAY, MYEAR);
    expect(res.lop_days).toBe(0);
    expect(res.weekly_offs).toBe(5);
    expect(res.holidays).toBe(1);
    expect(res.payment_days).toBe(31);   // a clean month pays the whole month
  });

  it('paid days never exceed the days in the month', async () => {
    // The direct answer to the spreadsheet: adding the offs and holidays on top of a total that
    // already contains them produced 35.5 days in a 31-day month.
    await sundayOff();
    await db('holidays').insert([
      { name: 'CDT H1', date: m(1), is_national: true, is_recurring: false, all_departments: true, all_properties: true },
      { name: 'CDT H2', date: m(2), is_national: true, is_recurring: false, all_departments: true, all_properties: true },
    ]);
    const res = await computePayableDays(empId, MAY, MYEAR);
    expect(res.payment_days).toBe(31);
    expect(res.payment_days).toBeLessThanOrEqual(res.period_days);
  });

  it('a mid-month joiner is not paid for the weekly offs before they joined', async () => {
    await sundayOff();
    await db('employees').where('id', empId).update({ date_of_joining: m(15) });
    const res = await computePayableDays(empId, MAY, MYEAR);
    // 1-14 May is 14 calendar days, two of them Sundays (3rd and 10th).
    expect(res.not_employed_calendar_days).toBe(14);
    expect(res.not_employed_days).toBe(12);       // the working days among them
    expect(res.payment_days).toBe(17);            // the days they were actually on the payroll
    // The trap: counting only the WORKING days outside the span pays those two Sundays.
    expect(res.payment_days).not.toBe(19);
    expect(res.weekly_offs).toBe(3);              // only the offs they were employed for
  });

  it('a leaver is paid to their last day, not past it', async () => {
    await sundayOff();
    await db('employees').where('id', empId).update({ last_working_day: m(20) });
    const res = await computePayableDays(empId, MAY, MYEAR);
    expect(res.payment_days).toBe(20);
  });

  it('a missed punch pays its configured fraction when there is no allowance', async () => {
    // Fails on the pre-change code: with allowance 0 every day took beyond_pay_fraction (0.5),
    // so pay_fraction was dead and the admin screen displayed a figure nothing used.
    for (const day of [4, 5, 6, 7, 8]) await markM(day, 'miss_punch');
    const res = await computePayableDays(empId, MAY, MYEAR);
    for (const day of [4, 5, 6, 7, 8]) {
      expect(res.trace.find((t) => t.date === m(day))?.lop).toBe(0.25);
    }
    expect(res.lop_days).toBeCloseTo(1.25, 6);
  });

  it('an allowance still tiers when one is configured', async () => {
    await db('attendance_pay_rules').where('code', 'miss_punch')
      .update({ config: JSON.stringify({ allowance: 2, beyond_pay_fraction: 0.5 }) });
    for (const day of [4, 5, 6, 7]) await markM(day, 'miss_punch');
    const res = await computePayableDays(empId, MAY, MYEAR);
    expect([4, 5, 6, 7].map((day) => res.trace.find((t) => t.date === m(day))?.lop))
      .toEqual([0.25, 0.25, 0.5, 0.5]);
    await db('attendance_pay_rules').where('code', 'miss_punch')
      .update({ config: JSON.stringify({ allowance: 0, beyond_pay_fraction: 0.5 }) });
  });

  it('No Punch pays a full day when the rule says so', async () => {
    // The owner: "np is nothing but absent recorded on holiday."
    await sundayOff();
    await markM(4, 'no_punch');                    // a Monday - a scheduled working day
    const res = await computePayableDays(empId, MAY, MYEAR);
    expect(res.trace.find((t) => t.date === m(4))?.lop).toBe(0);
    expect(res.payment_days).toBe(31);
    // And on a rest day it is still a rest day, not an attendance code at all.
    await markM(3, 'no_punch');                    // a Sunday
    const res2 = await computePayableDays(empId, MAY, MYEAR);
    expect(res2.trace.find((t) => t.date === m(3))?.kind).toBe('weekly_off');
  });

  /**
   * The owner's six worked examples, as an executable contract.
   *
   * These are the FINAL sheet: no separate holiday or weekly-off columns, every day of the month
   * carrying exactly one attendance tag (all six rows sum to 31), and Paid Days = 31 minus the
   * shortfall. Weekly offs and holidays are tagged No Punch — "absent recorded on days where
   * there was an off" — which is why No Punch costs nothing.
   *
   * Two tag values differ from the engine's shipped defaults, so this block pins them rather than
   * inheriting: Missed Punch pays 0.5 (not 0.75) and HHD pays 0.25 (not 0.5). Those are the two
   * settings changes the spec asks for, and pinning them here means this contract holds whatever
   * the live Attendance Pay Rules screen currently says.
   */
  describe('the owner\'s six worked examples', () => {
    beforeAll(async () => {
      await db('attendance_pay_rules').where('code', 'miss_punch')
        .update({ pay_fraction: 0.5, config: JSON.stringify({ allowance: 0, beyond_pay_fraction: 0.5 }) });
      await db('attendance_pay_rules').where('code', 'hhd').update({ pay_fraction: 0.25 });
    });

    afterAll(async () => {
      // Hand the rules back exactly as the block above expects to find them.
      await db('attendance_pay_rules').where('code', 'miss_punch')
        .update({ pay_fraction: 0.75, config: JSON.stringify({ allowance: 0, beyond_pay_fraction: 0.5 }) });
      await db('attendance_pay_rules').where('code', 'hhd').update({ pay_fraction: 0.5 });
    });

    const SPEC_ROWS: Array<[string, Record<string, number>, number]> = [
      ['Anvesha', { present: 7, absent: 1, miss_punch: 3, no_punch: 18, hhd: 2 }, 27],
      ['Chirag', { present: 6, absent: 1, no_punch: 22, hhd: 2 }, 28.5],
      ['Raju', { present: 3, half_day: 1, short_punch: 4, miss_punch: 2, no_punch: 18, hhd: 3 }, 25.25],
      ['Tanya', { present: 9, miss_punch: 7, no_punch: 13, hhd: 2 }, 26],
      ['Lalit', { present: 13, half_day: 1, short_punch: 2, miss_punch: 1, no_punch: 9, hhd: 5 }, 25.25],
      ['Anjesh', { present: 3, short_punch: 4, miss_punch: 3, no_punch: 15, hhd: 6 }, 23],
    ];

    it.each(SPEC_ROWS)('%s is paid the right days', async (_name, marks, expected) => {
      let day = 1;
      for (const [status, count] of Object.entries(marks)) {
        for (let i = 0; i < count; i += 1) { await markM(day, status); day += 1; }
      }
      expect(day - 1).toBe(31);   // the sheet's own rule: the tags account for the whole month

      const res = await computePayableDays(empId, MAY, MYEAR);
      // Self-diagnosing: if a stray holiday or off-day rule leaked in, the divisor moves and the
      // paid-days figure below would be wrong for a reason that has nothing to do with the spec.
      expect(res.scheduled_working_days).toBe(31);
      expect(res.working_days).toBe(31);
      expect(res.counts.unmarked).toBe(0);

      expect(res.payment_days).toBe(expected);
      expect(res.payment_days).toBeLessThanOrEqual(31);
    });

    it('perfect attendance pays the whole month — the double-count is gone', async () => {
      // The direct answer to the spreadsheet the spec replaced, where adding holidays and weekly
      // offs on top of a total that already contained them paid 38 days in a 31-day month.
      for (let d = 1; d <= 31; d += 1) await markM(d, 'present');
      const res = await computePayableDays(empId, MAY, MYEAR);
      expect(res.lop_days).toBe(0);
      expect(res.payment_days).toBe(31);
      expect(res.payment_days / res.working_days).toBe(1);   // exactly one month's salary
    });

    it('No Punch costs nothing, so a month of it pays in full', async () => {
      // Why the coverage gate has to count No Punch as unevidenced: on pay alone this is
      // indistinguishable from a month everybody worked.
      for (let d = 1; d <= 31; d += 1) await markM(d, 'no_punch');
      const res = await computePayableDays(empId, MAY, MYEAR);
      expect(res.lop_days).toBe(0);
      expect(res.payment_days).toBe(31);
    });
  });
});
