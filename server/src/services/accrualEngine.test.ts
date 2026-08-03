import { describe, it, expect } from 'vitest';
import {
  addMonthsClamped, buildSchedule, creditForMonth, cumulativeDays, monthsOfService, round6,
  spendableDays,
} from './accrualEngine';

/** A full leave period, so a test only has to say what it is actually about. */
const PERIOD = { periodStart: '2026-04-01', periodEnd: '2027-03-31' };
const rule = (over: Partial<Parameters<typeof buildSchedule>[0]['rule']> = {}) => ({
  daysPerYear: 12, waitingMonths: 0, carryForwardMax: null, maxBalance: null, ...over,
});

/**
 * Adds credits the way the two things that actually add them do: `buildSchedule`, which rounds its
 * running total at every step, and Postgres, which sums a `numeric` column as exact decimal.
 *
 * A plain `a + b` reduce does NOT hold. Twelve credits of 7/12 come to 6.999999999999999 in binary
 * floating point, and that floors to 6 — an employee shown a day less than they earned. The
 * exactness this feature promises lives in `round6` and in the `numeric(10,6)` column, and a test
 * helper that quietly used doubles would be testing something the code never does.
 */
const sum = (ns: number[]) => ns.reduce((a, b) => round6(a + b), 0);

describe('addMonthsClamped', () => {
  it('keeps the day of the month', () => {
    expect(addMonthsClamped('2026-01-15', 1)).toBe('2026-02-15');
    expect(addMonthsClamped('2026-01-15', 12)).toBe('2027-01-15');
  });

  it('clamps 31 January to the end of February, and does not drift afterwards', () => {
    // The bug this exists to prevent: +1 month via setMonth gives 3 March, and the anniversary
    // then walks forward a few days every year.
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2026-01-31', 2)).toBe('2026-03-31');
    expect(addMonthsClamped('2026-01-31', 3)).toBe('2026-04-30');
    expect(addMonthsClamped('2026-01-31', 4)).toBe('2026-05-31');
  });

  it('knows February has 29 days in a leap year', () => {
    expect(addMonthsClamped('2028-01-30', 1)).toBe('2028-02-29');
  });

  it('rolls the year over', () => {
    expect(addMonthsClamped('2026-11-20', 3)).toBe('2027-02-20');
  });
});

describe('the annual figure survives being paid monthly', () => {
  it('twelve credits of 1.25 come to exactly 15', () => {
    const credits = Array.from({ length: 12 }, (_, i) => creditForMonth(15, i + 1));
    expect(credits.every((c) => c === 1.25)).toBe(true);
    expect(sum(credits)).toBe(15);
  });

  it('ten days a year still delivers ten, despite 10/12 being a recurring decimal', () => {
    // Naively rounding 0.8333… to six places twelve times gives 9.999996, which floors to 9 and
    // quietly costs the employee a day. The credits alternate instead, and telescope.
    const credits = Array.from({ length: 12 }, (_, i) => creditForMonth(10, i + 1));
    expect(new Set(credits)).toEqual(new Set([0.833333, 0.833334]));
    expect(sum(credits)).toBe(10);
    expect(spendableDays(sum(credits))).toBe(10);
  });

  it('any twelve consecutive credits come to a year, not just the first twelve', () => {
    // Year four of a career, so the cumulative figure is large and its fractional part still lines up.
    const credits = Array.from({ length: 12 }, (_, i) => creditForMonth(7, 37 + i));
    expect(sum(credits)).toBe(7);
  });

  it('cumulative and per-month agree', () => {
    expect(sum(Array.from({ length: 5 }, (_, i) => creditForMonth(12, i + 1)))).toBe(cumulativeDays(12, 5));
  });
});

describe('spendableDays', () => {
  it('floors, so nobody is offered a quarter of a day', () => {
    expect(spendableDays(5.25)).toBe(5);
    expect(spendableDays(0.833333)).toBe(0);
  });

  it('does not lose a whole day to float drift', () => {
    expect(spendableDays(14.999999999999998)).toBe(15);
  });
});

describe('buildSchedule — when the credits land', () => {
  it('a 15 January joiner earns on the 15th, not the 1st', () => {
    const s = buildSchedule({
      dateOfJoining: '2026-01-15', rule: rule(), ...PERIOD, asOf: '2026-08-03',
    });
    expect(s.credits.map((c) => c.credited_on)).toEqual([
      '2026-04-15', '2026-05-15', '2026-06-15', '2026-07-15',
    ]);
    expect(s.next_credit_on).toBe('2026-08-15');
  });

  it('a 31 January joiner is credited on 28 February', () => {
    const s = buildSchedule({
      dateOfJoining: '2026-01-31', rule: rule(),
      periodStart: '2026-01-01', periodEnd: '2026-12-31', asOf: '2026-03-15',
    });
    expect(s.credits.map((c) => c.credited_on)).toEqual(['2026-02-28']);
  });

  it('credits nothing before the first anniversary', () => {
    const s = buildSchedule({
      dateOfJoining: '2026-07-20', rule: rule(), ...PERIOD, asOf: '2026-08-03',
    });
    expect(s.credits).toEqual([]);
    expect(s.accrued).toBe(0);
    expect(s.next_credit_on).toBe('2026-08-20');
  });

  it('stops at the period end even when asked about a date beyond it', () => {
    const s = buildSchedule({
      dateOfJoining: '2020-06-10', rule: rule(), ...PERIOD, asOf: '2030-01-01',
    });
    expect(s.credits).toHaveLength(12);
    expect(s.credits[11].credited_on).toBe('2027-03-10');
    expect(s.accrued).toBe(12);
  });
});

