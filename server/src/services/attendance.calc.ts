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
  if (diff <= 0) diff += 24 * 60; // crossed midnight
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
