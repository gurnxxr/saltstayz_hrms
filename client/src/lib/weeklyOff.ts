/**
 * The weekly off — what somebody's rest days are, and how to say them out loud.
 *
 * A pattern is `{ day, weeks }`: which weekday, and which occurrences of it inside the month
 * (`null` = every one). The occurrence is POSITIONAL — the 8th of any month is always the 2nd of
 * its weekday — the same rule `datesInMonth` (components/shifts/OffDayPicker) and the server's
 * `occurrenceInMonth` (services/shiftPattern) already apply. "Every Sunday, plus the 2nd and 4th
 * Saturday" is the common arrangement here and has to survive every trip through this file.
 *
 * `deriveWeeklyOff` reads that pattern back OUT of GET /attendance/my-calendar, which is the only
 * self-scoped surface answering the RESOLVED question — the shift's own pattern, then the
 * employee's leave template, then the Default template, then the organisation work week — but
 * answers it in materialised dates rather than rules.
 *
 * An empty pattern is NEVER "works every day". It is a pattern nobody configured, which is why
 * `offDaysInWords` makes the caller supply the empty wording instead of inventing one.
 */

/** `{ day: 0-6, weeks: number[] | null }` — `null` means every occurrence of that weekday. */
export interface OffDay { day: number; weeks: number[] | null }

export const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const SUFFIX = ['st', 'nd', 'rd', 'th', 'th'];
/** 1 → "1st". Occurrences are validated 1–5 server-side; the fallback is belt and braces. */
export const ordinal = (w: number) => `${w}${SUFFIX[w - 1] ?? 'th'}`;

/** Day of week for 'YYYY-MM-DD'. Built in UTC, so a browser behind Greenwich cannot shift it. */
const dowOf = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

/** Which occurrence of its own weekday a date is. Positional: the 8th is always the 2nd. */
const occurrenceOf = (iso: string) => Math.floor((Number(iso.slice(8, 10)) - 1) / 7) + 1;

/**
 * The pattern in words.
 *
 * `empty` is required on purpose. Three screens each invented their own — "Follows the company
 * work week", "Company work week", "—" — and the first two are false: an empty pattern at one rung
 * of the ladder says NOTHING about the rungs below it. Only the caller knows which rung it holds.
 */
