import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import db from '../config/database';
import {
  getMyHolidays, createHoliday, uploadHolidaysCSV, getHolidayReach,
} from './leave.service';
import { computePayableDays } from './payableDays.service';

/**
 * What an employee's holiday list actually says — including whether they get the day.
 *
 * The claim this file exists to protect is that the holiday SCREEN and the PAYSLIP cannot
 * disagree. Both read the same work calendar, so a holiday landing on someone's rest day is
 * reported as a rest day here for exactly the same reason it adds no day to their salary
 * divisor in payableDays.db.test.ts. Two people, one holiday, two different answers — get that
 * wrong and the list quietly promises a day off that payroll never gave.
 *
 * It SKIPS unless DATABASE_URL points at a throwaway database whose name contains `hrms_test`
 * or `hrms_qa`, for the same reasons as payableDays.db.test.ts: `npm test` stays runnable with
 * no setup, and the suite can never rewrite rows in a real database by accident.
 */
const TARGET = process.env.DATABASE_URL || '';
const ON_THROWAWAY = /hrms_(test|qa)/.test(TARGET);

const YEAR = '2026';
// 2026-03-21 is a Saturday and 2026-03-22 the Sunday after it — the pair the whole
// "does this person actually get the day" question turns on.
const SATURDAY = '2026-03-21';
const SUNDAY = '2026-03-22';
const A_MONDAY = '2026-03-23';

