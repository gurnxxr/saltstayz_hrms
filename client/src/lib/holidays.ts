import { formatDate } from './utils';
import type { HolidayRow, AdminHolidayRow } from './types';

/**
 * Holiday-list helpers.
 *
 * Everything here works on the raw 'YYYY-MM-DD' string and never parses it with `new Date`.
 * A bare date parses as UTC midnight and then renders in the browser's zone, so west of UTC
 * `new Date('2026-01-26')` shows as the 25th and `new Date('2026-01-01').getMonth()` returns
 * 11 — filing New Year's Day under December. Comparing and slicing the string avoids both.
 *
 * `formatDate` (lib/utils) is safe for display because it pins Asia/Kolkata explicitly.
 */

/** Today in IST as 'YYYY-MM-DD'. 'en-CA' gives ISO order, so it compares as a plain string. */
export function istToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

/** Whole days from `a` to `b`. UTC arithmetic on split components, so DST cannot skew it. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.slice(0, 10).split('-').map(Number);
  const [by, bm, bd] = b.slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** 0-indexed month, read off the string rather than a parsed date. */
export const monthOf = (date: string) => Number(date.slice(5, 7)) - 1;

/** Day of the month, without a leading zero. */
export const dayOf = (date: string) => Number(date.slice(8, 10));

export function relativeDay(date: string, today = istToday()): string {
  const diff = daysBetween(today, date);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 0) return `in ${diff} days`;
  return `${-diff} days ago`;
}

export interface RosterHint {
  tone: 'warn' | 'good';
  text: string;
  /** Extra context shown where there is room, or as a tooltip. */
  detail?: string;
}

/**
 * The one line worth saying about how a holiday lands on this person's roster — or nothing.
 *
 * Most holidays are an ordinary single day off and get no annotation at all. That silence is
 * deliberate: a badge on every row is noise, and noise is what stops anyone reading the two
 * rows that actually matter.
 */
export function rosterHint(h: HolidayRow): RosterHint | null {
  if (!h.in_employment) return null;

  if (h.falls_on === 'weekly_off') {
    return {
      tone: 'warn',
      text: 'Falls on your weekly off',
      detail: h.decided_by_name ? `Your rest day comes from: ${h.decided_by_name}` : undefined,
    };
  }

  // `break_bounded` means the run hit the edge of the window the server measured, which in
  // practice means a pattern with no working days at all. Announcing a 300-day weekend would
  // be worse than saying nothing.
  if (h.break_days >= 3 && !h.break_bounded) {
    const from = formatDate(h.break_start, { year: undefined });
    const to = formatDate(h.break_end, { year: undefined });
    return { tone: 'good', text: `Long weekend · ${h.break_days} days off`, detail: `${from} – ${to}` };
  }

  return null;
}

export interface MonthGroup {
  month: number;
  label: string;
  holidays: HolidayRow[];
}

/**
 * All twelve months, empty ones kept.
 *
 * The year should read like a calendar, and the current month has to be findable whether or not
 * it happens to contain a holiday. The caller short-circuits to an empty state when the whole
 * year is empty, so this never renders twelve "nothing here" rows.
 */
export function groupByMonth(holidays: HolidayRow[], year: number): MonthGroup[] {
  const months: MonthGroup[] = Array.from({ length: 12 }, (_, m) => ({
    month: m,
    label: new Date(year, m, 1).toLocaleDateString('en-IN', { month: 'long' }),
    holidays: [],
  }));
  for (const h of holidays) months[monthOf(h.date)]?.holidays.push(h);
  return months;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin side: describing who a holiday was given to.
// ─────────────────────────────────────────────────────────────────────────────

export interface AudienceLabel {
  /** Short enough for a table cell that must never wrap. */
  label: string;
  /** The full expansion, for a title tooltip. */
  detail: string;
  tone: 'all' | 'partial' | 'none';
}

/**
 * The "who gets this" cell.
 *
 * Names up to two departments and counts beyond that: "Management, HR" reads as an answer,
 * "Management, HR, Front Desk, Security" reads as a list you have to parse. Hotels are always
 * counted rather than named, because hotel names are long and there are a dozen of them.
 *
 * A reach of zero overrides everything — "3 of 5 departments" printed on a holiday nobody gets
 * is a lie in the one column that exists to catch that.
 */
export function audienceLabel(h: AdminHolidayRow, totalDepartments: number): AudienceLabel {
  const deptNames = h.departments.map((d) => d.name);
  const propNames = h.properties.map((p) => p.name);

  const deptPart = h.all_departments
    ? 'All departments'
    : deptNames.length <= 2 && deptNames.length > 0
      ? deptNames.join(', ')
      : `${h.department_ids.length} of ${totalDepartments || h.department_ids.length} departments`;

  const propPart = h.all_properties
    ? null
    : propNames.length === 1
      ? propNames[0]
      : `${h.property_ids.length} hotels`;

  const detail = [
    h.all_departments ? 'Every department' : (deptNames.join(', ') || 'no departments picked'),
    h.all_properties ? 'every hotel' : (propNames.join(', ') || 'no hotels picked'),
  ].join(' — at ') + ` · reaches ${h.reaches_count} employee${h.reaches_count === 1 ? '' : 's'}`;

  if (h.reaches_count === 0) return { label: 'Reaches nobody', detail, tone: 'none' };
  if (h.all_departments && h.all_properties) return { label: 'Everyone', detail, tone: 'all' };
  return { label: propPart ? `${deptPart} · ${propPart}` : deptPart, detail, tone: 'partial' };
}

/**
 * The live sentence above the audience editor, so three axes never have to be held in the head
 * at once. Regenerated on every tick.
 */
export function audienceSentence(
  name: string,
  draft: { all_departments: boolean; department_ids: number[]; all_properties: boolean; property_ids: number[] },
  departments: Array<{ id: number; name: string }>,
  properties: Array<{ id: number; name: string }>,
  region: { is_national: boolean; state: string | null },
): string {
  const nameOf = (list: Array<{ id: number; name: string }>, ids: number[]) =>
    ids.map((id) => list.find((x) => x.id === id)?.name).filter(Boolean) as string[];

  const who = draft.all_departments
    ? 'every department'
    : (() => {
      const picked = nameOf(departments, draft.department_ids);
      if (!picked.length) return 'NOBODY — no department is picked';
      if (picked.length === 1) return picked[0];
      return `${picked.slice(0, -1).join(', ')} and ${picked[picked.length - 1]}`;
    })();

  const where = draft.all_properties
    ? (region.is_national ? 'every hotel' : `hotels in ${region.state}`)
    : (() => {
      const picked = nameOf(properties, draft.property_ids);
      if (!picked.length) return 'NO hotel — none is picked';
      if (picked.length === 1) return picked[0];
      return `${picked.length} hotels`;
    })();

  return `${name || 'This holiday'} applies to ${who}, at ${where}.`;
}
