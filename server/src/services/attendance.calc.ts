/**
 * Attendance classification (pure — no DB).
 *
 * The four attendance categories:
 *   present     — both punches, worked at least (shift − grace)
 *   short_punch — both punches, but left early (worked < shift − grace)
 *   miss_punch  — punched once (in or out), the other punch missing
 *   absent      — no punches at all
 *
 * Thresholds (grace, expected shift hours) are supplied by the caller from the
 * Pay Schedule / shift config — nothing here is hardcoded.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Minutes since midnight for an HH:MM string, or null if unparseable. */
export function toMinutes(hhmm?: string | null): number | null {
  if (!hhmm) return null;
  const m = String(hhmm).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Worked hours between two HH:MM punches, overnight-safe: a 22:00 → 06:00 pair
 * is 8h, not −16h. Returns 0 when either punch is missing/invalid.
 */
export function overnightHours(checkIn?: string | null, checkOut?: string | null): number {
  const inMin = toMinutes(checkIn);
  const outMin = toMinutes(checkOut);
  if (inMin == null || outMin == null) return 0;
  let diff = outMin - inMin;
  // Equal in/out (diff === 0) means a single swipe the export duplicated into both
  // First_In and Last_Out — that is zero elapsed time, NOT a 24h day. Only a genuinely
  // earlier out-than-in (diff < 0) crosses midnight and rolls forward a day.
  if (diff < 0) diff += 24 * 60; // crossed midnight
  return round2(diff / 60);
}

export type AttendanceStatus = 'present' | 'short_punch' | 'miss_punch' | 'absent';

export interface StatusInput {
  hasIn: boolean;
  hasOut: boolean;
  workedHours: number;   // overnight-safe worked hours (0 when a punch is missing)
  shiftHours: number;    // expected shift length in hours (caller supplies the fallback)
  graceMinutes: number;  // early-exit tolerance
}

/** Derives the attendance status for a day from its punches and the shift. */
export function deriveAttendanceStatus(i: StatusInput): AttendanceStatus {
  if (!i.hasIn && !i.hasOut) return 'absent';
  if (!i.hasIn || !i.hasOut) return 'miss_punch';        // marked once only
  const expected = i.shiftHours > 0 ? i.shiftHours : 0;
  if (expected <= 0) return 'present';                    // no shift to measure against
  // Compare in whole minutes so the grace boundary stays inclusive for any grace
  // value. Punches are HH:MM, so worked/shift are whole-minute quantities; rounding
  // to the nearest minute undoes the 2-decimal rounding done in overnightHours and
  // avoids a float-precision miss when grace isn't a multiple of 15.
  const workedMin = Math.round(i.workedHours * 60);
  const expectedMin = Math.round(expected * 60);
  const shortfallOk = workedMin >= expectedMin - i.graceMinutes;
  return shortfallOk ? 'present' : 'short_punch';
}

/** What a day can come out as once the shift's hour thresholds are taken into account. */
export type DayVerdict = AttendanceStatus | 'half_day';

export interface VerdictInput extends StatusInput {
  /** Below this many hours the day doesn't count. 0 means not configured. */
  absentHours: number;
  /** Below this many hours the day is half. 0 means not configured. */
  halfDayHours: number;
}

/**
 * The single verdict for a day.
 *
 * This used to happen in two passes that disagreed: the upload decided present, short punch
 * or missed punch from the company grace period, and a separate daily job then re-decided the
 * same day as half day or absent from the shift's hour thresholds — looking the employee's
 * shift up in a different place as it went.
 *
 * Both rules still apply, in the order they effectively did before: the punch-based verdict
 * comes first, and only a day that came out as a full "present" is then measured against the
 * shift's hours. A short or missed punch is a statement about the punches themselves and is
 * not overridden by hours.
 *
 * With neither hour figure configured the day keeps its punch-based verdict — deliberately,
 * because treating "not configured" as "everyone present" is how correctly-identified
 * half-days and absences used to get wiped.
 */
export function judgeDay(i: VerdictInput): DayVerdict {
  const base = deriveAttendanceStatus(i);
  if (base !== 'present') return base;

  const absent = i.absentHours > 0 ? i.absentHours : 0;
  const half = i.halfDayHours > 0 ? i.halfDayHours : 0;
  if (absent <= 0 && half <= 0) return 'present';

  if (absent > 0 && i.workedHours < absent) return 'absent';
  if (half > 0 && i.workedHours < half) return 'half_day';
  return 'present';
}
