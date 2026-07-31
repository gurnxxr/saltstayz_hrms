import { describe, it, expect } from 'vitest';
import { judgeDay } from './attendance.calc';

/**
 * The single verdict for a day. This used to be two passes that disagreed — the upload set
 * present / short punch / missed punch from the company grace period, and a separate daily job
 * then re-decided the same day as half day or absent from the shift's hours, looking the shift
 * up somewhere else as it went.
 */
const base = {
  hasIn: true, hasOut: true, workedHours: 8,
  shiftHours: 8, graceMinutes: 15,
  absentHours: 0, halfDayHours: 0,
};

describe('judgeDay — punch-based verdicts come first', () => {
  it('no punches at all is absent', () => {
    expect(judgeDay({ ...base, hasIn: false, hasOut: false, workedHours: 0 })).toBe('absent');
  });

  it('a single punch is a missed punch', () => {
    expect(judgeDay({ ...base, hasOut: false, workedHours: 0 })).toBe('miss_punch');
    expect(judgeDay({ ...base, hasIn: false, workedHours: 0 })).toBe('miss_punch');
  });

  it('leaving early beyond grace is a short punch', () => {
    expect(judgeDay({ ...base, workedHours: 7 })).toBe('short_punch');
  });

  it('within grace is present', () => {
    expect(judgeDay({ ...base, workedHours: 7.75 })).toBe('present'); // 15 minutes short
  });

  it('hours never override a punch-based verdict', () => {
    // A short punch stays a short punch even though the hours would call it a full day —
    // it is a statement about the punches, not about how long someone was there.
    expect(judgeDay({ ...base, workedHours: 7, absentHours: 4, halfDayHours: 6 })).toBe('short_punch');
    // And a missed punch is never turned into an absence by the hour ladder.
    expect(judgeDay({ ...base, hasOut: false, workedHours: 0, absentHours: 4, halfDayHours: 6 }))
      .toBe('miss_punch');
  });
});

describe('judgeDay — the shift hour ladder', () => {
  const ladder = { absentHours: 4, halfDayHours: 6 };

  it('below the absent figure the day does not count', () => {
    expect(judgeDay({ ...base, workedHours: 3.5, shiftHours: 0, ...ladder })).toBe('absent');
  });

  it('between absent and half-day it is half a day', () => {
    expect(judgeDay({ ...base, workedHours: 5, shiftHours: 0, ...ladder })).toBe('half_day');
  });

  it('at or above the half-day figure it is a full day', () => {
    expect(judgeDay({ ...base, workedHours: 6, shiftHours: 0, ...ladder })).toBe('present');
    expect(judgeDay({ ...base, workedHours: 9, shiftHours: 0, ...ladder })).toBe('present');
  });

  it('the boundaries are inclusive upwards', () => {
    expect(judgeDay({ ...base, workedHours: 4, shiftHours: 0, ...ladder })).toBe('half_day');
    expect(judgeDay({ ...base, workedHours: 3.99, shiftHours: 0, ...ladder })).toBe('absent');
  });

  it('only the half-day figure being set still works', () => {
    expect(judgeDay({ ...base, workedHours: 5, shiftHours: 0, absentHours: 0, halfDayHours: 6 }))
      .toBe('half_day');
  });
});

describe('judgeDay — an unconfigured shift never forces "present"', () => {
  it('leaves the punch-based verdict alone when no hours are set', () => {
    // This is the trap the old daily pass fell into: with both figures at their default of 0
    // it computed "present" unconditionally, wiping correctly-identified half-days and
    // absences for every shift that had auto-attendance switched on but no hours filled in.
    expect(judgeDay({ ...base, workedHours: 2, shiftHours: 0 })).toBe('present');
    expect(judgeDay({ ...base, workedHours: 2, shiftHours: 8, graceMinutes: 15 })).toBe('short_punch');
  });

  it('a genuine absence survives when nothing is configured', () => {
    expect(judgeDay({ ...base, hasIn: false, hasOut: false, workedHours: 0 })).toBe('absent');
  });
});

describe('judgeDay — a night shift is judged on hours worked, not clock times', () => {
  it('a full overnight shift is present', () => {
    // 22:00 to 06:00 is 8 hours worked against an 8 hour shift.
    expect(judgeDay({ ...base, workedHours: 8, shiftHours: 8 })).toBe('present');
  });

  it('and a short overnight shift still reads short', () => {
    expect(judgeDay({ ...base, workedHours: 6, shiftHours: 8 })).toBe('short_punch');
  });
});
