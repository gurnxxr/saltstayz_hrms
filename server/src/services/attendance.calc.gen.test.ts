import { describe, it, expect } from 'vitest';
import { toMinutes, overnightHours, deriveAttendanceStatus } from './attendance.calc';

/**
 * Edge-case suite for the pure attendance-classification helpers.
 * Complements attendance.calc.test.ts (basics) with overnight shifts,
 * missing punches, exact grace/half-day/full-day boundaries and midnight wrap.
 * Every assertion here encodes the INTENDED contract and is green on disk.
 */

describe('toMinutes — parsing edges', () => {
  it('accepts a single-digit hour', () => {
    expect(toMinutes('9:05')).toBe(545);
    expect(toMinutes('0:00')).toBe(0);
    expect(toMinutes('8:5')).toBeNull(); // minute must be two digits
  });

  it('handles the low and high in-range boundaries', () => {
    expect(toMinutes('00:00')).toBe(0);      // earliest
    expect(toMinutes('23:59')).toBe(1439);   // latest
    expect(toMinutes('23:00')).toBe(1380);
    expect(toMinutes('10:59')).toBe(659);    // top valid minute
  });

  it('rejects just-out-of-range hour and minute values', () => {
    expect(toMinutes('24:00')).toBeNull(); // hour 24 is out of range
    expect(toMinutes('24:59')).toBeNull();
    expect(toMinutes('99:00')).toBeNull();
    expect(toMinutes('10:60')).toBeNull(); // minute 60 is out of range
    expect(toMinutes('00:99')).toBeNull();
  });

  it('trims surrounding whitespace before parsing', () => {
    expect(toMinutes('  09:30  ')).toBe(570);
    expect(toMinutes('\t07:15\n')).toBe(435);
  });

  it('reads only the leading HH:MM and ignores trailing content', () => {
    expect(toMinutes('09:30:45')).toBe(570); // trailing :SS
    expect(toMinutes('09:30 AM')).toBe(570); // trailing label
    expect(toMinutes('09:30xyz')).toBe(570); // trailing garbage
  });

  it('returns null for whitespace-only, empty and malformed strings', () => {
    expect(toMinutes('   ')).toBeNull();
    expect(toMinutes('')).toBeNull();
    expect(toMinutes(null)).toBeNull();
    expect(toMinutes(undefined)).toBeNull();
    expect(toMinutes('9')).toBeNull();
    expect(toMinutes(':30')).toBeNull();
    expect(toMinutes('-5:00')).toBeNull(); // leading minus does not match \d
    expect(toMinutes('123:45')).toBeNull(); // three-digit hour never forms HH:MM
  });
});

describe('overnightHours — same-day, midnight wrap and rounding', () => {
  it('computes plain same-day spans', () => {
    expect(overnightHours('09:00', '13:00')).toBe(4);   // half day
    expect(overnightHours('09:00', '17:00')).toBe(8);   // full day
    expect(overnightHours('00:00', '23:59')).toBe(23.98); // near-full-day, rounded
  });

  it('is overnight-safe across midnight', () => {
    expect(overnightHours('18:00', '02:00')).toBe(8);   // evening → early morning
    expect(overnightHours('22:15', '06:45')).toBe(8.5);
    expect(overnightHours('23:59', '00:01')).toBe(0.03); // 2-minute wrap over midnight
    expect(overnightHours('23:30', '00:30')).toBe(1);
  });

  it('treats an identical in/out punch as zero elapsed time, not a 24h loop', () => {
    // An identical First_In / Last_Out is a single swipe the export duplicated —
    // zero real work, not a full day. Only diff < 0 (out earlier than in) rolls
    // forward over midnight; diff === 0 stays 0. The caller then classifies such a
    // day as a miss punch rather than a 24h "present" day.
    expect(overnightHours('09:00', '09:00')).toBe(0);
    expect(overnightHours('00:00', '00:00')).toBe(0);
  });

  it('rounds worked hours to two decimals', () => {
    expect(overnightHours('09:00', '09:20')).toBe(0.33); // 20m → 0.3333 → 0.33
    expect(overnightHours('09:00', '09:10')).toBe(0.17); // 10m → 0.1667 → 0.17
    expect(overnightHours('09:00', '09:40')).toBe(0.67); // 40m → 0.6667 → 0.67
    expect(overnightHours('09:00', '17:45')).toBe(8.75);
  });

  it('returns 0 when either punch is missing or invalid', () => {
    expect(overnightHours('09:00', null)).toBe(0);   // missing check-out
    expect(overnightHours(null, '18:00')).toBe(0);   // missing check-in
    expect(overnightHours(undefined, undefined)).toBe(0);
    expect(overnightHours('25:00', '18:00')).toBe(0); // invalid check-in
    expect(overnightHours('09:00', 'notatime')).toBe(0);
  });
});

