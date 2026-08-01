import db from '../config/database';
import { buildCsv } from '../utils/csv';
import { ValidationError } from '../utils/errors';

/**
 * The month's attendance, one row per employee — the register HR keeps in Excel.
 *
 * Nothing in this codebase grouped attendance by employee over a month before this file. Every
 * monthly figure came from looping getMonthSummary once per person, which is fine for one
 * dashboard and useless as a report. This is one GROUP BY over the same CASE ladder.
 *
 * The eight codes and their order mirror getMonthSummary's SQL, SUMMARY_CODES in analytics.service
 * and ATTENDANCE_CODES on the client. attendanceCodes.test.ts reads this file by path and fails the
 * build if any of the four drift apart — add a code in one place and the test names the others.
 */

const CODES = [
  'present', 'no_punch', 'half_day', 'short_punch', 'miss_punch', 'hhd', 'absent', 'on_leave',
] as const;

/** Sentinel for "property blank, or not in the catalogue" — a real bucket, not a missing filter. */
export const UNASSIGNED = '__unassigned__';

/**
 * Ceiling on an unpaginated export. Generous enough for the whole company today and for the
 * 2,000-employee target, but it means one request cannot buffer an unbounded string in memory —
 * and the caller is told to narrow instead of waiting on a response that may never arrive.
 */
const EXPORT_MAX_ROWS = 5000;