describe.skipIf(!ON_THROWAWAY)('my holidays — scope, roster verdict and breaks', () => {
  let employeeId: number;
  let propertyId: number;
  // A second employee at a second property in a different department, so the audience tests can
  // assert that ONE holiday reaches one of them and not the other.
  let otherEmployeeId: number;
  let otherPropertyId: number;
  let mgmtDeptId: number;
  let hkDeptId: number;

  beforeAll(async () => {
    // No clamp, so a pattern may speak for any date in the test year.
    await db('pay_schedule_settings').update({ work_pattern_effective_from: null });

    // These tests assert over the WHOLE response — counts, list lengths, available_years — so a
    // seeded holiday left behind in the throwaway database silently breaks them. Clear anything
    // that is not a test fixture, leaving the other DB test's `PDT %` rows alone (vitest runs
    // files concurrently against the same database, so deleting theirs would be a new race).
    await db('holidays')
      .whereNot('name', 'like', 'HDT %')
      .whereNot('name', 'like', 'PDT %')
      .del();

    await db('properties').where('name', 'HDT Property').del();
    const [{ id: pid }] = await db('properties')
      .insert({ name: 'HDT Property', state: 'Karnataka' }).returning('id');
    propertyId = pid;

    await db('properties').where('name', 'HDT Other Property').del();
    const [{ id: opid }] = await db('properties')
      .insert({ name: 'HDT Other Property', state: 'Karnataka' }).returning('id');
    otherPropertyId = opid;

    const dept = async (name: string) => {
      const found = await db('departments').whereRaw('lower(name) = lower(?)', [name]).first();
      if (found) return found.id as number;
      const [{ id }] = await db('departments').insert({ name }).returning('id');
      return id as number;
    };
    mgmtDeptId = await dept('HDT Management');
    hkDeptId = await dept('HDT Housekeeping');

    await db('employees').whereIn('employee_code', ['HDT-001', 'HDT-002']).del();
    const [{ id }] = await db('employees').insert({
      employee_code: 'HDT-001', first_name: 'Holiday', last_name: 'Reader',
      date_of_joining: '2025-01-01', is_active: true,
      branch_name: 'HDT Property', dept_name: 'HDT Management',
    }).returning('id');
    employeeId = id;

    const [{ id: oid }] = await db('employees').insert({
      employee_code: 'HDT-002', first_name: 'Other', last_name: 'Reader',
      date_of_joining: '2025-01-01', is_active: true,
      branch_name: 'HDT Other Property', dept_name: 'HDT Housekeeping',
    }).returning('id');
    otherEmployeeId = oid;
  });

  afterAll(async () => {
    await db('employees').whereIn('id', [employeeId, otherEmployeeId]).del();
    await db('properties').whereIn('id', [propertyId, otherPropertyId]).del();
    await db('departments').whereIn('id', [mgmtDeptId, hkDeptId]).del();
    await db('leave_templates').where('name', 'like', 'HDT %').del();
    await db('holidays').where('name', 'like', 'HDT %').del();
    await db.destroy();
  });

  beforeEach(async () => {
    await db('holidays').where('name', 'like', 'HDT %').del();
    await db('employees').where('id', employeeId).update({
      branch_name: 'HDT Property',
      dept_name: 'HDT Management',
      date_of_joining: '2025-01-01',
      last_working_day: null,
    });
    await db('properties').where('id', propertyId).update({ state: 'Karnataka' });
    // Pin the off-day pattern PER EMPLOYEE rather than relying on the org work week.
    // pay_schedule_settings is a single shared row that payableDays.db.test.ts also rewrites,
    // and vitest runs test files concurrently against the same database — so a global work
    // week is a race. A leave template belongs to this employee alone and cannot be disturbed.
    await onWorkWeek('HDT Mon-Fri', SAT_AND_SUN_OFF);
  });

  /**
   * Insert a holiday. Defaults to "everyone", because most of these tests are about the region
   * axis and the roster verdict, not about targeting — and under opt-in (migration 025) a
   * holiday with no audience reaches nobody, so leaving it off would make every one of them
   * assert on an empty list.
   *
   * Pass `departments` / `properties` to target it; those are the audience tests.
   */
  const holiday = async (
    name: string,
    date: string,
    scope: {
      national?: boolean; state?: string;
      departments?: number[]; properties?: number[];
    } = {},
  ) => {
    const [{ id }] = await db('holidays').insert({
      name, date,
      is_national: !!scope.national,
      state: scope.state ?? null,
      is_recurring: false,
      all_departments: !scope.departments,
      all_properties: !scope.properties,
    }).returning('id');
    for (const department_id of scope.departments ?? []) {
      await db('holiday_departments').insert({ holiday_id: id, department_id });
    }
    for (const property_id of scope.properties ?? []) {
      await db('holiday_properties').insert({ holiday_id: id, property_id });
    }
    return id as number;
  };

  /** Put the employee on a leave template declaring this off-day pattern. */
  async function onWorkWeek(name: string, rules: Array<{ day: number; weeks: number[] | null }>) {
    await db('leave_templates').where('name', name).del();
    const [{ id }] = await db('leave_templates')
      .insert({ name, is_default: false, is_active: true, off_day_rules: JSON.stringify(rules) })
      .returning('id');
    await db('employees').where('id', employeeId).update({ leave_template_id: id });
  }

  const SUNDAY_ONLY_OFF = [{ day: 0, weeks: null }];
  const SAT_AND_SUN_OFF = [{ day: 0, weeks: null }, { day: 6, weeks: null }];

  // ─── the verdict that has to match payroll ───

  it('reports a holiday on a scheduled working day as a day they gain', async () => {
    await holiday('HDT Working Day', A_MONDAY, { national: true });
    const r = await getMyHolidays(employeeId, YEAR);
    const h = r.holidays.find((x) => x.date === A_MONDAY)!;
    expect(h.falls_on).toBe('working');
  });

  it('reports a holiday landing on a rest day as a rest day', async () => {
    // Sat/Sun off, so the Saturday was already theirs.
    await holiday('HDT Rest Day Clash', SATURDAY, { national: true });
    const r = await getMyHolidays(employeeId, YEAR);
    const h = r.holidays.find((x) => x.date === SATURDAY)!;
    expect(h.falls_on).toBe('weekly_off');
    expect(r.counts.rest_day_clashes).toBe(1);
  });

  it('gives two people on different patterns different answers for the SAME holiday', async () => {
    await holiday('HDT Saturday', SATURDAY, { national: true });

    // Five-day week (set in beforeEach): the Saturday was already off.
    const monFri = await getMyHolidays(employeeId, YEAR);
    expect(monFri.holidays.find((x) => x.date === SATURDAY)!.falls_on).toBe('weekly_off');

    // Six-day week, Sunday off only: the same Saturday is a working day they now get back.
    await onWorkWeek('HDT Six Day', SUNDAY_ONLY_OFF);
    const sixDay = await getMyHolidays(employeeId, YEAR);
    const h = sixDay.holidays.find((x) => x.date === SATURDAY)!;
    expect(h.falls_on).toBe('working');
    expect(h.decided_by_name).toBe('HDT Six Day');
    expect(sixDay.counts.rest_day_clashes).toBe(0);
  });

  // ─── breaks ───

  it('measures a long weekend and stops at the working day either side', async () => {
    // Fri holiday + Sat/Sun already off = a three-day break.
    await holiday('HDT Friday', '2026-03-20', { national: true });
    const r = await getMyHolidays(employeeId, YEAR);
    const h = r.holidays.find((x) => x.date === '2026-03-20')!;
    expect(h.break_start).toBe('2026-03-20');
    expect(h.break_end).toBe(SUNDAY);
    expect(h.break_days).toBe(3);
    expect(h.break_bounded).toBe(false);
    expect(r.counts.long_weekends).toBe(1);
  });

  it('counts one long weekend, not two, when two holidays share a run', async () => {
    await holiday('HDT Thursday', '2026-03-19', { national: true });
    await holiday('HDT Friday', '2026-03-20', { national: true });
    const r = await getMyHolidays(employeeId, YEAR);
    const [a, b] = ['2026-03-19', '2026-03-20'].map((d) => r.holidays.find((x) => x.date === d)!);
    expect(a.break_start).toBe(b.break_start);
    expect(a.break_days).toBe(4);
    expect(r.counts.long_weekends).toBe(1);
  });

  // ─── audience: departments and properties (migration 025) ───

  it('gives a department-targeted holiday only to that department', async () => {
    await holiday('HDT Diwali', A_MONDAY, { national: true, departments: [mgmtDeptId] });

    const mgmt = await getMyHolidays(employeeId, YEAR);
    expect(mgmt.holidays.map((h) => h.name)).toContain('HDT Diwali');

    // Housekeeping does not see it at all — decision 3 hides it rather than showing a
    // "you're working this one" row.
    const hk = await getMyHolidays(otherEmployeeId, YEAR);
    expect(hk.holidays.map((h) => h.name)).not.toContain('HDT Diwali');
  });

  it('the holiday screen and the PAYSLIP agree about who got the day', async () => {
    // The whole reason the predicate is one shared function. A holiday the list shows and the
    // pay engine ignores (or the reverse) is the failure this asserts cannot happen.
    await holiday('HDT Diwali', A_MONDAY, { national: true, departments: [mgmtDeptId] });
    const [y, m] = A_MONDAY.split('-').map(Number);

    const mgmtDays = await computePayableDays(employeeId, m, y);
    expect(mgmtDays.trace.find((t) => t.date === A_MONDAY)?.kind).toBe('holiday');

    const hkDays = await computePayableDays(otherEmployeeId, m, y);
    // Not a holiday for them — an ordinary working day they must be marked present for.
    expect(hkDays.trace.find((t) => t.date === A_MONDAY)?.kind).toBe('working');
  });

  it('gives a property-targeted holiday only to that property', async () => {
    // Both national, so the region axis cannot be what is doing the filtering.
    await holiday('HDT Local Fair', A_MONDAY, { national: true, properties: [propertyId] });
    expect((await getMyHolidays(employeeId, YEAR)).holidays.map((h) => h.name))
      .toContain('HDT Local Fair');
    expect((await getMyHolidays(otherEmployeeId, YEAR)).holidays.map((h) => h.name))
      .not.toContain('HDT Local Fair');
  });

  it('ANDs the two axes — the wrong department at the right property still misses it', async () => {
    await holiday('HDT Both', A_MONDAY, {
      national: true, departments: [mgmtDeptId], properties: [propertyId],
    });
    // Management at the right property: yes.
    expect((await getMyHolidays(employeeId, YEAR)).holidays.map((h) => h.name)).toContain('HDT Both');

    // Right department, wrong property: no.
    await db('employees').where('id', otherEmployeeId).update({ dept_name: 'HDT Management' });
    expect((await getMyHolidays(otherEmployeeId, YEAR)).holidays.map((h) => h.name))
      .not.toContain('HDT Both');

    // Right property, wrong department: also no.
    await db('employees').where('id', otherEmployeeId)
      .update({ branch_name: 'HDT Property', dept_name: 'HDT Housekeeping' });
    expect((await getMyHolidays(otherEmployeeId, YEAR)).holidays.map((h) => h.name))
      .not.toContain('HDT Both');

    await db('employees').where('id', otherEmployeeId)
      .update({ branch_name: 'HDT Other Property', dept_name: 'HDT Housekeeping' });
  });

  it('a holiday with no audience at all reaches nobody', async () => {
    // Opt-in at the data layer: this is the state a raw insert or an old script produces, and
    // it must fail safe rather than quietly giving everyone a paid day off.
    const [{ id }] = await db('holidays').insert({
      name: 'HDT Orphan', date: A_MONDAY, is_national: true, is_recurring: false,
      all_departments: false, all_properties: false,
    }).returning('id');
    expect(id).toBeGreaterThan(0);

    for (const emp of [employeeId, otherEmployeeId]) {
      expect((await getMyHolidays(emp, YEAR)).holidays.map((h) => h.name)).not.toContain('HDT Orphan');
    }
  });

  it('reports a department that matches no catalog row, and still gives the general holidays', async () => {
    await db('employees').where('id', employeeId).update({ dept_name: 'Guest Relations' });
    await holiday('HDT Everyone', A_MONDAY, { national: true });
    await holiday('HDT Managers Only', '2026-03-24', { national: true, departments: [mgmtDeptId] });

    const r = await getMyHolidays(employeeId, YEAR);
    expect(r.dept_status).toBe('department_not_matched');
    expect(r.dept_name).toBe('Guest Relations');            // quoted back, so HR can fix it
    expect(r.holidays.map((h) => h.name)).toContain('HDT Everyone');
    expect(r.holidays.map((h) => h.name)).not.toContain('HDT Managers Only');
  });

  it('reports an empty department on the profile', async () => {
    await db('employees').where('id', employeeId).update({ dept_name: null });
    const r = await getMyHolidays(employeeId, YEAR);
    expect(r.dept_status).toBe('no_department_on_profile');
  });

  it('separates "published but not for you" from "nothing published"', async () => {
    // Holidays exist for the year; none of them reach this person.
    await holiday('HDT Managers Only', A_MONDAY, { national: true, departments: [mgmtDeptId] });
    const r = await getMyHolidays(otherEmployeeId, YEAR);
    expect(r.holidays).toHaveLength(0);
    expect(r.scope_status).toBe('no_holidays_for_you');
  });

  it('keeps available_years behind the same filter as the list', async () => {
    // Otherwise the year arrow offers a year that then claims HR published nothing.
    await holiday('HDT Next Year Managers', '2027-01-04', {
      national: true, departments: [mgmtDeptId],
    });
    expect((await getMyHolidays(employeeId, YEAR)).available_years).toContain(2027);
    expect((await getMyHolidays(otherEmployeeId, YEAR)).available_years).not.toContain(2027);
  });

  // ─── writes ───

  it('refuses to save a holiday that would reach nobody', async () => {
    const base = { name: 'HDT Nobody', date: A_MONDAY, is_national: true, all_properties: true };
    // "Only some departments" with nothing picked is a null choice, not a saved holiday.
    await expect(createHoliday({ ...base, all_departments: false, department_ids: [] }))
      .rejects.toThrow(/departments this holiday applies to/i);
    await expect(createHoliday({
      ...base, all_departments: true, all_properties: false, property_ids: [],
    })).rejects.toThrow(/properties this holiday applies to/i);
  });

  it('clears a stale selection when "everyone" is ticked', async () => {
    const saved: any = await createHoliday({
      name: 'HDT Everyone', date: A_MONDAY, is_national: true,
      all_departments: true, department_ids: [mgmtDeptId],   // ids alongside "all" are discarded
      all_properties: true,
    });
    expect(saved.all_departments).toBe(true);
    expect(saved.department_ids).toEqual([]);
  });

  it('rejects a department id that no longer exists rather than dropping it', async () => {
    // Dropping it would narrow the audience silently — the opposite of what the admin asked for.
    await expect(createHoliday({
      name: 'HDT Ghost', date: A_MONDAY, is_national: true,
      all_departments: false, department_ids: [mgmtDeptId, 999_999],
      all_properties: true,
    })).rejects.toThrow(/no longer exists/i);
  });

  it('CSV replace removes only the SAME audience, sparing a hand-made restricted holiday', async () => {
    // The sharp edge: the old code deleted every row for the state, so re-uploading the list
    // would take out a targeted holiday somebody set up by hand.
    await holiday('HDT Karnataka Managers', '2026-05-04', {
      state: 'Karnataka', departments: [mgmtDeptId],
    });
    await holiday('HDT Karnataka All', '2026-05-05', { state: 'Karnataka' });

    const res = await uploadHolidaysCSV(
      'Holiday Name,Date\nHDT Karnataka Fresh,2026-05-06\n',
      {
        state: 'Karnataka', all_departments: true, all_properties: true, mode: 'replace',
      },
    );
    expect(res.replaced).toBe(1);          // only the all/all row
    expect(res.inserted).toBe(1);

    const names = await db('holidays').where('name', 'like', 'HDT Karnataka%').pluck('name');
    expect(names).toContain('HDT Karnataka Managers');   // survived
    expect(names).toContain('HDT Karnataka Fresh');
    expect(names).not.toContain('HDT Karnataka All');
  });

  it('CSV defaults to appending and deletes nothing', async () => {
    await holiday('HDT Karnataka All', '2026-05-05', { state: 'Karnataka' });
    const res = await uploadHolidaysCSV('Holiday Name,Date\nHDT Karnataka Extra,2026-05-07\n', {
      state: 'Karnataka', all_departments: true, all_properties: true,
    });
    expect(res.mode).toBe('append');
    expect(res.replaced).toBe(0);
    expect(await db('holidays').where('name', 'like', 'HDT Karnataka%').pluck('name'))
      .toContain('HDT Karnataka All');
  });

  it('counts how many real people a holiday reaches', async () => {
    const id = await holiday('HDT Managers Only', A_MONDAY, {
      national: true, departments: [mgmtDeptId],
    });
    // Cross-check: the employee-side count must agree with the holiday-side predicate.
    const reach = await getHolidayReach(id);
    const seenBy = (await Promise.all([employeeId, otherEmployeeId].map(async (e) =>
      (await getMyHolidays(e, YEAR)).holidays.some((h) => h.name === 'HDT Managers Only'))))
      .filter(Boolean).length;
    expect(reach).toBe(seenBy);
    expect(reach).toBe(1);
  });

  // ─── scope ───

  it('includes the employee state and excludes another state', async () => {
    await holiday('HDT Karnataka Day', A_MONDAY, { state: 'Karnataka' });
    await holiday('HDT Kerala Day', '2026-03-24', { state: 'Kerala' });
    const r = await getMyHolidays(employeeId, YEAR);
    const names = r.holidays.map((h) => h.name);
    expect(names).toContain('HDT Karnataka Day');
    expect(names).not.toContain('HDT Kerala Day');
    expect(r.scope_status).toBe('ok');
  });

  it('says the profile has no work location when branch_name is empty', async () => {
    await db('employees').where('id', employeeId).update({ branch_name: null });
    await holiday('HDT National', A_MONDAY, { national: true });
    const r = await getMyHolidays(employeeId, YEAR);
    expect(r.scope_status).toBe('no_branch_on_profile');
    // National holidays still come back — the list is incomplete, not empty.
    expect(r.holidays).toHaveLength(1);
  });

  it('echoes the branch name back when it matches no property', async () => {
    await db('employees').where('id', employeeId).update({ branch_name: 'Delhi Aerocity' });
    await holiday('HDT National', A_MONDAY, { national: true });
    const r = await getMyHolidays(employeeId, YEAR);
    expect(r.scope_status).toBe('branch_not_matched');
    // Quoting the offending value is what makes this fixable in one message to HR.
    expect(r.branch_name).toBe('Delhi Aerocity');
    expect(r.holidays).toHaveLength(1);
  });

  it('flags a property with no state, and shows national only', async () => {
    await db('properties').where('id', propertyId).update({ state: null });
    await holiday('HDT National', A_MONDAY, { national: true });
    await holiday('HDT Karnataka Day', '2026-03-24', { state: 'Karnataka' });
    const r = await getMyHolidays(employeeId, YEAR);
    expect(r.scope_status).toBe('no_state_on_property');
    expect(r.holidays.map((h) => h.name)).toEqual(['HDT National']);
  });

  it('separates "nothing published" from a broken profile', async () => {
    const r = await getMyHolidays(employeeId, '2031');
    expect(r.scope_status).toBe('no_holidays_published');
    expect(r.holidays).toHaveLength(0);
  });

  // ─── counting and employment span ───

  it('counts a shared date once, but keeps both rows', async () => {
    await holiday('HDT National', A_MONDAY, { national: true });
    await holiday('HDT Karnataka Day', A_MONDAY, { state: 'Karnataka' });
    const r = await getMyHolidays(employeeId, YEAR);
    expect(r.holidays).toHaveLength(2);
    expect(r.counts.total).toBe(1);           // one day off, not two
    expect(r.holidays[0].is_national).toBe(true);   // stable order: national first
  });

  it('marks a holiday before joining, and leaves it out of what remains', async () => {
    await db('employees').where('id', employeeId).update({ date_of_joining: '2026-06-01' });
    await holiday('HDT Before Joining', A_MONDAY, { national: true });
    const r = await getMyHolidays(employeeId, YEAR);
    const h = r.holidays.find((x) => x.date === A_MONDAY)!;
    expect(h.in_employment).toBe(false);
    expect(h.employment_note).toContain('Joined');
    expect(h.break_days).toBe(0);
    expect(r.counts.remaining).toBe(0);
  });

  // ─── request handling ───

  it('defaults to the current year and rejects a year that is not one', async () => {
    const r = await getMyHolidays(employeeId);
    expect(r.year).toBe(new Date().toISOString().slice(0, 4));
    await expect(getMyHolidays(employeeId, 'banana')).rejects.toThrow(/four-digit year/);
  });

  it('reports which years actually have holidays for this person', async () => {
    await holiday('HDT National', A_MONDAY, { national: true });
    await holiday('HDT Next Year', '2027-01-01', { national: true });
    const r = await getMyHolidays(employeeId, YEAR);
    expect(r.available_years).toEqual([2026, 2027]);
  });
});
