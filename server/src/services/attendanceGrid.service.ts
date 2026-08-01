import ExcelJS from 'exceljs';
import db from '../config/database';
import { ValidationError } from '../utils/errors';
import { buildWorkCalendar } from './payableDays.service';

// ─────────────────────────────────────────────────────────────────────────────
// Marked-grid attendance importer.
//
// HR's daily/monthly dashboard is a WIDE grid: one row per employee, one column
// per date, and each cell already carries a code (P / NP / A / HD / SP / MP / HHD,
// with weekly-offs left blank or "WO"). This is the opposite shape to the biometric
// punch file (one row per employee-day with clock in/out) that uploadAttendanceCsv
// reads — so it gets its own importer. The code in each cell is AUTHORITATIVE: we do
// not re-derive a verdict from punches (there are none), we store the code as-is.
//
// The two importers sit side by side. Summary/count columns and the "today's punch"
// block on the dashboard are ignored — only columns whose header is a real date (or a
// day-of-month number, combined with the chosen month) are read.
// ─────────────────────────────────────────────────────────────────────────────

// Dashboard code → attendance_records.status. Anything not here is either an expected
// skip (weekly-off / holiday / leave — those are owned by the calendar and the leave
// module, never invented from a grid cell) or an unrecognised mark we report, never guess.
const CODE_MAP: Record<string, string> = {
  P: 'present', PRESENT: 'present',
  A: 'absent', AB: 'absent', ABS: 'absent', ABSENT: 'absent',
  NP: 'no_punch', 'N/P': 'no_punch',
  HD: 'half_day', 'H/D': 'half_day',
  SP: 'short_punch', 'S/P': 'short_punch',
  MP: 'miss_punch', 'M/P': 'miss_punch',
  HHD: 'hhd',
};

// Codes we deliberately do NOT write: weekly-offs and holidays are calendar-driven, and
// leave is owned by the leave module (an approved leave already lands on the record). They
// are skipped silently; only genuinely unknown marks are surfaced as warnings.
const KNOWN_SKIP = new Set([
  'WO', 'W/O', 'WEEKLYOFF', 'WEEKLY_OFF', 'OFF', 'WKOFF', 'WEEKOFF',
  'H', 'HOL', 'HOLIDAY', 'PH', 'FH',
  'L', 'LV', 'LEAVE', 'CL', 'SL', 'PL', 'EL', 'ML', 'COFF', 'C/OFF',
]);

const pad = (n: number) => String(n).padStart(2, '0');
const norm = (s: string) => s.toLowerCase().replace(/[\s._-]/g, '');

/** Coerce any ExcelJS/CSV cell value to a trimmed display string. */
export function cellText(v: any): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (v instanceof Date) return isoUTC(v);
  if (typeof v === 'object') {
    if (typeof v.text === 'string') return v.text.trim();                 // hyperlink / rich cell
    if (Array.isArray(v.richText)) return v.richText.map((r: any) => r.text).join('').trim();
    if ('result' in v) return cellText(v.result);                         // formula cell
    if ('formula' in v && v.result === undefined) return '';
  }
  return String(v).trim();
}

