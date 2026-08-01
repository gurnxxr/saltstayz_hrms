/**
 * The eight attendance codes, defined once.
 *
 * This is exactly the set stored in `attendance_records.status` and exactly the set
 * `getMonthSummary` (attendance.service.ts) buckets — no more, no less. That equality is what lets
 * a screen claim its tiles add up to the month, and `attendanceCodes.test.ts` asserts it.
 *
 * Before this file the same vocabulary lived in eleven places and disagreed with itself: HHD was
 * teal on the calendar and lime on the admin page, the server said "Short Present" while every
 * client screen said "Short Punch", and the calendar rendered a purple NP badge that its own
 * legend omitted. Anything showing an attendance status now reads from here.
 *
 * What this file is NOT: pay. How much a code pays lives in the `attendance_pay_rules` table,
 * is editable by an admin, and is served by GET /attendance-pay-rules. This is display only.
 */

export interface AttendanceCode {
  /** The value in `attendance_records.status`. */
  code: string;
  /** Short badge for calendar cells — the codes HR uses on the upload sheet. */
  badge: string;
  /** The one name for this code, used on every screen. */
  label: string;
  /** Longer wording for tooltips and the day-detail card, where there is room to explain. */
  hint?: string;
  /** Badge pill: light background + dark text. */
  badgeBg: string;
  badgeText: string;
  /** Big-number tint for summary tiles. */
  tone: string;
  /** Solid dot for the compact per-property breakdown. */
  dot: string;
}

/**
 * Display order: fully worked → partly worked → not worked → away.
 * Mirrors the server's DISPLAY_ORDER (attendancePayRules.service.ts) so the pay-rules screen and
 * the attendance screens list the codes in the same sequence.
 */
export const ATTENDANCE_CODES: AttendanceCode[] = [
  {
    code: 'present', badge: 'P', label: 'Present',
    badgeBg: 'bg-green-100', badgeText: 'text-green-700', tone: 'text-green-600', dot: 'bg-green-500',
  },
  {
    code: 'no_punch', badge: 'NP', label: 'No Punch',
    hint: 'No Punch — no biometric record',
    badgeBg: 'bg-purple-100', badgeText: 'text-purple-700', tone: 'text-purple-600', dot: 'bg-purple-500',
  },
  {
    code: 'half_day', badge: 'HD', label: 'Half Day',
    badgeBg: 'bg-yellow-100', badgeText: 'text-yellow-700', tone: 'text-yellow-600', dot: 'bg-yellow-500',
  },
  {
    code: 'short_punch', badge: 'SP', label: 'Short Punch',
    hint: 'Short Punch — left early',
    badgeBg: 'bg-amber-100', badgeText: 'text-amber-700', tone: 'text-amber-600', dot: 'bg-amber-500',
  },
  {
    code: 'miss_punch', badge: 'MP', label: 'Miss Punch',
    hint: 'Miss Punch — marked only once',
    badgeBg: 'bg-orange-100', badgeText: 'text-orange-700', tone: 'text-orange-600', dot: 'bg-orange-500',
  },
  {
    code: 'hhd', badge: 'HHD', label: 'Half-Day Holiday',
    // Deliberately not "half day with half leave" — that describes half_day, which deducts ½ a
    // leave day. HHD deducts none; it is a day the business only opened for half of.
    hint: 'Half-Day Holiday — paid ½',
    badgeBg: 'bg-teal-100', badgeText: 'text-teal-700', tone: 'text-teal-600', dot: 'bg-teal-500',
  },
  {
    code: 'absent', badge: 'A', label: 'Absent',
    badgeBg: 'bg-red-100', badgeText: 'text-red-700', tone: 'text-red-600', dot: 'bg-red-500',
  },
  {
    code: 'on_leave', badge: 'L', label: 'On Leave',
    badgeBg: 'bg-blue-100', badgeText: 'text-blue-700', tone: 'text-blue-600', dot: 'bg-blue-500',
  },
];

export const CODE_BY_STATUS: Record<string, AttendanceCode> = Object.fromEntries(
  ATTENDANCE_CODES.map((c) => [c.code, c]),
);

/** Just the status strings, in display order — for iterating tiles, filters and legends. */
export const ATTENDANCE_STATUSES = ATTENDANCE_CODES.map((c) => c.code);

/**
 * Badges a calendar cell can show that are NOT a record status.
 *
 * A holiday or a weekly off is the absence of an expectation, not an attendance verdict, and
 * "regularised" is a provenance marker layered over whatever the underlying status is. Kept apart
 * from ATTENDANCE_CODES so nothing counts them as a bucket.
 */
export const NON_STATUS_BADGES = {
  holiday: { badge: 'H', label: 'Holiday', badgeBg: 'bg-orange-100', badgeText: 'text-orange-700' },
  weekly_off: { badge: 'WO', label: 'Weekly Off', badgeBg: 'bg-gray-100', badgeText: 'text-gray-500' },
  regularised: { badge: 'R', label: 'Regularised', badgeBg: 'bg-indigo-100', badgeText: 'text-indigo-700' },
} as const;

/** Falls back to the raw status rather than rendering an empty cell for a value we don't know. */
export function labelFor(status: string): string {
  return CODE_BY_STATUS[status]?.label ?? status;
}

export function badgeFor(status: string): string {
  return CODE_BY_STATUS[status]?.badge ?? '?';
}
