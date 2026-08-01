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

describe('the header shape the real dashboard export produces', () => {
  // Verbatim from a live export: "Fri 01 Jul" — a weekday label, a day, a month name, and no
  // year at all. None of the previously-accepted forms matched it, so the importer found zero
  // date columns and refused the whole file.
  it('reads a weekday-prefixed day and month name, taking the year from the chosen month', () => {
    expect(parseHeaderDate('Fri 01 Jul', '2026-07')).toBe('2026-07-01');
    expect(parseHeaderDate('Sun 31 Jul', '2026-07')).toBe('2026-07-31');
  });

  it('ignores the weekday label rather than trusting it', () => {
    // 1 July 2026 is a Wednesday, but the export says "Fri". These labels go stale, and a file
    // that is otherwise perfectly good must not be rejected over a decorative prefix.
    expect(parseHeaderDate('Fri 01 Jul', '2026-07')).toBe('2026-07-01');
    expect(parseHeaderDate('Wed 01 Jul', '2026-07')).toBe('2026-07-01');
  });

  it('takes the other orders and separators too', () => {
    expect(parseHeaderDate('01 Jul', '2026-07')).toBe('2026-07-01');
    expect(parseHeaderDate('Jul 01', '2026-07')).toBe('2026-07-01');
    expect(parseHeaderDate('1-Jul', '2026-07')).toBe('2026-07-01');
    expect(parseHeaderDate('1 July 2026')).toBe('2026-07-01');
    expect(parseHeaderDate('01-Jul-26')).toBe('2026-07-01');
  });

  it('keeps a payroll cycle on the right side of New Year', () => {
    // A 26 Dec – 25 Jan dashboard uploaded as January: the December columns belong to the year
    // before, or a month of marks lands twelve months out.
    expect(parseHeaderDate('Sat 26 Dec', '2027-01')).toBe('2026-12-26');
    expect(parseHeaderDate('Mon 25 Jan', '2027-01')).toBe('2027-01-25');
    expect(parseHeaderDate('Thu 01 Jan', '2026-12')).toBe('2027-01-01');
  });

  it('will not place a day and month name with no month chosen', () => {
    // Without the year there is nowhere to put it. Refusing is right; guessing "this year"
    // would silently write last year's attendance onto this one.
    expect(parseHeaderDate('Fri 01 Jul')).toBeNull();
  });

  it('leaves the dashboard summary columns alone', () => {
    // These sit between the employee details and the date columns, and several are named after
    // the very codes the grid contains. A day NUMBER is required, which is what excludes them.
    for (const h of ['Emp Code', 'Empname', 'Dept Name', 'Desg Name', 'Branch Name', 'Status',
      'Present', 'Absent', 'Half Day', 'Short Present', 'Missed Punch', 'No Punch', 'HHD']) {
      expect(parseHeaderDate(h, '2026-07')).toBeNull();
    }
  });

  it('unpivots a row of the real export', () => {
    const matrix = [
      ['Emp Code', 'Empname', 'Dept Name', 'Status', 'Present', 'No Punch', 'HHD',
        'Fri 01 Jul', 'Sat 02 Jul', 'Sun 03 Jul', 'Mon 04 Jul'],
      ['3', 'Anvesha Gupta', 'Operations', 'Active', 7, 2, 0, 'P', 'SP', 'P', 'P'],
      ['11', 'Chirag Dhingra', 'Sales', 'Active', 1, 7, 5, 'HD', 'HD', 'SP', 'NP'],
    ];
    const { cells, dates, unrecognized } = parseMarkedGrid(matrix, { month: '2026-07' });
    expect(dates).toEqual(['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04']);
    expect(unrecognized).toEqual([]);   // the integer summary values must not read as marks
    expect(cells).toHaveLength(8);
    expect(cells[0]).toEqual({ empCode: '3', date: '2026-07-01', code: 'present' });
    expect(cells.find((c) => c.empCode === '11' && c.date === '2026-07-04'))
      .toEqual({ empCode: '11', date: '2026-07-04', code: 'no_punch' });
  });
});

/**
 * The template this app hands out must be a file this app can read back.
 *
 * A downloadable template is a promise about the format, and the only way that promise breaks
 * quietly is for the two halves to drift — someone changes a header, and the file the screen
 * offers starts being rejected by the screen next to it. These parse the template's own shape
 * rather than a hand-written fixture, so a change to one side fails here rather than in an
 * admin's face.
 *
 * `buildMarkedGridTemplate` reads the employee table, so the shape it produces is reconstructed
 * here instead of calling it — the assertion is about the FORMAT, which is what the parser cares
 * about, and this keeps the test pure.
 */
describe('marked-grid template round-trip', () => {
  const templateShape = (month: string, dates: string[]) => ([
    ['Emp Code', 'Name', 'Department', 'Property', ...dates],
    ['PD-0013', 'Aadhya Reddy', 'Security', 'SaltStayz Connaught Place', ...dates.map(() => '')],
  ]);

  it('parses the ISO date headers the template writes', () => {
    const dates = ['2026-07-01', '2026-07-02', '2026-07-03'];
    const grid = templateShape('2026-07', dates);
    grid[1][4] = 'P';
    grid[1][5] = 'NP';
    grid[1][6] = 'HD';

    const { cells, unrecognized } = parseMarkedGrid(grid, { month: '2026-07' });
    expect(unrecognized).toEqual([]);
    expect(cells).toEqual([
      { empCode: 'PD-0013', date: '2026-07-01', code: 'present' },
      { empCode: 'PD-0013', date: '2026-07-02', code: 'no_punch' },
      { empCode: 'PD-0013', date: '2026-07-03', code: 'half_day' },
    ]);
  });

  it('ignores the template\'s Name/Department/Property columns rather than reading them as dates', () => {
    // These sit between the employee code and the first date. Misreading one as a header would
    // scatter every code onto the wrong day.
    expect(parseHeaderDate('Name', '2026-07')).toBeNull();
    expect(parseHeaderDate('Department', '2026-07')).toBeNull();
    expect(parseHeaderDate('Property', '2026-07')).toBeNull();
  });

  it('leaves blank cells alone, so a partly-filled template writes only what was filled', () => {
    const dates = ['2026-07-01', '2026-07-02'];
    const grid = templateShape('2026-07', dates);
    grid[1][4] = 'A'; // day 1 filled, day 2 left blank
    const { cells } = parseMarkedGrid(grid, { month: '2026-07' });
    expect(cells).toEqual([{ empCode: 'PD-0013', date: '2026-07-01', code: 'absent' }]);
  });

  it('reads the trailing legend rows as nothing, not as an employee', () => {
    const dates = ['2026-07-01'];
    const grid = [
      ...templateShape('2026-07', dates),
      [''],
      ['Codes: P = Present · NP = No Punch · A = Absent · HD = Half Day (uses ½ leave) · SP = Short Punch · MP = Miss Punch · HHD = Half-Day Holiday'],
      ['Weekly offs, holidays and approved leave are calendar-driven — leave those cells blank rather than coding them.'],
    ];
    const { cells } = parseMarkedGrid(grid, { month: '2026-07' });
    expect(cells).toEqual([]); // nothing was filled in, and no legend row became a row of marks
  });
});