export function offDaysInWords(
  rules: OffDay[] | null | undefined,
  opts: { empty: string },
): string {
  if (!Array.isArray(rules) || rules.length === 0) return opts.empty;
  const sorted = rules.slice().sort((a, b) => a.day - b.day);
  const weeksOf = (o: OffDay) => (Array.isArray(o.weeks) && o.weeks.length ? o.weeks : null);

  const join = (xs: string[]) =>
    xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : (xs[0] ?? '');
  const name = (o: OffDay) => DAYS_LONG[Number(o.day)] ?? 'that day';

  const parts: string[] = [];
  const everyWeek = sorted.filter((o) => !weeksOf(o));
  if (everyWeek.length) parts.push(`every ${join(everyWeek.map(name))}`);
  for (const o of sorted.filter((o) => weeksOf(o))) {
    parts.push(`the ${join(weeksOf(o)!.map(ordinal))} ${name(o)}`);
  }
  // "every Sunday, plus the 2nd and 4th Saturday" — said the way people actually say it.
  return parts.length > 1 ? `${parts[0]}, plus ${parts.slice(1).join(', ')}` : parts[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading the pattern back off the calendar.
// ─────────────────────────────────────────────────────────────────────────────

/** One entry of GET /attendance/my-calendar's `days[]`. Mirrors `MyCalendarDay` on the server. */
export interface CalendarDay {
  date: string;
  /** What to SHOW: `not_employed` wins over the roster's verdict. */
  kind: 'working' | 'weekly_off' | 'holiday' | 'not_employed';
  /** What the ROSTER said, employment span ignored. Absent on older responses. */
  base?: 'working' | 'weekly_off' | 'holiday';
  decided_by?: string;
  decided_by_name?: string;
  holiday_name?: string;
}

export interface WeeklyOff {
  /** The month it was read from, 'YYYY-MM'. */
  month: string;
  /** Off weekdays, Sunday first. EMPTY MEANS NO REST DAY AT ALL — not "unknown". */
  days: OffDay[];
  /** The first rest day on or after `today` that this person is still employed for, else null. */
  next: string | null;
  /** The policy in force at the end of the month: a shift, a leave template, or the work week. */
  decidedBy: string | null;
  /** `'shift'` | `'template'` | `'default_template'` | `'work_week'` — the machine answer. */
  decidedByKind: string | null;
}

/**
 * The weekly pattern, the next rest day, and what decided them.
 *
 * Two different fields answer the two questions, and swapping them breaks something real:
 *
 * - The PATTERN reads `base`, so a month clipped by a joining or leaving date still yields every
 *   occurrence. Read off `kind`, a 20th-of-the-month joiner loses the first three Saturdays and
 *   "the 2nd and 4th Saturday" silently becomes "the 4th Saturday".
 * - The NEXT REST DAY reads `kind`, which already respects the employment span, so a leaver is
 *   never promised a day off that falls after they have gone.
 */
export function deriveWeeklyOff(days: CalendarDay[], today: string): WeeklyOff | null {
  if (!days.length) return null;
  // Nothing to say to somebody who was not employed for a single day of the month. Returning an
  // empty pattern here would print "no weekly off is set for you", which is a different and far
  // more alarming claim than "you had not started yet".
  if (days.every((d) => d.kind === 'not_employed')) return null;

  // A shift assignment starting mid-month makes the month the UNION of two patterns, which is a
  // pattern nobody actually has. Derive from the policy in force at the end of the month, so the
  // card describes the arrangement that applies now. Holiday days name the holiday rather than the
  // policy, so they are no use for identifying it.
  const governed = days.filter((d) => d.decided_by && d.decided_by !== 'holiday');
  const governing = governed.length ? governed[governed.length - 1].decided_by_name : undefined;
  const sample = governing ? governed.filter((d) => d.decided_by_name === governing) : days;

  const seen = new Map<number, Set<number>>();  // occurrences of each weekday we could observe
  const off = new Map<number, Set<number>>();   // …of which these were rest days

  for (const d of sample) {
    // `base` is what this whole derivation rests on. Older responses may not carry it; fall back
    // to `kind`, which is right for everyone whose employment covers the month.
    const verdict = d.base ?? (d.kind === 'not_employed' ? undefined : d.kind);
    if (!verdict) continue;

    const dow = dowOf(d.date);
    const occ = occurrenceOf(d.date);
    let s = seen.get(dow); if (!s) { s = new Set(); seen.set(dow, s); }
    s.add(occ);

    if (verdict !== 'weekly_off') continue;
    let o = off.get(dow); if (!o) { o = new Set(); off.set(dow, o); }
    o.add(occ);
  }

  const out: OffDay[] = [];
  for (let dow = 0; dow < 7; dow++) {
    const offOcc = off.get(dow);
    if (!offOcc?.size) continue;
    // The load-bearing line. "Every week" is claimable only when every occurrence we could SEE was
    // a rest day — compared against what was observed, never against a hard-coded 4 or 5. A
    // Saturday off on 2 of its 5 occurrences must not render as a plain "Saturday off": that is
    // somebody turning up to an empty hotel, or a full one going unstaffed.
    const everyWeek = offOcc.size === (seen.get(dow)?.size ?? 0);
    out.push({ day: dow, weeks: everyWeek ? null : [...offOcc].sort((a, b) => a - b) });
  }

  // Provenance is read off rest days and only off those. Nothing is lost by skipping holidays,
  // because a holiday landing on a rest day still reports `weekly_off` — the engine answers the
  // off-day question before the holiday overlay — so its `decided_by_name` is the policy's name.
  const lastOff = [...days].reverse().find((d) => (d.base ?? d.kind) === 'weekly_off');

  return {
    month: days[0].date.slice(0, 7),
    days: out,
    next: days.find((d) => d.kind === 'weekly_off' && d.date >= today)?.date ?? null,
    decidedBy: lastOff?.decided_by_name ?? null,
    decidedByKind: lastOff?.decided_by ?? null,
  };
}