export interface RegisterFilters {
  month?: string;
  /** The hotel — employees.branch_name. Named `property` because that is what it means. */
  property?: string;
  /**
   * The business unit — employees.branch_unit. Deliberately NOT called `branch`: every other
   * filter in this system spelled `branch` means the PROPERTY (see employee.service.ts:69), and
   * reusing the word here would quietly point this filter at the wrong column.
   */
  branch_unit?: string;
  department?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

/**
 * A month string, or a 400.
 *
 * Exported because the drill-down needs the identical check: it hands the month to getMyCalendar,
 * where an unvalidated "abc" became the bounds 'abc-01'..'abc-NaN' and returned a silently empty
 * month rather than the error its sibling endpoints give for the same input.
 */
export function assertMonth(month?: string): string {
  const m = month || new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new ValidationError('Month must look like 2026-07');
  return m;
}

/** First and last day of a month, as the TEXT the date column stores. */
function monthBounds(month?: string): { start: string; end: string; month: string } {
  const m = assertMonth(month);
  const [y, mo] = m.split('-').map(Number);
  // Real last day, not a blanket 31 — getMonthSummary gets away with '-31' only because the
  // column is text and nothing sorts past it. Doing it properly costs one line.
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { start: `${m}-01`, end: `${m}-${String(last).padStart(2, '0')}`, month: m };
}

/**
 * Shared WHERE builder for the list, its count, the day grid and the CSV export — so all four
 * select exactly the same people. An export that filtered differently from the table above it
 * would hand over a different set of employees than the one on screen.
 */
function applyRegisterFilters(q: any, f: RegisterFilters) {
  q.where('e.is_active', true);

  if (f.property === UNASSIGNED) {
    // Employees whose property is blank or matches no row in the catalogue. Without this they are
    // unreachable the moment any property filter is set — and a register whose whole job is showing
    // gaps must not hide the people whose own placement is the gap.
    q.where((w: any) => w
      .whereNull('e.branch_name').orWhere('e.branch_name', '')
      .orWhereNotExists(function (this: any) {
        this.select(db.raw('1')).from('properties as p').whereRaw('lower(p.name) = lower(e.branch_name)');
      }));
  } else if (f.property) {
    // Based there OR worked there. The per-day view resolves a property as
    // COALESCE(ar.location, e.branch_name); across a month one employee can have punches at several
    // locations, so "one property per person" has no answer — matching either fact means filtering
    // by a property finds everyone who appeared in it, which is what the question means.
    q.where((w: any) => w
      .where('e.branch_name', f.property)
      .orWhereExists(function (this: any) {
        this.select(db.raw('1')).from('attendance_records as loc')
          .whereRaw('loc.employee_id = e.id')
          .where('loc.location', f.property);
      }));
  }

  if (f.branch_unit) q.where('e.branch_unit', f.branch_unit);
  if (f.department) q.where('e.dept_name', f.department);
  if (f.search) {
    const term = `%${f.search.trim()}%`;
    q.where((w: any) => w
      .where('e.first_name', 'ilike', term)
      .orWhere('e.last_name', 'ilike', term)
      .orWhere('e.employee_code', 'ilike', term));
  }
  return q;
}

/**
 * The CASE ladder, once — the same one getMonthSummary uses.
 *
 * No date predicate here: the month is applied in the JOIN condition (see registerQuery), so
 * these aggregate only over rows the join already admitted.
 */
function countColumns() {
  return [
    db.raw('COUNT(ar.id) as recorded'),
    ...CODES.map((c) => db.raw(`SUM(CASE WHEN ar.status = ? THEN 1 ELSE 0 END) as ${c}`, [c])),
    db.raw('ROUND(AVG(ar.working_hours)::numeric, 1) as avg_hours'),
  ];
}

/**
 * Employees LEFT JOINed to their records for the month.
 *
 * The date predicate lives in the JOIN, not the WHERE: an employee with no attendance at all must
 * still come back, as a row of zeros. A register exists to show gaps, and moving this into WHERE
 * would silently drop exactly the people you opened it to find. Same shape getPropertyEmployees
 * uses for its one-day view.
 */
function registerQuery(f: RegisterFilters, start: string, end: string) {
  return applyRegisterFilters(
    db('employees as e').leftJoin('attendance_records as ar', function () {
      this.on('ar.employee_id', 'e.id')
        .andOnVal('ar.date', '>=', start)
        .andOnVal('ar.date', '<=', end);
    }),
    f,
  );
}

const EMPLOYEE_COLUMNS = [
  'e.id', 'e.employee_code', 'e.first_name', 'e.last_name',
  'e.dept_name', 'e.branch_name', 'e.branch_unit',
];

/**
 * One row per employee: who they are, and how many of each code they have this month.
 *
 * `withTotals: false` skips the full-set aggregate — the export needs the rows and nothing else,
 * and that aggregate scans every matching employee joined to a month of attendance.
 */
export async function getRegister(
  filters: RegisterFilters,
  opts: { withTotals?: boolean; unpaginated?: boolean } = {},
) {
  const { withTotals = true, unpaginated = false } = opts;
  const { start, end, month } = monthBounds(filters.month);

  const rows = () => registerQuery(filters, start, end)
    .select(...EMPLOYEE_COLUMNS, ...countColumns())
    .groupBy(...EMPLOYEE_COLUMNS)
    // e.id breaks ties. Without a unique last key the order is not stable between the LIMIT/OFFSET
    // executions that build consecutive pages, so two employees sharing a name can both land on
    // page 1 while somebody else never appears at all.
    .orderBy(['e.first_name', 'e.last_name', 'e.id']);

  // Totals over the WHOLE filtered set, not the visible page — a footer that summed 25 rows would
  // change meaning every time somebody paged, while looking like a grand total.
  let totals: Record<string, number> | undefined;
  if (withTotals) {
    const totalsRow: any = await registerQuery(filters, start, end)
      .select(...countColumns()).first();
    totals = Object.fromEntries([
      ...CODES.map((c) => [c, Number(totalsRow?.[c] ?? 0)]),
      ['recorded', Number(totalsRow?.recorded ?? 0)],
    ]);
  }

  // Count employees, not rows: the grouped query returns one row per person, so a plain count()
  // over it would count groups only if wrapped — cheaper to count the employees directly.
  const countRow: any = await applyRegisterFilters(db('employees as e'), filters)
    .count('e.id as c').first();
  const total = Number(countRow?.c ?? 0);

  // Returning EVERY row is opt-in via `unpaginated`, never inferred from a falsy page. It used to
  // key off `!filters.page`, so `page=0` — and `page=abc`, which parses to NaN — silently asked for
  // the entire table. The export is the only caller that wants that, and it now says so.
  if (unpaginated) {
    // Capped rather than unbounded, so one request cannot buffer an arbitrarily large string.
    if (total > EXPORT_MAX_ROWS) {
      throw new ValidationError(
        `That selection is ${total} employees. Narrow the filters to ${EXPORT_MAX_ROWS} or fewer, then export.`,
      );
    }
    return { data: await rows(), total, totals, month };
  }

  const page = Number.isInteger(filters.page) && filters.page! > 0 ? filters.page! : 1;
  const pageSize = Math.min(Math.max(1, Math.floor(filters.pageSize || 25) || 25), 200);
  const data = await rows().limit(pageSize).offset((page - 1) * pageSize);

  return {
    data, total, totals, month,
    page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * The same employees, plus a status per day — the wall of code letters.
 *
 * Three lean queries rather than reusing getRegister, which would run the eight-branch CASE ladder
 * and a totals aggregate over the ENTIRE filtered set to produce numbers this view never renders.
 * The grid needs identity and days, nothing else. It shares applyRegisterFilters and the same sort
 * with the summary, so the two views still cannot disagree about who is listed or in what order.
 */
export async function getDayGrid(filters: RegisterFilters) {
  const { start, end, month } = monthBounds(filters.month);

  const countRow: any = await applyRegisterFilters(db('employees as e'), filters)
    .count('e.id as c').first();
  const total = Number(countRow?.c ?? 0);

  const page = Math.max(1, filters.page || 1);
  const pageSize = Math.min(Math.max(1, filters.pageSize || 25), 200);

  const employees: any[] = await applyRegisterFilters(db('employees as e'), filters)
    .select(...EMPLOYEE_COLUMNS)
    .orderBy(['e.first_name', 'e.last_name', 'e.id'])
    .limit(pageSize).offset((page - 1) * pageSize);

  const [y, mo] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const dates = Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);

  const ids = employees.map((e) => e.id);
  const records = ids.length
    ? await db('attendance_records')
      .whereIn('employee_id', ids).whereBetween('date', [start, end])
      .select('employee_id', 'date', 'status', 'is_regularised')
    : [];

  const byEmployee = new Map<number, Record<string, any>>();
  for (const r of records as any[]) {
    if (!byEmployee.has(r.employee_id)) byEmployee.set(r.employee_id, {});
    byEmployee.get(r.employee_id)![String(r.date).slice(0, 10)] = {
      status: r.status, regularised: !!r.is_regularised,
    };
  }

  return {
    month, dates, total, page, pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    data: employees.map((e) => ({ ...e, days: byEmployee.get(e.id) ?? {} })),
  };
}

/** The register as CSV — the on-screen selection, every page of it. */
export async function exportRegisterCsv(filters: RegisterFilters): Promise<string> {
  // Unpaginated on purpose: the file is what the filters select, not the 25 rows being looked at.
  // withTotals:false because the footer aggregate is a full scan whose numbers no CSV column shows.
  const { data, month } = await getRegister(filters, { withTotals: false, unpaginated: true });

  const header = [
    'employee_code', 'employee_name', 'property', 'branch_unit', 'department',
    'present', 'no_punch', 'half_day', 'short_punch', 'miss_punch', 'hhd', 'absent', 'on_leave',
    'recorded', 'avg_hours', 'month',
  ];
  return buildCsv(header, (data as any[]).map((r) => [
    r.employee_code,
    `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim(),
    r.branch_name ?? '',
    r.branch_unit ?? '',
    r.dept_name ?? '',
    ...CODES.map((c) => Number(r[c] ?? 0)),
    Number(r.recorded ?? 0),
    r.avg_hours ?? '',
    month,
  ]));
}