/** UTC-safe YYYY-MM-DD (Excel dates carry a time; local getters can shift the day). */
function isoUTC(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
/** A leading weekday label, which the export writes but which carries no information. */
const WEEKDAY_PREFIX = /^(?:mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)[a-z]*[\s,.\-/]+/i;

/**
 * Which calendar year a bare "01 Jul" belongs to.
 *
 * The header names a day and a month but no year, so it comes from the month the uploader
 * chose. A dashboard can run a payroll cycle rather than a calendar month (26 Jun – 25 Jul),
 * so the header month is allowed to differ from the chosen one; only the December/January
 * boundary needs care, or a cycle straddling New Year lands twelve months out.
 */
function yearForMonthName(mon: number, month?: string): number | null {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return null;
  const [selYear, selMon] = month.split('-').map(Number);
  if (selMon === 1 && mon === 12) return selYear - 1;
  if (selMon === 12 && mon === 1) return selYear + 1;
  return selYear;
}

/**
 * Read a header cell as a date.
 *
 * Accepts what the exports actually produce:
 *   • a real Excel date cell, or ISO text            2026-07-01
 *   • DD-MM-YY(YY)                                   01-07-2026, 1/7/26
 *   • day + month name, with or without a weekday    "Fri 01 Jul", "01 Jul", "1-Jul-2026"
 *   • month name + day                               "Jul 01"
 *   • a bare day-of-month number                     7
 *
 * The last two both need `month` (YYYY-MM) to place them, and the weekday label is read
 * but ignored: the exports carry stale ones, so trusting it would reject good files.
 *
 * A day number is required in every text form. That is what keeps the dashboard's summary
 * columns — "Present", "Half Day", "No Punch" — from being mistaken for dates.
 */
export function parseHeaderDate(v: any, month?: string): string | null {
  if (v instanceof Date) return isoUTC(v);
  const t = cellText(v);
  if (!t) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;                            // ISO

  const dmy = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);           // DD-MM-YY(YY)
  if (dmy) {
    const day = Number(dmy[1]);
    const mon = Number(dmy[2]);
    let year = dmy[3];
    if (year.length === 2) year = (Number(year) > 50 ? '19' : '20') + year;
    if (day >= 1 && day <= 31 && mon >= 1 && mon <= 12) return `${year}-${pad(mon)}-${pad(day)}`;
    return null;
  }

  // Day + month name, either order, optional weekday prefix and optional year.
  const named = t.replace(WEEKDAY_PREFIX, '').trim();
  const dm = named.match(/^(\d{1,2})[\s,.\-/]*([a-z]{3,9})\.?(?:[\s,.\-/]*(\d{2,4}))?$/i)
    ?? named.match(/^([a-z]{3,9})\.?[\s,.\-/]*(\d{1,2})(?:[\s,.\-/]*(\d{2,4}))?$/i);
  if (dm) {
    const dayFirst = /^\d/.test(dm[1]);
    const day = Number(dayFirst ? dm[1] : dm[2]);
    const mon = MONTH_NAMES[String(dayFirst ? dm[2] : dm[1]).toLowerCase()];
    if (mon && day >= 1 && day <= 31) {
      let year: number | null;
      if (dm[3]) year = dm[3].length === 2 ? Number((Number(dm[3]) > 50 ? '19' : '20') + dm[3]) : Number(dm[3]);
      else year = yearForMonthName(mon, month);
      if (year) return `${year}-${pad(mon)}-${pad(day)}`;
    }
    return null;
  }

  if (/^\d{1,2}$/.test(t) && month && /^\d{4}-\d{2}$/.test(month)) {      // bare day number + month
    const day = Number(t);
    if (day >= 1 && day <= 31) return `${month}-${pad(day)}`;
  }
  return null;
}

const EMP_CODE_ALIASES = new Set(['empcode', 'employeecode', 'empno', 'employeeno', 'empid', 'employeeid', 'code']);

export interface GridCell { empCode: string; date: string; code: string; }
export interface ParsedGrid {
  cells: GridCell[];
  dates: string[];          // distinct dates seen, sorted
  unrecognized: string[];   // marks we couldn't map (surfaced, not guessed)
}

/**
 * Unpivot a marked grid (a matrix of raw cell values) into employee-day-code rows.
 * Pure and synchronous so both the .xlsx and .csv readers feed the same logic and it
 * can be unit-tested without a binary fixture.
 */
export function parseMarkedGrid(matrix: any[][], opts: { month?: string } = {}): ParsedGrid {
  // 1. Locate the header row + the Emp Code column (scan the first rows only).
  let headerRow = -1;
  let empCol = -1;
  for (let r = 0; r < Math.min(matrix.length, 40); r++) {
    const row = matrix[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (EMP_CODE_ALIASES.has(norm(cellText(row[c])))) { headerRow = r; empCol = c; break; }
    }
    if (headerRow !== -1) break;
  }
  if (headerRow === -1) throw new ValidationError('Could not find an "Emp Code" column — check the sheet has an employee-code header row.');

  // 2. Date columns from the header row.
  const header = matrix[headerRow] || [];
  const dateCols: { col: number; date: string }[] = [];
  for (let c = 0; c < header.length; c++) {
    if (c === empCol) continue;
    const date = parseHeaderDate(header[c], opts.month);
    if (date) dateCols.push({ col: c, date });
  }
  if (dateCols.length === 0) {
    throw new ValidationError('No date columns found. Pick the month for this sheet, or include full dates in the header row.');
  }

  // 3. Read each employee row's cells under the date columns.
  const cells: GridCell[] = [];
  const dateSet = new Set<string>();
  const unrecognized = new Set<string>();
  for (let r = headerRow + 1; r < matrix.length; r++) {
    const row = matrix[r] || [];
    const empCode = cellText(row[empCol]).trim();
    if (!empCode) continue;                                              // blank / spacer / summary row
    for (const dc of dateCols) {
      const raw = cellText(row[dc.col]).trim().toUpperCase();
      if (!raw) continue;                                                // blank = weekly-off / not marked
      const status = CODE_MAP[raw];
      if (status) { cells.push({ empCode, date: dc.date, code: status }); dateSet.add(dc.date); }
      else if (!KNOWN_SKIP.has(raw)) unrecognized.add(raw);
    }
  }

  return { cells, dates: [...dateSet].sort(), unrecognized: [...unrecognized] };
}

