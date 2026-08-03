import { describe, it, expect } from 'vitest';
import { parseMarkedGrid, headerWeekday } from './attendanceGrid.service';

/**
 * The weekday names in a marked grid are a free checksum on the month HR picked.
 *
 * Each column is placed by its day NUMBER plus the chosen month — the weekday label is not used
 * to derive the date. So June's sheet uploaded against July lands a whole register on the wrong
 * dates with every code valid, every employee matched and every total plausible. Nothing
 * downstream would notice. The labels are the one piece of evidence that disagrees, and they
 * were being discarded.
 */
const row = (code: string, n: number) => Array(n).fill(code);

/** A header row: Emp Code, then `count` day columns starting at day 1 of the named month. */
function headers(weekdays: string[], monthName: string): string[] {
  return ['Emp Code', ...weekdays.map((w, i) => `${w} ${String(i + 1).padStart(2, '0')} ${monthName}`)];
}

describe('headerWeekday', () => {
  it('reads the weekday a header claims', () => {
    expect(headerWeekday('Fri 01 Jul')).toBe('fri');
    expect(headerWeekday('Thursday 14 Jul')).toBe('thu');
    expect(headerWeekday('Tues 05 Jul')).toBe('tue');
    expect(headerWeekday('Weds 06 Jul')).toBe('wed');
  });

  it('returns null when no weekday is named', () => {
    expect(headerWeekday('01 Jul')).toBeNull();
    expect(headerWeekday('2026-07-01')).toBeNull();
    expect(headerWeekday('Present')).toBeNull();   // a summary column, not a date
    expect(headerWeekday('')).toBeNull();
  });
});

describe('weekday mismatch detection', () => {
  it('accepts a sheet whose weekdays match the chosen month', () => {
    // 1 July 2026 really is a Wednesday.
    const m = [headers(['Wed', 'Thu', 'Fri'], 'Jul'), ['PD-0001', ...row('P', 3)]];
    const g = parseMarkedGrid(m, { month: '2026-07' });
    expect(g.weekdayMismatches).toEqual([]);
    expect(g.weekdaysMatchMonth).toBeNull();
    expect(g.cells).toHaveLength(3);
  });

  it('flags a sheet whose weekdays belong to another month', () => {
    // "Fri 01 Jul" is July 2022's calendar, not 2026's.
    const m = [headers(['Fri', 'Sat', 'Sun'], 'Jul'), ['PD-0001', ...row('P', 3)]];
    const g = parseMarkedGrid(m, { month: '2026-07' });
    expect(g.weekdayMismatches).toHaveLength(3);
    expect(g.weekdayMismatches[0]).toMatchObject({
      date: '2026-07-01', claimed: 'Friday', actual: 'Wednesday',
    });
  });

  it('names the month the weekdays actually describe', () => {
    // June 2026 starts on a Monday; uploaded against July it should say so.
    const m = [headers(['Mon', 'Tue', 'Wed'], 'Jul'), ['PD-0001', ...row('P', 3)]];
    const g = parseMarkedGrid(m, { month: '2026-07' });
    expect(g.weekdayMismatches.length).toBeGreaterThan(0);
    expect(g.weekdaysMatchMonth).toBe('2026-06');
  });

  it('still parses every cell — the check reports, it does not drop data', () => {
    const m = [headers(['Fri', 'Sat', 'Sun'], 'Jul'), ['PD-0001', 'P', 'A', 'HD']];
    const g = parseMarkedGrid(m, { month: '2026-07' });
    expect(g.cells).toEqual([
      { empCode: 'PD-0001', date: '2026-07-01', code: 'present' },
      { empCode: 'PD-0001', date: '2026-07-02', code: 'absent' },
      { empCode: 'PD-0001', date: '2026-07-03', code: 'half_day' },
    ]);
  });

  it('says nothing when the headers carry no weekday at all', () => {
    const m = [['Emp Code', '01 Jul', '02 Jul'], ['PD-0001', 'P', 'P']];
    const g = parseMarkedGrid(m, { month: '2026-07' });
    expect(g.weekdayMismatches).toEqual([]);
  });
});
