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
 * Which off-day rules are allowed to decide a date.
 *
 * A work pattern is configured today but evaluated across history, and `pickAssignmentFor` will
 * project an assignment backwards over dates that pre-date it. Together those mean a pattern saved
 * this morning can silently redefine which days were working days in a month that has already been
 * paid — moving its salary divisor, and with it every deduction in that month.
 *
 * `notBefore` is the first date any pattern may speak for: the day the patterns were introduced.
 * Earlier dates resolve to no pattern at all, which is exactly an unconfigured shift, so they keep
 * whatever priced them at the time.
 *
 * It is deliberately a FIXED date rather than "the month after the newest locked run". A moving
 * boundary would suppress patterns for the very months those patterns had already priced: lock
 * June, and June's own calendar would change underneath its own payslips.
 *
 * A null `notBefore` means there is no history to protect — a fresh install, or a test database.
 */
export function rulesInForceOn(
  iso: string, rules: OffDayRule[], notBefore?: string | null,
): OffDayRule[] {
  if (!notBefore) return rules;
  return String(iso).slice(0, 10) >= String(notBefore).slice(0, 10) ? rules : [];
}

/**
 * Which of an employee's dated assignments governs a given date.
 *
 * The answer is the latest assignment starting on or before that date. When the date falls
 * before every assignment — which happens for attendance older than the mapping itself — the
 * earliest assignment is used instead, so no historical date is left without a shift.
 *
 * That backfill only applies to an assignment that has ACTUALLY STARTED. Without the check, an
 * employee whose only assignment is future-dated — the normal result of approving a shift-change
 * request, which forces a date of today or later — would have that future shift govern every
 * date in their history, silently rewriting the work calendar of months already gone.
 *
 * Returns null when nothing applies; the caller then treats them as unassigned.
 *
 * `rows` must be sorted ascending by `effective_from`.
 */
export function pickAssignmentFor<T extends { effective_from?: string | null }>(
  rows: T[], date: string, today: string,
): T | null {
  if (!rows.length) return null;
  const on = String(date).slice(0, 10);
  const startOf = (r: T) => String(r.effective_from ?? '').slice(0, 10);

  let chosen: T | null = null;
  for (const r of rows) {
    if (startOf(r) <= on) chosen = r; else break;
  }
  if (chosen) return chosen;

  const earliest = rows[0];
  return startOf(earliest) <= String(today).slice(0, 10) ? earliest : null;
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
