/**
 * Pure shift-pattern maths — no database, no clock.
 *
 * A shift declares which weekdays it doesn't work, optionally narrowed to particular
 * occurrences in the month: "every Sunday, plus the 2nd and 4th Saturday" is the common
 * Indian arrangement. This is what replaces someone filling in a weekly roster grid.
 *
 * Kept separate and pure so the rules that decide whether a day is paid can be tested
 * directly, rather than only through a database.
 */

export interface OffDayRule {
  /** 0 = Sunday … 6 = Saturday. */
  day: number;
  /** Which occurrences of that weekday in the month, or null for every week. */
  weeks: number[] | null;
}

/** Day of week for a YYYY-MM-DD string. 0 = Sunday. */
export function dayOfWeek(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Which occurrence of its own weekday a date is within its month — the 1st Saturday, the
 * 2nd, and so on. Purely positional: the 8th of any month is always the 2nd of its weekday.
 */
export function occurrenceInMonth(iso: string): number {
  const dayOfMonth = Number(iso.slice(8, 10));
  return Math.floor((dayOfMonth - 1) / 7) + 1;
}

/** Normalises whatever came out of storage into rules we can evaluate. */
export function parseOffDayRules(raw: unknown): OffDayRule[] {
  let value: unknown = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(value)) return [];
  const out: OffDayRule[] = [];
  for (const entry of value) {
    const day = Number((entry as any)?.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) continue;
    const rawWeeks = (entry as any)?.weeks;
    const weeks = Array.isArray(rawWeeks) && rawWeeks.length
      ? rawWeeks.map(Number).filter((w: number) => Number.isInteger(w) && w >= 1 && w <= 5)
      : null;
    out.push({ day, weeks: weeks && weeks.length ? weeks : null });
  }
  return out;
}

/**
 * Whether a date is an off day under a shift's pattern.
 *
 * An empty pattern means the shift declares no off days at all — the caller decides what to
 * do then (in practice: fall back to the company work week). It deliberately does NOT mean
 * "works every day", because a shift with nothing configured shouldn't quietly turn weekends
 * into working days.
 */
export function isOffDay(iso: string, rules: OffDayRule[]): boolean {
  if (!rules.length) return false;
  const dow = dayOfWeek(iso);
  const occurrence = occurrenceInMonth(iso);
  return rules.some((r) => r.day === dow && (r.weeks === null || r.weeks.includes(occurrence)));
}

/**
 * Length of a shift in hours, wrapping past midnight when the end is at or before the start.
 *
 * Deliberately identical to the arithmetic this replaced, so shift lengths — and therefore
 * pay — cannot drift as a side effect of the rework.
 *
 * `ends_next_day` is NOT an input here. It says which calendar day the hours belong to, which
 * matters for attendance, not how long the shift is. Feeding it into the length would mean a
 * day shift with the box mistakenly ticked measured 33 hours instead of 9.
 */
export function shiftLengthHours(start?: string | null, end?: string | null): number {
  if (!start || !end) return 0;
  const toMin = (t: string) => {
    const [h, m] = String(t).split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  let diff = toMin(end) - toMin(start);
  if (diff <= 0) diff += 24 * 60;
  return diff / 60;
}

/**
 * The number of hours that count as a full day.
 *
 * Prefers what the shift says explicitly, then its office-hour time, then its own length —
 * so a shift with nothing configured still measures against something sensible.
 */
export function fullDayHoursFor(shift: {
  full_day_hours?: number | null;
  office_hour_time?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  ends_next_day?: boolean | null;
} | null | undefined, fallback: number): number {
  if (!shift) return fallback;
  const explicit = Number(shift.full_day_hours) || 0;
  if (explicit > 0) return explicit;
  if (shift.office_hour_time) {
    const [h, m] = String(shift.office_hour_time).split(':').map(Number);
    const hours = (h || 0) + (m || 0) / 60;
    if (hours > 0) return hours;
  }
  const span = shiftLengthHours(shift.start_time, shift.end_time);
  return span > 0 ? span : fallback;
}
