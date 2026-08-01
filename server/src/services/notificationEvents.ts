/**
 * The catalogue of things worth telling somebody about.
 *
 * Single source of truth for both the admin grid and the dispatcher: the page renders these rows,
 * and `emit()` refuses a key that is not listed here. Adding an event means adding it here and
 * calling `emit()` with its key — it then appears on the page unticked, notifying nobody until
 * somebody ticks a box.
 *
 * Note this is NOT the same thing as `notifications.type`, which each call site still supplies on
 * its payload and which the bell maps to an icon. Keeping them separate means adding an event
 * cannot change how existing notifications render.
 */

/** Who can be told. Deliberately excludes the employee an event is ABOUT — see below. */
export const AUDIENCES = [
  'reporting_manager',
  'property_manager',
  'cluster_hr',
  'hr',
  'finance',
  'admin',
] as const;

export type Audience = (typeof AUDIENCES)[number];

export interface AudienceMeta {
  key: Audience;
  label: string;
  /** Shown under the column heading. States the scope honestly — several of these are company-wide. */
  note: string;
  /** False for the three role tiers that have no org scoping in this system at all. */
  scoped: boolean;
}

export const AUDIENCE_META: AudienceMeta[] = [
  {
    key: 'reporting_manager',
    label: 'Reporting manager',
    note: 'The employee’s own manager. If they have none, HR is told instead.',
    scoped: true,
  },
  {
    key: 'property_manager',
    label: 'Property manager',
    note: 'The manager of the employee’s own property.',
    scoped: true,
  },
  {
    key: 'cluster_hr',
    label: 'Cluster HR',
    note: 'The cluster HR responsible for that property’s cluster.',
    scoped: true,
  },
  { key: 'hr', label: 'HR', note: 'Every HR user, at every property.', scoped: false },
  { key: 'finance', label: 'Finance', note: 'Every finance user, at every property.', scoped: false },
  { key: 'admin', label: 'Admin', note: 'Every admin user, at every property.', scoped: false },
];

export interface NotificationEvent {
  key: string;
  group: string;
  label: string;
  /** One line on the page saying when this fires. */
  description: string;
  /**
   * Whether the event is about a particular employee. False for system events, which have no
   * employee and therefore no property — the three scoped audiences can never resolve for them,
   * so the grid greys those cells out rather than offering a tick that could never fire.
   */
  carriesEmployee: boolean;
}

export const EVENTS: NotificationEvent[] = [
  // ── Leave ──
  { key: 'leave.applied', group: 'Leave', label: 'Leave requested', carriesEmployee: true,
    description: 'An employee applies for leave.' },
  { key: 'leave.approved', group: 'Leave', label: 'Leave approved', carriesEmployee: true,
    description: 'A leave request is approved — somebody now has a shift to cover.' },
  { key: 'leave.rejected', group: 'Leave', label: 'Leave rejected', carriesEmployee: true,
    description: 'A leave request is rejected.' },
  { key: 'leave.cancelled', group: 'Leave', label: 'Leave cancelled', carriesEmployee: true,
    description: 'An employee withdraws a leave request they had already filed.' },
  { key: 'leave.encashment_approved', group: 'Leave', label: 'Leave encashment approved', carriesEmployee: true,
    description: 'Unused leave is paid out as cash. Money leaves the business.' },

  // ── Attendance ──
  { key: 'attendance.regularisation_raised', group: 'Attendance', label: 'Regularisation requested', carriesEmployee: true,
    description: 'An employee asks for an attendance day to be corrected.' },
  { key: 'attendance.regularisation_decided', group: 'Attendance', label: 'Regularisation approved or rejected', carriesEmployee: true,
    description: 'A regularisation is decided. An approved one re-prices the payslip.' },

  // ── Shifts ──
  { key: 'shift.change_requested', group: 'Shifts', label: 'Shift change requested', carriesEmployee: true,
    description: 'An employee asks to be moved to a different shift.' },
  { key: 'shift.change_decided', group: 'Shifts', label: 'Shift change approved or rejected', carriesEmployee: true,
    description: 'A shift change request is decided.' },

  // ── Payroll ──
  { key: 'payroll.month_locked', group: 'Payroll', label: 'Payroll month locked', carriesEmployee: false,
    description: 'A payroll month is closed. Figures stop moving.' },
  { key: 'payroll.month_unlocked', group: 'Payroll', label: 'Payroll month UNLOCKED', carriesEmployee: false,
    description: 'A closed month is reopened, so paid figures can change again.' },
  { key: 'payroll.locked_over_warning', group: 'Payroll', label: 'Month locked over a warning', carriesEmployee: false,
    description: 'Somebody locked a month despite stale payslips or missing attendance.' },
  { key: 'payroll.reprice_blocked', group: 'Payroll', label: 'Payslip could not be re-priced', carriesEmployee: true,
    description: 'An approved correction could not reach the payslip. Needs a person.' },

  // ── Exits & money ──
  { key: 'offboarding.fnf_saved', group: 'Exits & money', label: 'Full & final settlement saved', carriesEmployee: true,
    description: 'An exit settlement is computed and saved, ready to pay.' },
  { key: 'offboarding.case_completed', group: 'Exits & money', label: 'Exit completed', carriesEmployee: true,
    description: 'An offboarding case is closed and the login revoked.' },

  // ── People ──
  { key: 'employee.replacement_needed', group: 'People', label: 'Moved to PIP, left or absconding', carriesEmployee: true,
    description: 'A job needs a backup. Raise a backfill vacancy.' },
  { key: 'employee.transferred', group: 'People', label: 'Employee transferred', carriesEmployee: true,
    description: 'Somebody moves property or department. Both sides gain or lose a head.' },
  { key: 'employee.joined', group: 'People', label: 'New hire joined', carriesEmployee: true,
    description: 'A candidate finishes onboarding and becomes an employee.' },
  { key: 'employee.login_needed', group: 'People', label: 'New hire needs a login', carriesEmployee: true,
    description: 'A new employee has no HRMS account yet.' },

  // ── Manpower ──
  { key: 'manpower.exception_raised', group: 'Manpower', label: 'Hiring exception requested', carriesEmployee: false,
    description: 'A hire over the sanctioned headcount or budget is awaiting approval.' },
  { key: 'manpower.exception_decided', group: 'Manpower', label: 'Hiring exception approved or rejected', carriesEmployee: false,
    description: 'A hiring exception is decided. The requester is blocked until it is.' },

  // ── System ──
  { key: 'system.backup_failed', group: 'System', label: 'Nightly backup failed', carriesEmployee: false,
    description: 'The database backup job errored. Silent otherwise.' },
  { key: 'system.auto_attendance_failed', group: 'System', label: 'Auto-attendance job failed', carriesEmployee: false,
    description: 'The nightly job that applies shift thresholds errored.' },
];

const BY_KEY = new Map(EVENTS.map((e) => [e.key, e]));

export function getEvent(key: string): NotificationEvent | undefined {
  return BY_KEY.get(key);
}

export function isAudience(value: string): value is Audience {
  return (AUDIENCES as readonly string[]).includes(value);
}
