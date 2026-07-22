import { describe, it, expect } from 'vitest';
import {
  dayOfWeek, occurrenceInMonth, parseOffDayRules, isOffDay, shiftLengthHours, fullDayHoursFor,
  pickAssignmentFor,
} from './shiftPattern';

describe('pickAssignmentFor', () => {
  const a = (effective_from: string, name: string) => ({ effective_from, name });
  const TODAY = '2026-07-22';

  it('picks the assignment in effect on the date', () => {
    const rows = [a('2026-01-01', 'Morning'), a('2026-06-01', 'Night')];
    expect(pickAssignmentFor(rows, '2026-03-15', TODAY)?.name).toBe('Morning');
    expect(pickAssignmentFor(rows, '2026-06-01', TODAY)?.name).toBe('Night');
    expect(pickAssignmentFor(rows, '2026-07-22', TODAY)?.name).toBe('Night');
  });

  it('falls back to the earliest for dates older than the mapping itself', () => {
    // The mapping was only recorded in June; May attendance still needs a shift.
    const rows = [a('2026-06-01', 'Morning')];
    expect(pickAssignmentFor(rows, '2026-05-10', TODAY)?.name).toBe('Morning');
  });

  it('does NOT let a future-dated assignment govern the past', () => {
    // Approving a shift-change request forces a date of today or later. If that is someone's
    // only assignment, the earliest-fallback would otherwise back-apply September's shift to
    // every month of their history and silently move their payable days.
    const rows = [a('2026-09-01', 'Night')];
    expect(pickAssignmentFor(rows, '2026-07-11', TODAY)).toBeNull();
    expect(pickAssignmentFor(rows, '2026-06-01', TODAY)).toBeNull();
    // It does apply once it starts.
    expect(pickAssignmentFor(rows, '2026-09-01', TODAY)?.name).toBe('Night');
    expect(pickAssignmentFor(rows, '2026-10-05', TODAY)?.name).toBe('Night');
  });

  it('still backfills from the earliest STARTED assignment when a later one is future-dated', () => {
    const rows = [a('2026-06-01', 'Morning'), a('2026-09-01', 'Night')];
    expect(pickAssignmentFor(rows, '2026-04-02', TODAY)?.name).toBe('Morning');
    expect(pickAssignmentFor(rows, '2026-07-22', TODAY)?.name).toBe('Morning');
    expect(pickAssignmentFor(rows, '2026-09-02', TODAY)?.name).toBe('Night');
  });

  it('returns null with no assignments at all', () => {
    expect(pickAssignmentFor([], '2026-07-22', TODAY)).toBeNull();
  });

  it('tolerates timestamps and reads only the date part', () => {
    const rows = [{ effective_from: '2026-06-01T00:00:00.000Z', name: 'Morning' }];
    expect(pickAssignmentFor(rows, '2026-07-01', TODAY)?.name).toBe('Morning');
  });
});

describe('dayOfWeek', () => {
  it('reads the weekday without timezone drift', () => {
    expect(dayOfWeek('2026-07-19')).toBe(0); // Sunday
    expect(dayOfWeek('2026-07-20')).toBe(1); // Monday
    expect(dayOfWeek('2026-07-25')).toBe(6); // Saturday
  });

  it('ignores anything after the date part', () => {
    expect(dayOfWeek('2026-07-25T23:59:59Z')).toBe(6);
  });
});

describe('occurrenceInMonth', () => {
  it('counts which occurrence of its weekday a date is', () => {
    expect(occurrenceInMonth('2026-08-01')).toBe(1); // 1st Saturday
    expect(occurrenceInMonth('2026-08-08')).toBe(2);
    expect(occurrenceInMonth('2026-08-15')).toBe(3);
    expect(occurrenceInMonth('2026-08-22')).toBe(4);
    expect(occurrenceInMonth('2026-08-29')).toBe(5);
  });

  it('is positional, so the 7th is always the 1st of its weekday', () => {
    expect(occurrenceInMonth('2026-08-07')).toBe(1);
    expect(occurrenceInMonth('2026-08-09')).toBe(2);
  });
});