describe('buildSchedule — the waiting period', () => {
  it('earns nothing for the first N months, then a normal month', () => {
    const s = buildSchedule({
      dateOfJoining: '2026-04-10', rule: rule({ waitingMonths: 3 }), ...PERIOD, asOf: '2026-09-30',
    });
    // Months 1–3 (May, June, July) forfeit; August and September earn.
    expect(s.credits.map((c) => c.credited_on)).toEqual(['2026-08-10', '2026-09-10']);
    expect(s.credits.map((c) => c.month_index)).toEqual([4, 5]);
  });

  it('the waiting months are forfeited, not deferred', () => {
    const s = buildSchedule({
      dateOfJoining: '2026-04-10', rule: rule({ waitingMonths: 3 }), ...PERIOD, asOf: '2026-08-10',
    });
    expect(s.accrued).toBe(1); // one month at 12/year, not four
  });

  it('names the first EARNING anniversary as the next credit, not the next anniversary', () => {
    const s = buildSchedule({
      dateOfJoining: '2026-04-10', rule: rule({ waitingMonths: 3 }), ...PERIOD, asOf: '2026-05-01',
    });
    expect(s.credits).toEqual([]);
    expect(s.next_credit_on).toBe('2026-08-10');
  });
});

describe('buildSchedule — prior service and carry-forward', () => {
  const longServer = { dateOfJoining: '2019-06-10', ...PERIOD, asOf: '2026-08-03' };

  it('lapses everything earned before the period when no carry-forward is configured', () => {
    const s = buildSchedule({ ...longServer, rule: rule({ carryForwardMax: null }) });
    expect(s.prior_accrued).toBeGreaterThan(80); // ~7 years at 12/year
    expect(s.opening).toBe(0);
    expect(s.accrued).toBe(4); // April, May, June, July of this period
  });

  it('carries forward up to the limit and lapses the rest', () => {
    const s = buildSchedule({ ...longServer, rule: rule({ carryForwardMax: 10 }) });
    expect(s.opening).toBe(10);
    expect(s.accrued).toBe(14);
  });

  it('never carries forward more than was actually earned', () => {
    // Joined two months before the period started, so there are two months to carry, not ten.
    const s = buildSchedule({
      dateOfJoining: '2026-01-10', rule: rule({ carryForwardMax: 10 }), ...PERIOD, asOf: '2026-08-03',
    });
    expect(s.prior_accrued).toBe(2); // February and March
    expect(s.opening).toBe(2);
  });
});

describe('buildSchedule — the ceiling', () => {
  it('trims the credit that would breach it and reports that it bit', () => {
    const s = buildSchedule({
      dateOfJoining: '2020-01-10', rule: rule({ carryForwardMax: 10, maxBalance: 12 }),
      ...PERIOD, asOf: '2026-08-03',
    });
    expect(s.opening).toBe(10);
    // April and May bring it to 12; June and July have nowhere to go.
    expect(s.credits.map((c) => c.credited_on)).toEqual(['2026-04-10', '2026-05-10']);
    expect(s.accrued).toBe(12);
    expect(s.capped).toBe(true);
  });

  it('trims a credit part-way rather than dropping it', () => {
    const s = buildSchedule({
      dateOfJoining: '2020-01-10', rule: rule({ carryForwardMax: 10, maxBalance: 10.5 }),
      ...PERIOD, asOf: '2026-08-03',
    });
    expect(s.credits).toHaveLength(1);
    expect(s.credits[0].days).toBe(0.5);
    expect(s.accrued).toBe(10.5);
  });

  it('leaves an uncapped rule alone', () => {
    const s = buildSchedule({
      dateOfJoining: '2026-03-10', rule: rule(), ...PERIOD, asOf: '2027-03-31',
    });
    expect(s.capped).toBe(false);
    expect(s.accrued).toBe(12);
  });
});

describe('buildSchedule — refusing to guess', () => {
  it('returns nothing for a missing or malformed joining date', () => {
    for (const bad of ['', 'not-a-date', '2026-13-99x']) {
      expect(buildSchedule({ dateOfJoining: bad, rule: rule(), ...PERIOD, asOf: '2026-08-03' }).accrued).toBe(0);
    }
  });

  it('returns nothing when the annual figure is zero', () => {
    const s = buildSchedule({
      dateOfJoining: '2020-01-10', rule: rule({ daysPerYear: 0 }), ...PERIOD, asOf: '2026-08-03',
    });
    expect(s.credits).toEqual([]);
    expect(s.next_credit_on).toBeNull();
  });

  it('returns nothing for someone who joins after the period ends', () => {
    const s = buildSchedule({
      dateOfJoining: '2028-01-01', rule: rule(), ...PERIOD, asOf: '2026-08-03',
    });
    expect(s.accrued).toBe(0);
  });
});

describe('monthsOfService', () => {
  it('counts completed months', () => {
    expect(monthsOfService('2026-01-15', '2026-08-03')).toBe(6);
    expect(monthsOfService('2026-01-15', '2026-08-15')).toBe(7);
  });

  it('agrees with the clamped anniversary at a month end', () => {
    // 28 February IS the anniversary of 31 January, so a month is complete on it.
    expect(monthsOfService('2026-01-31', '2026-02-28')).toBe(1);
    expect(monthsOfService('2026-01-31', '2026-02-27')).toBe(0);
  });

  it('is zero before the joining date', () => {
    expect(monthsOfService('2026-08-01', '2026-01-01')).toBe(0);
  });
});
