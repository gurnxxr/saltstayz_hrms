/**
 * Today's date as the BUSINESS sees it, not as UTC does.
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC date. This company runs on IST (UTC+5:30),
 * so every day between 00:00 and 05:30 local the server believed it was still yesterday.
 *
 * That is not academic. HR assigning a shift at 1am wrote the browser's local date —
 * `2026-08-04` — into `effective_from`, and `pickAssignmentFor` compared it against the server's
 * `2026-08-03`, concluded the assignment had not started yet, and told the employee "No shift
 * assigned yet" until half past five in the morning.
 *
 * Business dates in this system are TEXT and mean calendar days in the company's own timezone
 * (see .claude/rules/database.md), so that is what "today" has to mean whenever one of them is
 * compared against another.
 *
 * DELIBERATELY NOT APPLIED EVERYWHERE. Roughly twenty other places still take the UTC date, and
 * several of them decide money — payroll period boundaries, probation end dates, the nightly
 * attendance pass. They have the same latent problem, but moving them is a change to what people
 * are paid and belongs in its own review with its own before-and-after. What is safe, and done
 * here, is that every caller of `pickAssignmentFor` now agrees with the others about what day it
 * is, so shift resolution cannot disagree with itself.
 */

/** Overridable so a deployment outside India does not have to patch code. */
export const BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || 'Asia/Kolkata';

/**
 * `YYYY-MM-DD` for the given instant in the business timezone.
 *
 * `en-CA` is the locale whose short date format is already ISO, which avoids assembling the
 * string from parts and getting the padding wrong.
 */
export function businessToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
