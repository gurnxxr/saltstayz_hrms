/**
 * When leave is earned, and how much — as pure arithmetic over dates.
 *
 * No database, no clock, no I/O: every input is an argument. That is what makes the awkward cases
 * (a 31 January joiner in February, a waiting period, twelve credits that have to add up to exactly
 * fifteen) testable without a fixture, and it is why the rest of the accrual feature is thin.
 *
 * The whole model in one paragraph: an employee earns a share of the annual figure on each monthly
 * anniversary of their joining date. A 15 January joiner earns on 15 February, 15 March, and so on —
 * not on the 1st, because "after one month of service" means their month, not the calendar's.
 * Credits that fall before the current leave period are prior service, and reach the period only
 * through the carry-forward cap. Credits that fall after today have not been earned yet.
 */

/** Six decimal places is the ledger column's scale (`numeric(10,6)`); everything rounds to it. */
export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * `iso` plus `n` months, clamped to the target month's last day.
 *
 * The clamp is the whole reason this exists. `new Date(2026, 0, 31)` plus one month via `setMonth`
 * gives 3 March, because 31 February overflows — so a 31 January joiner would earn on 3 March, then
 * 3 April, and their anniversary would walk forward a few days every year. Clamping gives
 * 28 February (29 in a leap year) and then 31 March: the day-of-month is taken from the joining date
 * every time, so it never drifts.
 */
export function addMonthsClamped(iso: string, n: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const monthIndex = (m - 1) + n;
  const year = y + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  // Day 0 of the following month is the last day of this one.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Total days earned after `n` earning months, at `daysPerYear`.
 *
 * Credits are derived from this CUMULATIVE figure rather than computed directly as
 * `daysPerYear / 12`, and the difference is not academic. Ten days a year is 0.8333… a month;
 * rounded to six places that is 0.833333, and twelve of those come to 9.999996 — so an employee
 * entitled to ten days would be shown nine. Taking each credit as the gap between two rounded
 * cumulative totals makes the series telescope: the twelve credits are 0.833333 and 0.833334 in
 * alternation, and they sum to exactly 10. Any twelve consecutive credits do, at any point in a
 * career, because adding a whole year to the cumulative figure cannot change its fractional part.
 */
export function cumulativeDays(daysPerYear: number, n: number): number {
  return round6((daysPerYear * n) / 12);
}

/** What the n-th earning month credits. See `cumulativeDays` for why it is a difference. */
export function creditForMonth(daysPerYear: number, n: number): number {
  return round6(cumulativeDays(daysPerYear, n) - cumulativeDays(daysPerYear, n - 1));
}

/**
 * Whole days an employee may see and spend, from an exact accrued figure.
 *
 * The ledger carries fractions because the annual total depends on them; nobody applies for 5.25
 * days of casual leave. The floor is applied here — at the point of display and of spending — and
 * never at the point of crediting, which is what keeps 15 days a year meaning 15 rather than 12.
 *
 * `round6` first, deliberately: a float sum of exact decimals can land on 14.999999999999998, and
 * flooring that gives 14.
 */
export function spendableDays(accrued: number): number {
  return Math.floor(round6(accrued));
}

export interface AccrualRule {
  /** The annual figure — `leave_template_rows.default_days`, labelled "Days / year" in the UI. */
  daysPerYear: number;
  /** Completed months that earn nothing. 0 means earning starts at the first anniversary. */
  waitingMonths: number;
  /** Days that survive into the next period. NULL = the balance lapses in full. */
  carryForwardMax: number | null;
  /** Ceiling on what one period can hold. NULL = no ceiling. */
  maxBalance: number | null;
}

export interface AccrualCredit {
  /** The anniversary day this credit is FOR. */
  credited_on: string;
  days: number;
  /** Months of completed service it represents — 1 is the first anniversary. */
  month_index: number;
}

export interface AccrualSchedule {
  /** Days brought in from service before this period, after the carry-forward cap. */
  opening: number;
  /** What that prior service earned BEFORE the cap. `prior_accrued - opening` is what lapsed. */
  prior_accrued: number;
  /** Credits earned inside this period, up to and including `asOf`. */
  credits: AccrualCredit[];
  /** `opening` plus every credit, exact to six places. */
  accrued: number;
  /** `accrued` floored — what the employee can actually see and spend, before leave taken. */
  spendable: number;
  /** The next anniversary that will earn something, or null when none can. */
  next_credit_on: string | null;
  /** True when `maxBalance` stopped a credit landing in full. */
  capped: boolean;
}

const EMPTY: AccrualSchedule = {
  opening: 0, prior_accrued: 0, credits: [], accrued: 0, spendable: 0,
  next_credit_on: null, capped: false,
};

/** Guards the walk against a nonsense joining date sending it round a hundred-year loop. */
const MAX_MONTHS = 1200;

const isDate = (v: unknown): v is string => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '').slice(0, 10));

