import { describe, it, expect } from 'vitest';
import { toMinutes, overnightHours, deriveAttendanceStatus } from './attendance.calc';

describe('toMinutes', () => {
  it('parses HH:MM to minutes since midnight', () => {
    expect(toMinutes('00:00')).toBe(0);
    expect(toMinutes('09:30')).toBe(570);
    expect(toMinutes('23:59')).toBe(1439);
  });
  it('accepts a trailing :SS but reads only HH:MM', () => {
    expect(toMinutes('09:30:45')).toBe(570);
  });
  it('returns null for missing or malformed input', () => {
    expect(toMinutes(null)).toBeNull();
    expect(toMinutes(undefined)).toBeNull();
    expect(toMinutes('')).toBeNull();
    expect(toMinutes('9')).toBeNull();
    expect(toMinutes('24:00')).toBeNull(); // hour out of range
    expect(toMinutes('10:99')).toBeNull(); // minute out of range
  });
});

describe('overnightHours', () => {
  it('computes a same-day span', () => {
    expect(overnightHours('09:00', '18:00')).toBe(9);
    expect(overnightHours('09:15', '17:45')).toBe(8.5);
  });
  it('is overnight-safe (crosses midnight)', () => {
    expect(overnightHours('22:00', '06:00')).toBe(8);
    expect(overnightHours('23:30', '00:30')).toBe(1);
  });
  it('returns 0 when either punch is missing', () => {
    expect(overnightHours('09:00', null)).toBe(0);
    expect(overnightHours(null, '18:00')).toBe(0);
    expect(overnightHours(null, null)).toBe(0);
  });
});

describe('deriveAttendanceStatus', () => {
  const base = { shiftHours: 8, graceMinutes: 15 };

  it('no punches → absent', () => {
    expect(deriveAttendanceStatus({ ...base, hasIn: false, hasOut: false, workedHours: 0 })).toBe('absent');
  });

  it('one punch only → miss_punch (in without out)', () => {
    expect(deriveAttendanceStatus({ ...base, hasIn: true, hasOut: false, workedHours: 0 })).toBe('miss_punch');
  });

  it('one punch only → miss_punch (out without in)', () => {
    expect(deriveAttendanceStatus({ ...base, hasIn: false, hasOut: true, workedHours: 0 })).toBe('miss_punch');
  });

  it('both punches, full shift → present', () => {
    expect(deriveAttendanceStatus({ ...base, hasIn: true, hasOut: true, workedHours: 8 })).toBe('present');
  });

  it('both punches, within grace → present', () => {
    // 8h shift, 15m grace → 7.75h still counts as present
    expect(deriveAttendanceStatus({ ...base, hasIn: true, hasOut: true, workedHours: 7.75 })).toBe('present');
  });

  it('both punches, left early beyond grace → short_punch', () => {
    expect(deriveAttendanceStatus({ ...base, hasIn: true, hasOut: true, workedHours: 7.0 })).toBe('short_punch');
  });

  it('grace boundary is inclusive', () => {
    // exactly shift − grace (7.75h) is OK; a hair under is short
    expect(deriveAttendanceStatus({ ...base, hasIn: true, hasOut: true, workedHours: 7.75 })).toBe('present');
    expect(deriveAttendanceStatus({ ...base, hasIn: true, hasOut: true, workedHours: 7.74 })).toBe('short_punch');
  });

  it('no shift to measure against → present (both punches)', () => {
    expect(deriveAttendanceStatus({ shiftHours: 0, graceMinutes: 15, hasIn: true, hasOut: true, workedHours: 3 })).toBe('present');
  });

  it('grace boundary is inclusive for a grace not divisible by 15', () => {
    // 8h shift, 10m grace → present threshold is exactly 7h50m.
    // overnightHours('09:00','16:50') rounds 7h50m to 7.83; the classifier must
    // still treat it as present (worked exactly shift − grace), not short_punch.
    expect(deriveAttendanceStatus({ shiftHours: 8, graceMinutes: 10, hasIn: true, hasOut: true, workedHours: 7.83 })).toBe('present');
    // 7h49m (7.82) is one minute short → short_punch.
    expect(deriveAttendanceStatus({ shiftHours: 8, graceMinutes: 10, hasIn: true, hasOut: true, workedHours: 7.82 })).toBe('short_punch');
  });
});
