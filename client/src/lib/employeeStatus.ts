// ─────────────────────────────────────────────────────────────────────────────
// Canonical employee work-status vocabulary — the SINGLE source of truth shared
// by every screen (Manpower, Property Configuration, analytics, etc.). Before
// this existed, each page hand-rolled its own STATUS_META map and drifted:
// Manpower said "Left" / "On Notice" while Property Config said "Inactive" /
// "Notice" for the exact same field. Keep these keys in sync with
// EMPLOYMENT_STATUSES in server/src/services/manpower.service.ts.
// ─────────────────────────────────────────────────────────────────────────────

export const EMPLOYEE_STATUSES = ['active', 'pip', 'on_notice', 'left', 'absconding'] as const;
export type EmployeeStatus = typeof EMPLOYEE_STATUSES[number];

export const EMPLOYEE_STATUS_META: Record<EmployeeStatus, { label: string; cls: string }> = {
  active:     { label: 'Active',     cls: 'bg-green-100 text-green-700 border-green-200' },
  pip:        { label: 'PIP',        cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  on_notice:  { label: 'On-notice',  cls: 'bg-orange-100 text-orange-700 border-orange-200' },
  left:       { label: 'Left',       cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  absconding: { label: 'Absconding', cls: 'bg-red-100 text-red-700 border-red-200' },
};

// Departed statuses — the employee no longer occupies a headcount slot or
// consumes budget (mirrors DEPARTED_STATUSES on the server).
export const DEPARTED_STATUSES: EmployeeStatus[] = ['left', 'absconding'];

// Statuses that require a "last working day" when set.
export const STATUSES_NEEDING_LWD: EmployeeStatus[] = ['on_notice', 'left', 'absconding'];

export function employeeStatusMeta(status?: string | null) {
  return EMPLOYEE_STATUS_META[status as EmployeeStatus] ?? EMPLOYEE_STATUS_META.active;
}

// Plain { key: label } map, handy for <select> / filter dropdowns.
export const EMPLOYEE_STATUS_LABELS: Record<string, string> = Object.fromEntries(
  EMPLOYEE_STATUSES.map((s) => [s, EMPLOYEE_STATUS_META[s].label]),
);