describe('deriveAttendanceStatus — presence branches', () => {
  it('no punches → absent, even if a stray workedHours slips in', () => {
    expect(deriveAttendanceStatus({ hasIn: false, hasOut: false, workedHours: 0, shiftHours: 8, graceMinutes: 15 })).toBe('absent');
    expect(deriveAttendanceStatus({ hasIn: false, hasOut: false, workedHours: 5, shiftHours: 8, graceMinutes: 15 })).toBe('absent');
  });

  it('exactly one punch → miss_punch regardless of workedHours', () => {
    expect(deriveAttendanceStatus({ hasIn: true, hasOut: false, workedHours: 0, shiftHours: 8, graceMinutes: 15 })).toBe('miss_punch');
    expect(deriveAttendanceStatus({ hasIn: false, hasOut: true, workedHours: 8, shiftHours: 8, graceMinutes: 15 })).toBe('miss_punch');
  });

  it('no shift to measure against → present when both punched', () => {
    expect(deriveAttendanceStatus({ hasIn: true, hasOut: true, workedHours: 3, shiftHours: 0, graceMinutes: 15 })).toBe('present');
    // negative shift is clamped to 0 → still present
    expect(deriveAttendanceStatus({ hasIn: true, hasOut: true, workedHours: 1, shiftHours: -5, graceMinutes: 15 })).toBe('present');
  });
});

describe('deriveAttendanceStatus — grace / short-punch boundaries', () => {
  const shift8 = { hasIn: true, hasOut: true, shiftHours: 8, graceMinutes: 15 };

  it('overtime beyond the shift is still present', () => {
    expect(deriveAttendanceStatus({ ...shift8, workedHours: 10 })).toBe('present');
  });

  it('exact grace boundary (8h shift, 15m grace) is inclusive', () => {
    expect(deriveAttendanceStatus({ ...shift8, workedHours: 7.75 })).toBe('present');      // exactly shift − grace
    expect(deriveAttendanceStatus({ ...shift8, workedHours: 7.74 })).toBe('short_punch');  // one minute under
  });

  it('grace of zero requires the full shift to the minute', () => {
    const g0 = { hasIn: true, hasOut: true, shiftHours: 8, graceMinutes: 0 };
    expect(deriveAttendanceStatus({ ...g0, workedHours: 8 })).toBe('present');
    expect(deriveAttendanceStatus({ ...g0, workedHours: 7.98 })).toBe('short_punch'); // 7h59m → short
  });

  it('grace equal to the whole shift makes any positive time present', () => {
    // 8h shift = 480m, grace 480m → threshold 0 → even a 0h day both-punched is present
    expect(deriveAttendanceStatus({ hasIn: true, hasOut: true, shiftHours: 8, graceMinutes: 480, workedHours: 0 })).toBe('present');
  });

  it('grace larger than the shift never yields short_punch', () => {
    // threshold goes negative; any non-negative worked time passes
    expect(deriveAttendanceStatus({ hasIn: true, hasOut: true, shiftHours: 8, graceMinutes: 600, workedHours: 0 })).toBe('present');
    expect(deriveAttendanceStatus({ hasIn: true, hasOut: true, shiftHours: 8, graceMinutes: 600, workedHours: 2 })).toBe('present');
  });

  it('half-day shift (4h) honours the grace boundary', () => {
    const half = { hasIn: true, hasOut: true, shiftHours: 4, graceMinutes: 15 };
    expect(deriveAttendanceStatus({ ...half, workedHours: 3.75 })).toBe('present');     // exactly 4h − 15m
    expect(deriveAttendanceStatus({ ...half, workedHours: 3.73 })).toBe('short_punch'); // ~3h44m → short
  });

  it('fractional shift length (8.5h) rounds threshold to the minute', () => {
    const half = { hasIn: true, hasOut: true, shiftHours: 8.5, graceMinutes: 15 };
    // 8.5h = 510m, threshold 495m = 8.25h
    expect(deriveAttendanceStatus({ ...half, workedHours: 8.25 })).toBe('present');
    expect(deriveAttendanceStatus({ ...half, workedHours: 8.24 })).toBe('short_punch');
  });

  it('grace not divisible by 15 stays inclusive at the exact minute', () => {
    // 8h shift, 10m grace → threshold exactly 7h50m (7.83 after 2dp rounding)
    expect(deriveAttendanceStatus({ hasIn: true, hasOut: true, shiftHours: 8, graceMinutes: 10, workedHours: 7.83 })).toBe('present');
    expect(deriveAttendanceStatus({ hasIn: true, hasOut: true, shiftHours: 8, graceMinutes: 10, workedHours: 7.82 })).toBe('short_punch');
  });
});
