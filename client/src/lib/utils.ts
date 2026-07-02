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
