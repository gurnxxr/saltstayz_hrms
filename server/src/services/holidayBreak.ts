/**
 * Pure holiday-break maths — no database, no clock.
 *
 * A holiday on its own says nothing about whether someone actually gets a day off. What matters
 * is the run of consecutive non-working days it sits inside: a Friday holiday against a Saturday
 * and Sunday off is a three-day break, while the same holiday landing on a rest day someone
 * already had is not a break at all.
 *
 * Kept separate and pure — like `shiftPattern.ts` — so the walk can be tested directly with a
 * plain predicate rather than only through a database and a work calendar.
 */

/** Shift a 'YYYY-MM-DD' date by whole days. UTC throughout, so no timezone can move a date. */
export function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b`, negative when `b` is earlier. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.slice(0, 10).split('-').map(Number);
  const [by, bm, bd] = b.slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export interface Break {
  /** First day of the run. */
  start: string;
  /** Last day of the run. */
  end: string;
  /** Length of the run in days, always at least 1. */
  days: number;
  /**
   * The run reached the edge of the window rather than a working day, so `days` is a floor
   * rather than the real length.
   *
   * In practice this means a data problem, not a genuinely long break: an employee whose
   * pattern declares every day off produces a run that walks the entire window. Callers should
   * suppress the break rather than announce a year-long weekend.
   */
  bounded: boolean;
}

/**
 * The maximal run of consecutive non-working days containing `date`.
 *
 * `isBreakDay` decides what counts — typically "not a working day, and inside their employment".
 * The date itself is assumed to be part of the run; when it is not (a holiday on a day they were
 * not employed for), the caller should skip the walk entirely.
 *
 * Termination is structural rather than a counter: each step moves strictly one day toward a
 * fixed edge of [windowStart, windowEnd], so the walk cannot exceed the window's width even when
 * every day in it qualifies.
 */
export function findBreak(
  date: string,
  isBreakDay: (d: string) => boolean,
  windowStart: string,
  windowEnd: string,
): Break {
  const on = date.slice(0, 10);
  let start = on;
  let hitStart = false;
  for (;;) {
    const prev = shiftDate(start, -1);
    if (prev < windowStart) { hitStart = true; break; }
    if (!isBreakDay(prev)) break;
    start = prev;
  }

  let end = on;
  let hitEnd = false;
  for (;;) {
    const next = shiftDate(end, 1);
    if (next > windowEnd) { hitEnd = true; break; }
    if (!isBreakDay(next)) break;
    end = next;
  }

  return { start, end, days: daysBetween(start, end) + 1, bounded: hitStart || hitEnd };
}
