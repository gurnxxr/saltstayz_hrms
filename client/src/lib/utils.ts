import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// The app stores timestamps via SQLite datetime('now'), which is naive UTC
// ("YYYY-MM-DD HH:MM:SS"). JS would parse that bare string as LOCAL time, so we
// normalize to UTC first, then render in IST (Asia/Kolkata) everywhere.
const IST = 'Asia/Kolkata';

function toDate(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  let s = String(value).trim();
  if (!s) return null;
  // Bare SQLite datetime (has a time component, no timezone) → treat as UTC.
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    s = s.replace(' ', 'T') + 'Z';
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function formatDate(date: string | Date | null | undefined, opts?: Intl.DateTimeFormatOptions) {
  const d = toDate(date);
  if (!d) return '—';
  return d.toLocaleDateString('en-IN', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric', ...opts });
}

/**
 * One leave request, one string, on every screen that shows it.
 *
 * My Leave put the year on the end date only and Approvals put it on neither, so the same request
 * read "3 Aug — 7 Aug 2026" in one place and "3 Aug — 7 Aug" in the other. There is one function
 * now, and the end date always carries the year.
 *
 * A single-day request collapses to one date; a range inside one month drops the repeated month;
 * a range inside one year drops the repeated year. A null falls through to formatDate's "—" rather
 * than throwing, which the local helper on the Control Panel did.
 */
export function formatDateRange(
  start: string | Date | null | undefined,
  end: string | Date | null | undefined,
): string {
  const a = toDate(start);
  const b = toDate(end);
  if (!a) return formatDate(end);
  if (!b) return formatDate(start);

  // Compare the IST calendar DAY, not the instant, so a bare 'YYYY-MM-DD' and the same day stored
  // as a timestamp count as equal. en-CA is reliably ISO order, so these compare as plain strings.
  const key = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: IST });
  const ka = key(a);
  const kb = key(b);
  if (ka === kb) return formatDate(a);

  const sameYear = ka.slice(0, 4) === kb.slice(0, 4);
  const sameMonth = sameYear && ka.slice(0, 7) === kb.slice(0, 7);

  // An explicit `undefined` option drops that part — Intl treats it as not requested, and it beats
  // the default in the spread. The same trick MyHolidays already uses to render a month on its own.
  const left = sameMonth
    ? formatDate(a, { month: undefined, year: undefined })
    : sameYear
      ? formatDate(a, { year: undefined })
      : formatDate(a);

  // An en dash, because an em dash is not a range separator.
  return `${left} – ${formatDate(b)}`;
}

export function formatDateTime(date: string | Date | null | undefined, opts?: Intl.DateTimeFormatOptions) {
  const d = toDate(date);
  if (!d) return '—';
  return d.toLocaleString('en-IN', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', ...opts });
}

export function formatTime(date: string | Date | null | undefined) {
  const d = toDate(date);
  if (!d) return '—';
  return d.toLocaleTimeString('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit' });
}

export function getInitials(firstName: string, lastName: string) {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

// Rupee formatting. A genuinely MISSING amount (null / undefined / blank /
// non-numeric) renders as `blank` (default "—") so "no amount set" stays
// visually distinct from a real ₹0. Pass { blank: '₹0' } at the few call
// sites where an absent value should legitimately read as zero.
export function formatINR(
  value: number | string | null | undefined,
  opts: { blank?: string } = {},
): string {
  const blank = opts.blank ?? '—';
  if (value === null || value === undefined || value === '') return blank;
  const n = Number(value);
  if (!Number.isFinite(n)) return blank;
  return '₹' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(n));
}

// Compact rupee for dense dashboards: ₹1.2k / ₹3.4L / ₹5.6Cr. Same missing-value
// handling as formatINR.
export function formatINRShort(
  value: number | string | null | undefined,
  opts: { blank?: string } = {},
): string {
  const blank = opts.blank ?? '—';
  if (value === null || value === undefined || value === '') return blank;
  const n = Number(value);
  if (!Number.isFinite(n)) return blank;
  const v = Math.round(n);
  if (v >= 1e7) return '₹' + (v / 1e7).toFixed(2) + 'Cr';
  if (v >= 1e5) return '₹' + (v / 1e5).toFixed(2) + 'L';
  if (v >= 1e3) return '₹' + (v / 1e3).toFixed(1) + 'k';
  return '₹' + v;
}

// ─── Calendar months ────────────────────────────────────────────────────────────
//
// A `YYYY-MM` here is a calendar LABEL, not an instant, and two rules keep it honest.
//
// "Which month is it now" is asked in IST, the same clock the rest of this file renders in.
// `new Date().toISOString().slice(0, 7)` is the UTC month, so between midnight and 05:30 IST on
// the 1st it still names the month that just ended.
//
// Rendering one builds it with Date.UTC and formats it with `timeZone: 'UTC'`. Leave the timezone
// off and a browser west of Greenwich renders Date.UTC(2026, 7, 1) as 31 July — the label names the
// month BEFORE the one it was handed. The same warning is written out at the top of
// app/admin/attendance-register/page.tsx; this is that comment made reusable.

/** The current calendar month, `YYYY-MM`, in IST. */
export function currentMonth(now: Date = new Date()): string {
  // en-CA is reliably YYYY-MM-DD; a year+month-only format string is implementation-defined.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now).slice(0, 7);
}

/** `2026-08` → `August 2026`. */
export function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1))
    .toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** The last `count` calendar months ending at `end`, newest first — ready for <option>. */
export function recentMonths(count = 12, end: string = currentMonth()): { value: string; label: string }[] {
  const [y, m] = end.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    // Date.UTC takes a negative month index and rolls the year back, so December of the previous
    // year needs no special case.
    const value = new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7);
    return { value, label: formatMonth(value) };
  });
}

/**
 * Pull the server's error message out of a failed `responseType: 'blob'` request.
 *
 * Axios hands back the error body as a Blob when the response type is blob, so the
 * usual `err.response?.data?.error` is always undefined and the user sees a generic
 * message instead of the real reason. Read the blob back as text and parse it.
 */
export async function errorFromBlob(err: any): Promise<string | null> {
  const data = err?.response?.data;
  if (!data) return err?.message ?? null;
  if (typeof data === 'string') return data;
  if (typeof data.error === 'string') return data.error;
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    try { return JSON.parse(await data.text())?.error ?? null; } catch { return null; }
  }
  return null;
}