/** Turn an uploaded file (buffer) into a 2-D matrix of cell values. */
async function readGridMatrix(buffer: Buffer, fileName: string): Promise<any[][]> {
  const lower = (fileName || '').toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    const ws = wb.worksheets[0];
    if (!ws) throw new ValidationError('The workbook has no sheets.');
    const matrix: any[][] = [];
    const maxCol = Math.min(ws.columnCount || 0, 400);                   // guard against a runaway sparse sheet
    ws.eachRow({ includeEmpty: true }, (row) => {
      const out: any[] = [];
      for (let c = 1; c <= maxCol; c++) out.push(row.getCell(c).value);
      matrix.push(out);
    });
    return matrix;
  }
  if (lower.endsWith('.csv') || lower.endsWith('.txt') || !lower.includes('.')) {
    const text = buffer.toString('utf-8');
    return text.split(/\r?\n/).map((line) => splitCsvLine(line));
  }
  throw new ValidationError('Unsupported file type — upload the dashboard as .xlsx or .csv.');
}

/** Minimal CSV line split with basic double-quote handling (the grid has no embedded newlines). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export interface GridUploadResult {
  total: number;        // employee-day marks read from the grid
  created: number;
  updated: number;
  skipped: number;      // unmatched employee, locked month, or HR-authoritative day
  unmatched: string[];  // employee codes not found
  unrecognized: string[];
  locked_months: string[];
  dates: string[];
  // Marks that landed on a day the person was not scheduled to work. Reported, never counted as
  // `skipped` — those are problems, and this is routine. Every register has them, because of
  // course there is no punch on a rest day.
  off_calendar: number;
  off_calendar_sample: Array<{ employee_code: string; date: string; code: string; kind: string; because: string }>;
}

/**
 * Import a marked attendance dashboard. Each cell's code is written as the day's status,
 * with three protections that mirror the biometric upload:
 *   • an approved leave (status = 'on_leave') or an approved regularisation
 *     (is_regularised) is never overwritten — HR's correction stands;
 *   • a date whose payroll month is locked is skipped (never re-price a paid month);
 *   • the grid is code-only, so any stale punch data on an overwritten day is cleared,
 *     keeping the code authoritative (the hour-threshold catch-up pass skips punch-less
 *     days, so a grid verdict stays put).
 */
