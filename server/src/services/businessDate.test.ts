import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { businessToday } from '../utils/businessDate';

/**
 * The window in which UTC and the business disagree about what day it is.
 *
 * A shift assigned at 1am IST wrote `2026-08-04` into effective_from — the browser's local date —
 * while the server's `new Date().toISOString()` still said `2026-08-03`. pickAssignmentFor read
 * that as "starts tomorrow", declined to apply it, and the employee's My Shift page said
 * "No shift assigned yet" until half past five in the morning.
 */
describe('businessToday', () => {
  it('is a day ahead of UTC during the IST small hours', () => {
    // 2026-08-03T20:00Z is 2026-08-04 01:30 in Kolkata.
    const t = new Date('2026-08-03T20:00:00Z');
    expect(t.toISOString().slice(0, 10)).toBe('2026-08-03'); // what the server used to think
    expect(businessToday(t)).toBe('2026-08-04');             // what the business, and HR, think
  });

  it('agrees with UTC for the rest of the day', () => {
    const t = new Date('2026-08-03T09:00:00Z'); // 14:30 IST
    expect(businessToday(t)).toBe(t.toISOString().slice(0, 10));
  });

  it('rolls over at 18:30Z, which is midnight IST', () => {
    expect(businessToday(new Date('2026-08-03T18:29:59Z'))).toBe('2026-08-03');
    expect(businessToday(new Date('2026-08-03T18:30:00Z'))).toBe('2026-08-04');
  });

  it('always returns a zero-padded ISO date', () => {
    expect(businessToday(new Date('2026-01-05T12:00:00Z'))).toBe('2026-01-05');
    expect(businessToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

/**
 * Every decision about which assignment governs a date must use the same clock. Two of these
 * three used to take the UTC date and one the business date would be worse than all three being
 * wrong together — they would disagree with each other for five and a half hours a day.
 */
describe('shift resolution uses one clock', () => {
  const read = (p: string) => readFileSync(join(__dirname, p), 'utf-8');

  it('no pickAssignmentFor caller passes a UTC date', () => {
    const offenders: string[] = [];
    for (const f of ['shift.service.ts', 'attendance.service.ts', 'payableDays.service.ts']) {
      const src = read(f);
      for (const line of src.split('\n')) {
        // A call site handing pickAssignmentFor something built from toISOString would be
        // reintroducing the split clock.
        if (/pickAssignmentFor\(/.test(line) && /toISOString/.test(line)) offenders.push(`${f}: ${line.trim()}`);
      }
      // The shift resolver's own `today` helper must come from businessDate, not toISOString.
      if (f === 'shift.service.ts') {
        expect(src).toContain('const todayIso = () => businessToday()');
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the resolver does not select two columns named effective_from', () => {
    // `st.*` already carries an effective_from (migration 003 renamed process_attendance_after to
    // it), so an unaliased `a.effective_from` beside it leaves the winner up to driver ordering.
    const src = read('shift.service.ts');
    const fn = src.split('export async function resolveShiftForEmployee')[1]?.split('\n}')[0] ?? '';
    // Only the SELECT list. `.orderBy('a.effective_from')` further down is correct and must not
    // trip this — sorting by the assignment's own date is exactly right.
    const select = fn.split('.select(')[1]?.split(')')[0] ?? '';
    expect(select).toContain("'st.*'");
    expect(select).not.toMatch(/'a\.effective_from'\s*,/);
    expect(select).toContain("'a.effective_from as assignment_effective_from'");
  });
});