describe('parseOffDayRules', () => {
  it('accepts a parsed array', () => {
    expect(parseOffDayRules([{ day: 0, weeks: null }])).toEqual([{ day: 0, weeks: null }]);
  });

  it('accepts JSON text, for a value that never went through jsonb', () => {
    expect(parseOffDayRules('[{"day":6,"weeks":[2,4]}]')).toEqual([{ day: 6, weeks: [2, 4] }]);
  });

  it('treats an empty week list as every week', () => {
    expect(parseOffDayRules([{ day: 3, weeks: [] }])).toEqual([{ day: 3, weeks: null }]);
  });

  it('drops entries that could not be applied', () => {
    expect(parseOffDayRules([{ day: 9 }, { day: -1 }, { day: 2 }])).toEqual([{ day: 2, weeks: null }]);
    expect(parseOffDayRules([{ day: 6, weeks: [0, 7, 3] }])).toEqual([{ day: 6, weeks: [3] }]);
  });

  it('returns nothing for junk rather than throwing', () => {
    expect(parseOffDayRules(null)).toEqual([]);
    expect(parseOffDayRules('not json')).toEqual([]);
    expect(parseOffDayRules({ day: 1 })).toEqual([]);
  });
});

describe('isOffDay', () => {
  const everySunday = [{ day: 0, weeks: null }];
  const sundayPlusAlternateSaturday = [
    { day: 0, weeks: null },
    { day: 6, weeks: [2, 4] },
  ];

  it('an empty pattern makes nothing an off day', () => {
    // The caller falls back to the company work week; it must NOT mean "works every day".
    expect(isOffDay('2026-07-19', [])).toBe(false);
  });

  it('matches a weekday every week', () => {
    expect(isOffDay('2026-07-19', everySunday)).toBe(true);  // Sunday
    expect(isOffDay('2026-07-20', everySunday)).toBe(false); // Monday
    expect(isOffDay('2026-07-26', everySunday)).toBe(true);  // next Sunday
  });

  it('handles the 2nd and 4th Saturday arrangement', () => {
    // August 2026: Saturdays fall on 1, 8, 15, 22, 29.
    expect(isOffDay('2026-08-01', sundayPlusAlternateSaturday)).toBe(false); // 1st Sat — working
    expect(isOffDay('2026-08-08', sundayPlusAlternateSaturday)).toBe(true);  // 2nd Sat — off
    expect(isOffDay('2026-08-15', sundayPlusAlternateSaturday)).toBe(false); // 3rd Sat — working
    expect(isOffDay('2026-08-22', sundayPlusAlternateSaturday)).toBe(true);  // 4th Sat — off
    expect(isOffDay('2026-08-29', sundayPlusAlternateSaturday)).toBe(false); // 5th Sat — working
  });

  it('still takes every Sunday off while the Saturday rule alternates', () => {
    expect(isOffDay('2026-08-02', sundayPlusAlternateSaturday)).toBe(true);
    expect(isOffDay('2026-08-30', sundayPlusAlternateSaturday)).toBe(true);
  });

  it('leaves other weekdays working', () => {
    expect(isOffDay('2026-08-05', sundayPlusAlternateSaturday)).toBe(false); // Wednesday
  });
});

describe('shiftLengthHours', () => {
  it('measures an ordinary day shift', () => {
    expect(shiftLengthHours('09:00', '18:00')).toBe(9);
    expect(shiftLengthHours('09:30', '18:00')).toBe(8.5);
  });

  it('wraps a shift that runs past midnight', () => {
    expect(shiftLengthHours('22:00', '06:00')).toBe(8);
    expect(shiftLengthHours('23:30', '07:30')).toBe(8);
  });

  it('treats equal start and end as a full day, not zero', () => {
    expect(shiftLengthHours('09:00', '09:00')).toBe(24);
  });

  it('is zero when a time is missing', () => {
    expect(shiftLengthHours(null, '18:00')).toBe(0);
    expect(shiftLengthHours('09:00', undefined)).toBe(0);
  });
});

describe('fullDayHoursFor', () => {
  it('prefers what the shift states outright', () => {
    expect(fullDayHoursFor({ full_day_hours: 8, start_time: '09:00', end_time: '19:00' }, 9)).toBe(8);
  });

  it('falls back to the office hour time when no figure is set', () => {
    expect(fullDayHoursFor({ full_day_hours: 0, office_hour_time: '07:30' }, 9)).toBe(7.5);
  });

  it('then falls back to the shift length', () => {
    expect(fullDayHoursFor({ start_time: '09:00', end_time: '18:00' }, 9)).toBe(9);
    expect(fullDayHoursFor({ start_time: '22:00', end_time: '06:00' }, 9)).toBe(8);
  });

  it('uses the supplied fallback with no shift at all', () => {
    expect(fullDayHoursFor(null, 8)).toBe(8);
    expect(fullDayHoursFor(undefined, 8)).toBe(8);
  });
});