export async function uploadMarkedGrid(buffer: Buffer, fileName: string, month?: string): Promise<GridUploadResult> {
  const matrix = await readGridMatrix(buffer, fileName);
  const { cells, dates, unrecognized } = parseMarkedGrid(matrix, { month });
  if (cells.length === 0) throw new ValidationError('No attendance codes were found in the sheet.');

  // Resolve employees once.
  const empCodes = [...new Set(cells.map((c) => c.empCode))];
  const employees = await db('employees').whereIn('employee_code', empCodes).select('id', 'employee_code');
  const empMap = new Map<string, number>(employees.map((e: any) => [String(e.employee_code), e.id]));

  // Which of the touched months are locked — skip those days rather than fail the whole file.
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))];
  const lockedMonths = new Set<string>();
  for (const m of months) {
    const [year, mon] = m.split('-').map(Number);
    const run = await db('payroll_runs').where({ month: mon, year }).first();
    if (run?.status === 'locked') lockedMonths.add(m);
  }

  const result: GridUploadResult = {
    total: cells.length, created: 0, updated: 0, skipped: 0,
    unmatched: [], unrecognized, locked_months: [...lockedMonths], dates,
    off_calendar: 0, off_calendar_sample: [],
  };

  // One work calendar per employee for the whole upload, built once and reused across their ~31
  // cells. A grid cell is a clerical mark, not evidence: writing "no punch" onto somebody's rest
  // day records nothing (nobody was working) while making every attendance summary read as though
  // they had missed a shift. The biometric path deliberately does NOT do this — a punch IS
  // evidence somebody was there, and dropping it would destroy the only record of it.
  const sorted = [...dates].sort();
  const calendars = new Map<number, Awaited<ReturnType<typeof buildWorkCalendar>>>();
  for (const employeeId of new Set(empMap.values())) {
    calendars.set(employeeId, await buildWorkCalendar(employeeId, sorted[0], sorted[sorted.length - 1]));
  }

  for (const cell of cells) {
    const employeeId = empMap.get(cell.empCode);
    if (!employeeId) {
      result.skipped++;
      if (!result.unmatched.includes(cell.empCode)) result.unmatched.push(cell.empCode);
      continue;
    }
    if (lockedMonths.has(cell.date.slice(0, 7))) { result.skipped++; continue; }

    const day = calendars.get(employeeId)?.classify(cell.date);
    if (day && day.base !== 'working') {
      result.off_calendar++;
      if (result.off_calendar_sample.length < 20) {
        result.off_calendar_sample.push({
          employee_code: cell.empCode, date: cell.date, code: cell.code,
          kind: day.base, because: day.base === 'holiday' ? (day.holidayName ?? 'Holiday') : day.sourceName,
        });
      }
      continue;
    }

    const existing = await db('attendance_records')
      .where({ employee_id: employeeId, date: cell.date }).first();

    if (existing) {
      // Never overwrite an approved leave or an approved regularisation.
      if (existing.status === 'on_leave' || existing.is_regularised) { result.skipped++; continue; }
      await db('attendance_records').where('id', existing.id).update({
        status: cell.code,
        check_in: null, check_out: null, working_hours: null,          // code is authoritative; drop stale punches
        updated_at: db.fn.now(),
      });
      result.updated++;
    } else {
      await db('attendance_records').insert({
        employee_id: employeeId,
        date: cell.date,
        status: cell.code,
      });
      result.created++;
    }
  }

  return result;
}

// ─── Blank templates for the two upload formats ───

/** CSV-escape a cell: names and properties can contain commas or quotes. */
const csvCell = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/**
 * A ready-to-fill marked grid for one month: one row per active employee, one column per date.
 *
 * Pre-filled with the real roster rather than handed over as an empty shell, because the two
 * things most likely to be typed wrong are the employee code and the date header — and those are
 * exactly the two the importer matches on. A file built here cannot mismatch a code that exists
 * or carry a header this parser will not read, so what is left for a human is the part only a
 * human knows: the cell.
 *
 * Column headers are ISO dates, which `parseHeaderDate` reads without needing the month hint.
 */
export async function buildMarkedGridTemplate(month: string): Promise<string> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new ValidationError('Month must look like 2026-07');
  const [year, mon] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const dates = Array.from({ length: daysInMonth }, (_, i) => `${month}-${pad(i + 1)}`);

  const employees = await db('employees')
    .where('is_active', true)
    .select('employee_code', 'first_name', 'last_name', 'dept_name', 'branch_name')
    .orderBy(['branch_name', 'first_name']);

  const header = ['Emp Code', 'Name', 'Department', 'Property', ...dates].map(csvCell).join(',');
  const rows = employees.map((e: any) => [
    e.employee_code,
    `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim(),
    e.dept_name ?? '',
    e.branch_name ?? '',
    ...dates.map(() => ''), // the part a human fills in
  ].map(csvCell).join(','));

  // A legend the parser ignores (no day number in the first cell, so it is never read as a date
  // header) but a person reading the file in Excel needs.
  const legend = [
    '',
    // HD and HHD are the pair people confuse, so the legend names what separates them: HD spends
    // half a leave day, HHD is a day the business only opened for half of and spends none. This
    // line used to describe HD under HHD, which is exactly backwards.
    csvCell('Codes: P = Present · NP = No Punch · A = Absent · HD = Half Day (uses ½ leave) · SP = Short Punch · MP = Miss Punch · HHD = Half-Day Holiday'),
    csvCell('Weekly offs, holidays and approved leave are calendar-driven — leave those cells blank rather than coding them.'),
  ];
  return [header, ...rows, ...legend].join('\n');
}

