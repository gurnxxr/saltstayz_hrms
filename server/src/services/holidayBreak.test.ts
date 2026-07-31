import { describe, it, expect } from 'vitest';
import { shiftDate, daysBetween, findBreak } from './holidayBreak';

// A whole year of window, so the walk only stops at a working day unless a test says otherwise.
const WIN_START = '2025-12-25';
const WIN_END = '2027-01-07';

/** Build the predicate from an explicit set of non-working dates. */
const offDays = (...dates: string[]) => {
  const set = new Set(dates);
  return (d: string) => set.has(d);
};

describe('shiftDate', () => {
  it('moves whole days without a timezone shifting the date', () => {
    expect(shiftDate('2026-01-26', 1)).toBe('2026-01-27');
    expect(shiftDate('2026-01-26', -1)).toBe('2026-01-25');
  });

  it('crosses month and year boundaries', () => {
    expect(shiftDate('2026-01-31', 1)).toBe('2026-02-01');
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDate('2026-01-01', -7)).toBe('2025-12-25');
  });

  it('handles a leap year', () => {
    expect(shiftDate('2028-02-28', 1)).toBe('2028-02-29');
    expect(shiftDate('2028-02-29', 1)).toBe('2028-03-01');
  });
});

describe('daysBetween', () => {
  it('counts forwards and backwards', () => {
    expect(daysBetween('2026-01-26', '2026-01-26')).toBe(0);
    expect(daysBetween('2026-01-24', '2026-01-26')).toBe(2);
    expect(daysBetween('2026-01-26', '2026-01-24')).toBe(-2);
  });

  it('is unaffected by a DST transition in the local zone', () => {
    // Europe/US clocks change inside this span; UTC arithmetic must still say 31.
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31);
  });
});

describe('findBreak', () => {
  it('is a single day when the holiday sits between working days', () => {
    // Wed 2026-01-28, nothing off around it.
    const b = findBreak('2026-01-28', offDays(), WIN_START, WIN_END);
    expect(b).toEqual({ start: '2026-01-28', end: '2026-01-28', days: 1, bounded: false });
  });

  it('extends forwards over a following weekend', () => {
    // Fri 2026-01-02 holiday, Sat 03 + Sun 04 off.
    const b = findBreak('2026-01-02', offDays('2026-01-03', '2026-01-04'), WIN_START, WIN_END);
    expect(b.start).toBe('2026-01-02');
    expect(b.end).toBe('2026-01-04');
    expect(b.days).toBe(3);
    expect(b.bounded).toBe(false);
  });

  it('extends BACKWARDS over a preceding weekend', () => {
    // Sat 2026-01-03 + Sun 04 off, Mon 05 is the holiday. The run starts on the Saturday.
    const b = findBreak('2026-01-05', offDays('2026-01-03', '2026-01-04'), WIN_START, WIN_END);
    expect(b.start).toBe('2026-01-03');
    expect(b.end).toBe('2026-01-05');
    expect(b.days).toBe(3);
  });

  it('spans a weekend on both sides', () => {
    // Off Sat/Sun either side of a Mon-Fri week that is entirely holiday.
    const off = offDays('2026-01-03', '2026-01-04', '2026-01-10', '2026-01-11',
      '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09');
    const b = findBreak('2026-01-07', off, WIN_START, WIN_END);
    expect(b.start).toBe('2026-01-03');
    expect(b.end).toBe('2026-01-11');
    expect(b.days).toBe(9);
  });

  it('gives two holidays in the same run an identical break', () => {
    // This is the case that double-counts long weekends without a dedupe by break_start.
    const off = offDays('2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04');
    const first = findBreak('2026-01-01', off, WIN_START, WIN_END);
    const second = findBreak('2026-01-02', off, WIN_START, WIN_END);
    expect(first.start).toBe(second.start);
    expect(first.end).toBe(second.end);
    expect(first.days).toBe(second.days);
    expect(first.days).toBe(4);
  });

  it('measures a break spanning the year boundary', () => {
    // 31 Dec holiday with 1 and 2 Jan off — only reachable because the caller pads the window.
    const b = findBreak('2026-12-31', offDays('2027-01-01', '2027-01-02'), WIN_START, WIN_END);
    expect(b.start).toBe('2026-12-31');
    expect(b.end).toBe('2027-01-02');
    expect(b.days).toBe(3);
    expect(b.bounded).toBe(false);
  });

  it('flags a run that reaches the window edge as bounded', () => {
    const b = findBreak('2026-01-01', () => true, '2026-01-01', '2026-01-05');
    expect(b.start).toBe('2026-01-01');
    expect(b.end).toBe('2026-01-05');
    expect(b.days).toBe(5);
    expect(b.bounded).toBe(true);
  });

  it('terminates when every day qualifies, rather than looping', () => {
    // A pattern declaring all seven days off. Must return, and must say the number is a floor.
    const b = findBreak('2026-06-15', () => true, WIN_START, WIN_END);
    expect(b.bounded).toBe(true);
    expect(b.start).toBe(WIN_START);
    expect(b.end).toBe(WIN_END);
    expect(b.days).toBe(daysBetween(WIN_START, WIN_END) + 1);
  });

  it('stops at a day the employee was not employed for', () => {
    // Sat 03 + Sun 04 are rest days, but they joined on the 5th, so the run must not reach back
    // before they worked here. The predicate carries the employment check.
    const rest = new Set(['2026-01-03', '2026-01-04']);
    const employedFrom = '2026-01-05';
    const isBreakDay = (d: string) => rest.has(d) && d >= employedFrom;
    const b = findBreak('2026-01-05', isBreakDay, WIN_START, WIN_END);
    expect(b.start).toBe('2026-01-05');
    expect(b.days).toBe(1);
  });
});