/**
 * Every credit an employee has earned in one leave period, and what carries into it.
 *
 * Dates are compared as strings throughout, which is exactly how the rest of this schema treats
 * business dates (see .claude/rules/database.md) and is safe because they are zero-padded ISO.
 *
 * `maxBalance` truncates rather than defers: a credit that would breach the ceiling is trimmed to
 * fit, and what was trimmed is not recoverable by taking leave later. The commoner HR policy —
 * "accrual pauses at the ceiling and resumes when you spend" — would need the engine to know how
 * much leave had been taken by each anniversary, which makes it impure and its results dependent on
 * approval timing. The ceiling is nullable and off by default; when it is set, this is what it does.
 */
export function buildSchedule(input: {
  dateOfJoining: string;
  rule: AccrualRule;
  periodStart: string;
  periodEnd: string;
  asOf: string;
}): AccrualSchedule {
  const { dateOfJoining, rule, periodStart, periodEnd, asOf } = input;
  const doj = String(dateOfJoining ?? '').slice(0, 10);
  if (!isDate(doj) || !isDate(periodStart) || !isDate(periodEnd) || !isDate(asOf)) return EMPTY;
  const daysPerYear = Number(rule.daysPerYear) || 0;
  if (daysPerYear <= 0) return EMPTY;
  const waiting = Math.max(0, Math.trunc(Number(rule.waitingMonths) || 0));

  let prior = 0;
  const earned: AccrualCredit[] = [];
  let next: string | null = null;

  for (let n = 1; n <= MAX_MONTHS; n += 1) {
    const anniv = addMonthsClamped(doj, n);
    // Stop at the first anniversary that is either still in the future or past this period's end.
    // When it is in the future, the next EARNING one is what the employee wants to be told — which
    // is this one unless they are still inside their waiting period.
    if (anniv > asOf || anniv > periodEnd) {
      if (anniv > asOf) next = addMonthsClamped(doj, Math.max(n, waiting + 1));
      break;
    }
    if (n <= waiting) continue;
    const days = creditForMonth(daysPerYear, n);
    if (anniv < periodStart) { prior = round6(prior + days); continue; }
    earned.push({ credited_on: anniv, days, month_index: n });
  }

  // Prior service reaches this period only through carry-forward. No limit configured means the
  // balance lapsed at the period boundary, which is the default and the stricter reading.
  let opening = prior > 0 && rule.carryForwardMax !== null
    ? Math.min(prior, Number(rule.carryForwardMax))
    : 0;

  const ceiling = rule.maxBalance === null ? null : Number(rule.maxBalance);
  let capped = false;
  if (ceiling !== null && opening > ceiling) { opening = ceiling; capped = true; }

  let running = round6(opening);
  const credits: AccrualCredit[] = [];
  for (const c of earned) {
    let days = c.days;
    if (ceiling !== null) {
      const room = round6(ceiling - running);
      if (room <= 0) { days = 0; capped = true; } else if (days > room) { days = room; capped = true; }
    }
    running = round6(running + days);
    // A zero-day credit is a row that says nothing; the ceiling is reported through `capped`.
    if (days > 0) credits.push({ ...c, days });
  }

  return {
    opening: round6(opening),
    prior_accrued: prior,
    credits,
    accrued: running,
    spendable: spendableDays(running),
    next_credit_on: next,
    capped,
  };
}

/**
 * Completed months of service between two dates — the figure a backfill report leads with.
 *
 * It settles the last month against `addMonthsClamped` rather than comparing day-of-month, so it
 * agrees with the schedule it is reported next to: a 31 January joiner has completed a month on
 * 28 February, because that is the day they were credited.
 */
export function monthsOfService(dateOfJoining: string, asOf: string): number {
  const doj = String(dateOfJoining ?? '').slice(0, 10);
  if (!isDate(doj) || !isDate(asOf) || asOf < doj) return 0;
  const [ay, am] = doj.split('-').map(Number);
  const [by, bm] = asOf.split('-').map(Number);
  let months = (by - ay) * 12 + (bm - am);
  if (months > 0 && addMonthsClamped(doj, months) > asOf) months -= 1;
  return Math.max(0, months);
}
