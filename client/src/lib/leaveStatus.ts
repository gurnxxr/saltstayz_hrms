// ─────────────────────────────────────────────────────────────────────────────
// Canonical leave-request status vocabulary — the single source of truth for the leaves module.
//
// Before this file the same four states were declared five times: byte-identical maps in the My
// Leave tab and in Approvals, and geometry that disagreed at every call site. None of them
// capitalised, so `pending` — the raw column value — is what an employee actually read.
//
// Deliberately NOT added to lib/attendanceCodes.ts. That file states its own contract at the top:
// it holds exactly the set stored in attendance_records.status and exactly the set getMonthSummary
// buckets, and attendanceCodes.test.ts asserts that equality. leave_requests.status is a different
// column with a different lifecycle, so adding it there would break a tested invariant.
// lib/employeeStatus.ts is the shape to copy instead: one domain vocabulary per file.
//
// A divergence this does NOT fix: app/shifts/my renders `pending` in amber-100/700 where leave uses
// yellow-100/700. Out of scope, but shifts is a five-line adopter now that this exists.
// ─────────────────────────────────────────────────────────────────────────────

import type { Tone } from '@/components/ui/StatusPill';

export const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type LeaveStatus = typeof LEAVE_STATUSES[number];

const META: Record<LeaveStatus, { label: string; tone: Tone }> = {
  pending:   { label: 'Pending',   tone: 'warning' },
  approved:  { label: 'Approved',  tone: 'success' },
  rejected:  { label: 'Rejected',  tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

/**
 * Spread straight into the pill: <StatusPill {...leaveStatusMeta(row.status)} />.
 *
 * An unrecognised value keeps its own text rather than rendering an empty pill — the same bargain
 * labelFor() makes in attendanceCodes.ts. This also absorbs the `|| 'bg-muted text-secondary'`
 * fallback that Encashment was carrying inline.
 */
export function leaveStatusMeta(status?: string | null): { label: string; tone: Tone } {
  return META[status as LeaveStatus] ?? { label: status || '—', tone: 'neutral' };
}

/**
 * For the status <select> on My Leave and Approvals, which each hardcoded their own <option> list
 * and so could drift from the pills sitting beside them.
 */
export const LEAVE_STATUS_OPTIONS = LEAVE_STATUSES.map((s) => ({ value: s, label: META[s].label }));
