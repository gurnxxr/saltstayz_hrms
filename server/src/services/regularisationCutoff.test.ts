import { describe, it, expect } from 'vitest';
import { cutoffDateFor } from './regularisationSettings.service';

/**
 * The regularisation deadline: "corrections close N days after the attendance month ends".
 *
 * Worth pinning because the arithmetic reads as though it were off by one — the month index
 * handed to Date.UTC is the FOLLOWING month, so day N of it is N days past this month's end, and
 * day 0 is this month's last day. Get it wrong by one and every deadline shifts a month, which is
 * the kind of bug that only shows up when somebody is refused a correction they should have had.
 */
describe('cutoffDateFor', () => {
  it('closes N days into the following month', () => {
    expect(cutoffDateFor('2026-07-15', 2)).toBe('2026-08-02');
    expect(cutoffDateFor('2026-02-10', 2)).toBe('2026-03-02');
  });

  it('treats 0 as the last day of the month itself, not the 1st of the next', () => {
    expect(cutoffDateFor('2026-07-15', 0)).toBe('2026-07-31');
    expect(cutoffDateFor('2026-04-01', 0)).toBe('2026-04-30');
    expect(cutoffDateFor('2026-02-28', 0)).toBe('2026-02-28');
  });

  it('rolls December into the next year', () => {
    expect(cutoffDateFor('2026-12-05', 2)).toBe('2027-01-02');
    expect(cutoffDateFor('2026-12-31', 0)).toBe('2026-12-31');
  });

  it('lands on a real date in a leap February', () => {
    expect(cutoffDateFor('2028-02-15', 0)).toBe('2028-02-29');
    expect(cutoffDateFor('2028-01-31', 0)).toBe('2028-01-31');
  });

  it('gives the same answer for every date in a month — the month is what closes, not the day', () => {
    const first = cutoffDateFor('2026-07-01', 2);
    for (const d of ['2026-07-02', '2026-07-15', '2026-07-31']) {
      expect(cutoffDateFor(d, 2)).toBe(first);
    }
  });

  it('means literally "N days after the month ends", including across a short month', () => {
    // 31 is the largest configurable value. Day 31 of February does not exist, and Date.UTC
    // OVERFLOWS rather than clamping — January's deadline is 3 March, not 28 February. That is
    // the definition working correctly rather than a quirk to paper over: January ends on the
    // 31st, and 31 days after the 31st IS 3 March.
    expect(cutoffDateFor('2026-07-15', 31)).toBe('2026-08-31'); // 31 Jul + 31d
    expect(cutoffDateFor('2026-01-15', 31)).toBe('2026-03-03'); // 31 Jan + 31d, over a 28-day Feb
  });

  it('is exactly month-end plus N days, for every N and every month length', () => {
    // The property the two cases above are instances of. If this holds, the deadline can be
    // reasoned about as plain date addition and nothing depends on month lengths.
    const plusDays = (date: string, n: number) => {
      const [y, m, d] = date.split('-').map(Number);
      const t = new Date(Date.UTC(y, m - 1, d));
      t.setUTCDate(t.getUTCDate() + n);
      return t.toISOString().slice(0, 10);
    };
    for (const month of ['2026-01', '2026-02', '2026-04', '2026-12', '2028-02']) {
      const monthEnd = cutoffDateFor(`${month}-01`, 0);
      for (const n of [0, 1, 2, 15, 31]) {
        expect(cutoffDateFor(`${month}-01`, n)).toBe(plusDays(monthEnd, n));
      }
    }
  });
});
