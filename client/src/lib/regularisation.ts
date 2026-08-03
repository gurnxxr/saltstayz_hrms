/**
 * Client-side mirror of the regularisation deadline arithmetic.
 *
 * The server is the authority — regularisationSettings.service.cutoffDateFor decides every
 * request, and this copy decides nothing. It exists so the request form can SHOW the deadline it
 * will be judged against and stop the date picker offering days that would be refused, because a
 * form that silently enforces a rule it never displays is how you get someone typing a date, being
 * rejected, and having no idea why.
 *
 * Keep it identical to the server's. The month index handed to Date.UTC is deliberately the
 * following month (the parsed `m` is 1-based, the constructor's is 0-based), so day N of it is N
 * days past this month's end and day 0 is this month's last day.
 */
export function cutoffDateFor(date: string, days: number): string {
  const [y, m] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m, days)).toISOString().slice(0, 10);
}

/**
 * The earliest date still open to correction, for the picker's lower bound.
 *
 * Walks back a month at a time while that month's deadline is still in the future. Walking rather
 * than assuming "one month back" because a long deadline can leave three months open at once: with
 * a 31-day window, January closes on 3 March, so on 2 March January, February and March are all
 * live. The walk is bounded because deadlines only ever move forwards, so the first closed month
 * ends it — the 6 is a belt-and-braces stop, not a real limit.
 *
 * Returns undefined when there is no deadline, which leaves the picker unbounded.
 */
export function earliestOpenDate(days: number | null, today: string): string | undefined {
  if (days == null) return undefined;
  let [y, m] = today.split('-').map(Number);
  let earliest = `${today.slice(0, 7)}-01`; // the current month is always open
  for (let back = 0; back < 6; back++) {
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
    const firstOfMonth = `${y}-${String(m).padStart(2, '0')}-01`;
    if (cutoffDateFor(firstOfMonth, days) < today) break;
    earliest = firstOfMonth;
  }
  return earliest;
}

/**
 * Today, as the browser's own calendar sees it. A FALLBACK ONLY.
 *
 * The authority is the `today` the settings endpoint returns, because the server judges a request
 * against the business timezone and only the server knows what that is. This exists for the moment
 * before that response lands, and for the offline case the form's query swallows.
 *
 * `toLocaleDateString('en-CA')` rather than `toISOString().slice(0, 10)` on purpose: the latter is
 * the UTC day, which for a user in India is still yesterday until half past five in the morning —
 * the very bug this whole change is about. `en-CA` is the locale whose short format is already ISO,
 * which is the same trick the server's `businessToday` uses.
 */
export function localToday(): string {
  return new Date().toLocaleDateString('en-CA');
}

/** "2026-08-02" → "2 Aug 2026". Dates are TEXT everywhere, so parse as UTC to avoid a TZ shift. */
export function fmtDeadline(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}
