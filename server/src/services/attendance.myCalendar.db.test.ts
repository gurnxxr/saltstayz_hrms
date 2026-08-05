import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import db from '../config/database';
import { getMyCalendar } from './attendance.service';

/**
 * The calendar has to answer the roster question for days the employee was not there for.
 *
 * `kind` is what an employee should SEE: a day before they joined reads `not_employed`, whatever
 * the roster would have said, and that is right for a calendar. But it is the ONLY thing the
 * response carried, and the dashboard's Weekly Off card reads a weekly pattern back out of a
 * month of these days — so with `kind` alone, every day before someone's joining date is a day the
 * pattern cannot see.
 *
 * That is not a rounding error. Take the arrangement below — every Sunday off, plus the 2nd and 4th
 * Saturday — and somebody who joined on 20 June 2026. June's Saturdays are the 6th, 13th, 20th and
 * 27th, so the two rest Saturdays are the 13th and the 27th. Read off `kind`, the 13th is invisible
 * and the only Saturdays left are the 20th (working) and the 27th (off): the pattern reads as "the
 * 4th Saturday", and the employee is told to come in on a Saturday they have off. `base` is the
 * fix — `classify` computes it from the off-day policy before the employment span is consulted, so
 * it is available for every day of the month at no cost.
 *
 * Skips unless DATABASE_URL points at a throwaway database named `hrms_test` or `hrms_qa`, for the
 * same two reasons as payableDays.db.test.ts: `npm test` stays runnable with no setup, and the
 * suite can never rewrite rows in a real database by accident.
 */
const TARGET = process.env.DATABASE_URL || '';
const ON_THROWAWAY = /hrms_(test|qa)/.test(TARGET);

const YEAR = 2026;
const MONTH = '2026-06';
const d = (day: number) => `${YEAR}-06-${String(day).padStart(2, '0')}`;

// Saturdays 6 / 13 / 20 / 27 are the 1st / 2nd / 3rd / 4th of the month; Sundays 7 / 14 / 21 / 28.
// The occurrence is positional — the 8th of any month is the 2nd of its weekday.
const SUNDAY_PLUS_ALT_SATURDAY = [{ day: 0, weeks: null }, { day: 6, weeks: [2, 4] }];
const JOINED = d(20);

describe.skipIf(!ON_THROWAWAY)('my calendar — the roster verdict outlives the employment span', () => {
  let employeeId: number;
  let days: any[];

  beforeAll(async () => {
    // No clamp, or `rulesInForceOn` refuses to apply the pattern to a 2026 date at all.
    await db('pay_schedule_settings').update({ work_pattern_effective_from: null });
    // A holiday would make its day `base: 'holiday'` and break the working/rest split asserted below.
    await db('holidays').whereBetween('date', [d(1), d(30)]).del();

    await db('employees').where('employee_code', 'MCT-001').del();
    const [{ id }] = await db('employees').insert({
      employee_code: 'MCT-001', first_name: 'Mid', last_name: 'Joiner',
      date_of_joining: JOINED, is_active: true,
    }).returning('id');
    employeeId = id;

    await db('leave_templates').where('name', 'MCT Alt Saturday').del();
    const [{ id: templateId }] = await db('leave_templates').insert({
      name: 'MCT Alt Saturday', is_default: false, is_active: true,
      off_day_rules: JSON.stringify(SUNDAY_PLUS_ALT_SATURDAY),
    }).returning('id');
    await db('employees').where('id', employeeId).update({ leave_template_id: templateId });

    days = (await getMyCalendar(employeeId, MONTH)).days;
  });

  afterAll(async () => {
    await db('employees').where('id', employeeId).del();
    await db('leave_templates').where('name', 'MCT Alt Saturday').del();
    await db.destroy();
  });

  const on = (day: number) => days.find((x) => x.date === d(day));

  it('answers for every day of the month', () => {
    expect(days).toHaveLength(30);
    // No day may be missing a roster verdict — that is the property the pattern derivation needs.
    expect(days.every((x) => ['working', 'weekly_off', 'holiday'].includes(x.base))).toBe(true);
  });

  it('still shows the days before joining as not employed', () => {
    expect(on(19)!.kind).toBe('not_employed');
    expect(on(20)!.kind).not.toBe('not_employed');
  });

  it('keeps the rest-day verdict on a rest day BEFORE the joining date', () => {
    // The 13th is the 2nd Saturday — a rest day under this pattern, and eight days before this
    // person started. `kind` hides it; `base` is what makes the pattern readable anyway.
    expect(on(13)!.kind).toBe('not_employed');
    expect(on(13)!.base).toBe('weekly_off');
  });

  it('reads the whole 2nd-and-4th-Saturday pattern, not just the part after joining', () => {
    expect([6, 13, 20, 27].map((day) => on(day)!.base))
      .toEqual(['working', 'weekly_off', 'working', 'weekly_off']);
  });

  it('marks every Sunday as a rest day, either side of the joining date', () => {
    expect([7, 14, 21, 28].map((day) => on(day)!.base))
      .toEqual(['weekly_off', 'weekly_off', 'weekly_off', 'weekly_off']);
  });

  it('names the rung that decided it, as an enum and not just a label', () => {
    // The employee's OWN leave template, so `template` rather than `default_template`. A screen
    // asking "did the shift set this?" branches on this, never on the display name.
    expect(on(27)!.decided_by).toBe('template');
    expect(on(27)!.decided_by_name).toBe('MCT Alt Saturday');
  });
});
