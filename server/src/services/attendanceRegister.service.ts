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
 * The eight codes and their order mirror SUMMARY_CODES in analytics.service.ts and
 * ATTENDANCE_CODES on the client, and attendanceCodes.test.ts fails the build if they drift.
 */

const CODES = [
  'present', 'no_punch', 'half_day', 'short_punch', 'miss_punch', 'hhd', 'absent', 'on_leave',
] as const;

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

/** First and last day of a month, as the TEXT the date column stores. */
function monthBounds(month?: string): { start: string; end: string; month: string } {
  const m = month || new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(m)) throw new ValidationError('Month must look like 2026-07');
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
  if (f.property) q.where('e.branch_name', f.property);
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

/** One row per employee: who they are, and how many of each code they have this month. */
export async function getRegister(filters: RegisterFilters) {
  const { start, end, month } = monthBounds(filters.month);

  const rows = () => registerQuery(filters, start, end)
    .select(...EMPLOYEE_COLUMNS, ...countColumns())
    .groupBy(...EMPLOYEE_COLUMNS)
    .orderBy(['e.first_name', 'e.last_name']);

  // Totals over the WHOLE filtered set, not the visible page — a footer that summed 25 rows would
  // change meaning every time somebody paged, while looking like a grand total.
  const totalsRow: any = await registerQuery(filters, start, end)
    .select(...countColumns()).first();
  const totals = Object.fromEntries([
    ...CODES.map((c) => [c, Number(totalsRow?.[c] ?? 0)]),
    ['recorded', Number(totalsRow?.recorded ?? 0)],
  ]);

  // Count employees, not rows: the grouped query returns one row per person, so a plain count()
  // over it would count groups only if wrapped — cheaper to count the employees directly.
  const countRow: any = await applyRegisterFilters(db('employees as e'), filters)
    .count('e.id as c').first();
  const total = Number(countRow?.c ?? 0);

  if (!filters.page) return { data: await rows(), total, totals, month };

  const page = Math.max(1, filters.page);
  const pageSize = Math.min(Math.max(1, filters.pageSize || 25), 200);
  const data = await rows().limit(pageSize).offset((page - 1) * pageSize);

  return {
    data, total, totals, month,
    page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * The same employees, plus a status per day — the wall of code letters.
 *
 * Two queries rather than a pivot in SQL: the page's employees, then every record belonging to
 * them in one flat fetch, keyed up in JS. At 25 rows x 31 days that is under 800 rows, and it
 * keeps the shape identical to the summary's so the two views cannot disagree about who is listed.
 */
export async function getDayGrid(filters: RegisterFilters) {
  const { start, end, month } = monthBounds(filters.month);
  const summary = await getRegister(filters);
  const employees = summary.data as any[];

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
    ...summary,
    dates,
    data: employees.map((e) => ({ ...e, days: byEmployee.get(e.id) ?? {} })),
  };
}

/** The register as CSV — the on-screen selection, every page of it. */
export async function exportRegisterCsv(filters: RegisterFilters): Promise<string> {
  // Unpaginated on purpose: the file is what the filters select, not the 25 rows being looked at.
  const { data, month } = await getRegister({ ...filters, page: undefined, pageSize: undefined });

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
