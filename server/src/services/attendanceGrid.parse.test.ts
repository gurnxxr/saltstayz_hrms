import { describe, it, expect } from 'vitest';
import { parseMarkedGrid, parseHeaderDate, cellText } from './attendanceGrid.service';

/**
 * The marked-grid importer unpivots HR's wide dashboard (one row per employee, one column
 * per date, each cell a code) into employee-day-code rows. parseMarkedGrid is the pure core
 * both the .xlsx and .csv readers feed, so it is covered here without a binary fixture.
 */
describe('parseMarkedGrid — unpivot a coded dashboard', () => {
  it('reads day-number headers combined with the chosen month, mapping every code', () => {
    const grid = [
      ['Monthly Attendance — July 2026', '', '', '', '', ''],
      ['Emp Code', 'Name', '1', '2', '3', 'Present'],
      ['EMP001', 'Asha', 'P', 'NP', 'HD', '20'],
      ['EMP002', 'Ravi', 'A', 'WO', 'MP', '18'],
      ['', '', '', '', '', ''], // summary/spacer row without an emp code is ignored
    ];
    const { cells, unrecognized } = parseMarkedGrid(grid, { month: '2026-07' });
    const at = (code: string, date: string) => cells.find((c) => c.empCode === code && c.date === date)?.code;

    expect(at('EMP001', '2026-07-01')).toBe('present');
    expect(at('EMP001', '2026-07-02')).toBe('no_punch');
    expect(at('EMP001', '2026-07-03')).toBe('half_day');
    expect(at('EMP002', '2026-07-01')).toBe('absent');
    expect(at('EMP002', '2026-07-03')).toBe('miss_punch');
    // WO is calendar-driven — never written from the grid.
    expect(cells.find((c) => c.empCode === 'EMP002' && c.date === '2026-07-02')).toBeUndefined();
    expect(unrecognized).toEqual([]);
    expect(cells).toHaveLength(5);
  });

  it('accepts full ISO date headers with no month, and maps HHD / SP', () => {
    const grid = [
      ['Emp Code', '2026-07-10', '2026-07-11'],
      ['EMP001', 'HHD', 'SP'],
    ];
    const { cells } = parseMarkedGrid(grid, {});
    expect(cells).toContainEqual({ empCode: 'EMP001', date: '2026-07-10', code: 'hhd' });
    expect(cells).toContainEqual({ empCode: 'EMP001', date: '2026-07-11', code: 'short_punch' });
  });

  it('surfaces an unrecognised mark instead of guessing it', () => {
    const { cells, unrecognized } = parseMarkedGrid(
      [['Emp Code', '1'], ['EMP001', 'ZZ']], { month: '2026-07' });
    expect(cells).toHaveLength(0);
    expect(unrecognized).toEqual(['ZZ']);
  });

  it('throws when there is no Emp Code column', () => {
    expect(() => parseMarkedGrid([['Name', '1'], ['Asha', 'P']], { month: '2026-07' }))
      .toThrow(/Emp Code/i);
  });

  it('throws when day-number headers are given without a month to place them', () => {
    expect(() => parseMarkedGrid([['Emp Code', '1', '2'], ['EMP001', 'P', 'A']], {}))
      .toThrow(/date column/i);
  });
});

describe('parseHeaderDate / cellText — cell coercion', () => {
  it('reads an Excel date cell UTC-safely', () => {
    expect(parseHeaderDate(new Date(Date.UTC(2026, 6, 21)))).toBe('2026-07-21');
  });
  it('reads DD-MM-YY text', () => {
    expect(parseHeaderDate('05-07-26')).toBe('2026-07-05');
  });
  it('places a bare day number with the given month', () => {
    expect(parseHeaderDate('7', '2026-07')).toBe('2026-07-07');
  });
  it('rejects a non-date header', () => {
    expect(parseHeaderDate('Present', '2026-07')).toBeNull();
  });
  it('flattens a rich-text cell', () => {
    expect(cellText({ richText: [{ text: 'EMP' }, { text: '001' }] })).toBe('EMP001');
  });
});
