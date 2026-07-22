import { type RoleName, type NavItem } from './types';

export const NAVIGATION: NavItem[] = [
  {
    label: 'Dashboard',
    href: '/dashboard',
    icon: 'LayoutDashboard',
    roles: ['admin', 'chro', 'hr', 'hr_manager', 'property_manager', 'employee', 'finance'],
    // Role-matched: staff see the admin dashboard (dashboard_admin), employees the
    // self-service one (dashboard_employee). Admin → Module Access toggles each.
    module: 'dashboard_admin',
    moduleForEmployee: 'dashboard_employee',
  },
  {
    label: 'Analytics',
    href: '/analytics',
    icon: 'BarChart3',
    roles: ['admin', 'chro', 'hr', 'hr_manager', 'employee', 'cluster_hr', 'property_manager'],
    children: [
      { label: 'HR Analytics', href: '/analytics', icon: 'PieChart', roles: ['admin', 'chro', 'hr', 'hr_manager', 'employee'], module: 'analytics' },
      { label: 'Manpower & Budget', href: '/manpower', icon: 'ShieldCheck', roles: ['admin', 'chro', 'cluster_hr', 'property_manager'], module: 'manpower' },
    ],
  },
  {
    label: 'Attendance',
    href: '/attendance',
    icon: 'CalendarCheck',
    roles: ['admin', 'chro', 'hr', 'property_manager', 'employee'],
    module: 'attendance',
    children: [
      { label: 'Calendar', href: '/attendance', icon: 'CalendarCheck', roles: ['admin', 'chro', 'hr', 'property_manager', 'employee'], module: 'attendance' },
      { label: 'Regularisation', href: '/attendance/regularisation', icon: 'ClipboardList', roles: ['admin', 'chro', 'hr', 'property_manager', 'employee'], module: 'attendance' },
    ],
  },
  {
    label: 'Leaves',
    href: '/leaves/my',
    icon: 'CalendarDays',
    // Everyone gets the merged Leaves page (apply / approvals / holidays);
    // admin/CHRO/HR also get Encashment + Control Panel. `leave` gates the whole
    // group (deny hides it); the admin sub-tools below stay role-restricted.
    roles: ['admin', 'chro', 'hr', 'property_manager', 'employee'],
    module: 'leave',
    children: [
      { label: 'Leaves', href: '/leaves/my', icon: 'CalendarCheck', roles: ['admin', 'chro', 'hr', 'property_manager', 'employee'], module: 'leave' },
      { label: 'Balances', href: '/leaves/balances', icon: 'Scale', roles: ['admin', 'chro', 'hr'] },
      { label: 'Encashment', href: '/leaves/encashment', icon: 'Coins', roles: ['admin', 'chro', 'hr'] },
      { label: 'Control Panel', href: '/leaves/control-panel', icon: 'SlidersHorizontal', roles: ['admin', 'chro', 'hr'] },
    ],
  },
  {
    // Self-service: the signed-in user's own shifts + shift-change requests. Managing
    // the roster / approving requests lives under Shift Management (staff only).
    label: 'My Shifts',
    href: '/shifts/my',
    icon: 'CalendarClock',
    roles: ['admin', 'chro', 'hr', 'hr_manager', 'cluster_hr', 'property_manager', 'employee', 'finance'],
    module: 'my_shifts',
  },
  {
    label: 'Recruitment',
    href: '/recruitment',
    icon: 'Briefcase',
    roles: ['admin', 'chro', 'hr', 'hr_manager'],
    module: 'recruitment',
    children: [
      { label: 'Pipeline', href: '/recruitment', icon: 'Workflow', roles: ['admin', 'chro', 'hr', 'hr_manager'], module: 'recruitment' },
      { label: 'Vacancies', href: '/recruitment/vacancies', icon: 'Briefcase', roles: ['admin', 'chro', 'hr', 'hr_manager'], module: 'recruitment' },
      { label: 'Joining Queue', href: '/recruitment/joining', icon: 'UserPlus', roles: ['admin', 'chro', 'hr'], module: 'recruitment' },
      { label: 'Checklist Templates', href: '/recruitment/checklists', icon: 'ListChecks', roles: ['admin', 'chro', 'hr'], module: 'recruitment' },
    ],
  },
  {
    label: 'Employee Lifecycle',
    href: '/offboarding',
    icon: 'UserCog',
    // One module gates the whole group (Offboarding + Promotion/Transfer/Exit/Assets).
    roles: ['admin', 'chro', 'hr', 'hr_manager'],
    module: 'employee_lifecycle',
    children: [
      { label: 'Offboarding', href: '/offboarding', icon: 'UserMinus', roles: ['admin', 'chro', 'hr', 'hr_manager'], module: 'employee_lifecycle' },
      { label: 'Employee Promotion', href: '/employee-lifecycle/promotion', icon: 'TrendingUp', roles: ['admin', 'chro', 'hr', 'hr_manager'], module: 'employee_lifecycle' },
      { label: 'Employee Transfer', href: '/employee-lifecycle/transfer', icon: 'ArrowRightLeft', roles: ['admin', 'chro', 'hr', 'hr_manager'], module: 'employee_lifecycle' },
      { label: 'Exit Interview', href: '/employee-lifecycle/exit-interview', icon: 'ClipboardList', roles: ['admin', 'chro', 'hr', 'hr_manager'], module: 'employee_lifecycle' },
      { label: 'Company Assets', href: '/employee-lifecycle/assets', icon: 'Package', roles: ['admin', 'chro', 'hr', 'hr_manager'], module: 'employee_lifecycle' },
    ],
  },
  {
    // Self-service: the signed-in user's own salary structure + payslips. Downloading
    // any employee's slip lives under Admin → Salary Slips (admin only).
    label: 'Salary',
    href: '/salary',
    icon: 'FileText',
    roles: ['admin', 'chro', 'hr', 'finance', 'employee'],
    module: 'salary',
  },
  {
    label: 'Payroll',
    href: '/setup/salary-structure',
    icon: 'Wallet',
    roles: ['admin', 'finance'],
    module: 'payroll',
    children: [
      { label: 'Salary Structures', href: '/setup/salary-structure', icon: 'IndianRupee', roles: ['admin'], module: 'payroll' },
      { label: 'Pay Schedule', href: '/setup/pay-schedule', icon: 'CalendarClock', roles: ['admin', 'finance'], module: 'payroll' },
      { label: 'Statutory Components', href: '/setup/statutory-components', icon: 'Landmark', roles: ['admin', 'finance'], module: 'payroll' },
      { label: 'Salary Components', href: '/setup/salary-components', icon: 'Coins', roles: ['admin', 'finance'], module: 'payroll' },
    ],
  },
  {
    label: 'Shift Management',
    href: '/shifts/assignments',
    icon: 'Clock',
    roles: ['admin', 'chro', 'hr', 'property_manager'],
    module: 'shifts',
    children: [
      // Put each employee on a shift; everything else follows from the shift's own rules.
      { label: 'Shift Assignments', href: '/shifts/assignments', icon: 'UserCog', roles: ['admin', 'chro', 'hr', 'property_manager'], module: 'shifts' },
      // Approve/decline the shift-change requests employees raise from "My Shifts".
      { label: 'Change Requests', href: '/shifts/change-requests', icon: 'ClipboardList', roles: ['admin', 'chro', 'hr', 'property_manager'], module: 'shifts' },
      // Shift-type definitions (the old "Shift Setup", admin/CHRO/HR).
      { label: 'Shift Types', href: '/shift-setup/type', icon: 'Tag', roles: ['admin', 'chro', 'hr'], module: 'shifts' },
    ],
  },
  {
    label: 'Admin',
    href: '/admin',
    icon: 'Settings',
    // Employee Details & Financial Details are now cards inside the Admin
    // dashboard, so the tab opens to whoever can use at least one of its cards.
    roles: ['admin', 'chro', 'hr', 'hr_manager', 'property_manager', 'finance'],
    module: 'admin',
  },
];

// Indian states + union territories — the property State dropdown (statutory
// rules are resolved from the property's state; mirrors the server list).
export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa',
  'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland',
  'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
];

// ─── The eleven-step hiring process (mirrors recruitment.service.ts) ───
//
// Steps 1-2 are states of a VACANCY; steps 3-11 are states of a CANDIDATE. The
// server is authoritative: the client mirrors FUNNEL_ORDER / allowedNextStages, it
// does not decide. Keep these in lock-step with server/src/services/recruitment.service.ts.

/** Step 1 (new_role) and step 2 (listed). A vacancy is "live" in either. */
export const VACANCY_STATUSES = ['new_role', 'listed', 'closed'] as const;
export const LIVE_VACANCY_STATUSES = ['new_role', 'listed'] as const;

/** Steps 3-11, in order. */
export const FUNNEL_ORDER = [
  'applied',              // 3  Shortlisting
  'interview',            // 4  Interview
  'selected',             // 5  Selection
  'document_collection',  // 6  Document Collection    [checklist]
  'offer_released',       // 7  Offer Release
  'offer_accepted',       // 8  Offer Acceptance
  'pre_joining',          // 9  Pre-joining Formalities [checklist]
  'joining',              // 10 Joining Day             [checklist]
  'transferred',          // 11 Transfer to Manager
] as const;

/** Off-ramps. `rejected` before an offer, `offer_declined` at acceptance, `no_show` at 9/10. */
export const OFF_RAMPS = ['rejected', 'offer_declined', 'no_show'] as const;
export const CANDIDATE_STAGES = [...FUNNEL_ORDER, ...OFF_RAMPS] as const;

export const STAGE_LABELS: Record<string, string> = {
  new_role: 'New Role', listed: 'Listed', closed: 'Closed',
  applied: 'Shortlisting', interview: 'Interview', selected: 'Selection',
  document_collection: 'Document Collection', offer_released: 'Offer Release',
  offer_accepted: 'Offer Acceptance', pre_joining: 'Pre-joining Formalities',
  joining: 'Joining Day', transferred: 'Transfer to Manager',
  rejected: 'Rejected', offer_declined: 'Offer Declined', no_show: 'No Show',
};

/** A stage whose checklist must be complete before the candidate may leave it. */
export const STAGE_CHECKLIST: Record<string, 'document_collection' | 'pre_joining' | 'joining_day'> = {
  document_collection: 'document_collection',
  pre_joining: 'pre_joining',
  joining: 'joining_day',
};

/**
 * The full eleven-step ladder for the stepper: steps 1-2 are vacancy states, 3-11 are
 * candidate states. `kind` lets the UI render vacancy vs candidate steps differently.
 */
export const STEPS = [
  { n: 1, key: 'new_role', label: 'New Role', kind: 'vacancy' },
  { n: 2, key: 'listed', label: 'Listed', kind: 'vacancy' },
  { n: 3, key: 'applied', label: 'Shortlisting', kind: 'candidate' },
  { n: 4, key: 'interview', label: 'Interview', kind: 'candidate' },
  { n: 5, key: 'selected', label: 'Selection', kind: 'candidate' },
  { n: 6, key: 'document_collection', label: 'Document Collection', kind: 'candidate' },
  { n: 7, key: 'offer_released', label: 'Offer Release', kind: 'candidate' },
  { n: 8, key: 'offer_accepted', label: 'Offer Acceptance', kind: 'candidate' },
  { n: 9, key: 'pre_joining', label: 'Pre-joining Formalities', kind: 'candidate' },
  { n: 10, key: 'joining', label: 'Joining Day', kind: 'candidate' },
  { n: 11, key: 'transferred', label: 'Transfer to Manager', kind: 'candidate' },
] as const;

const TERMINAL_STAGES: string[] = ['transferred', ...OFF_RAMPS];

/**
 * Stages a candidate at `from` may move to: the next funnel step, plus whichever
 * off-ramp is legal there. Terminal stages return []. One step forward at a time,
 * never backwards. `rejected` is only an off-ramp BEFORE an offer exists; once the
 * offer is out the candidate declines it, and once accepted they can only no-show.
 * Copied from recruitment.service.ts allowedNextStages (the server is authoritative).
 */
export function allowedNextStages(from: string): string[] {
  if (TERMINAL_STAGES.includes(from)) return [];
  const i = FUNNEL_ORDER.indexOf(from as typeof FUNNEL_ORDER[number]);
  if (i === -1) return [];
  const next: string[] = [];
  if (i + 1 < FUNNEL_ORDER.length) next.push(FUNNEL_ORDER[i + 1]);
  if (i < FUNNEL_ORDER.indexOf('offer_released')) next.push('rejected');
  else if (from === 'offer_released') next.push('offer_declined');
  else if (from === 'pre_joining' || from === 'joining') next.push('no_show');
  return next;
}

export const ROLE_DEFAULT_DASHBOARD: Record<RoleName, string> = {
  admin: '/analytics',
  chro: '/analytics',
  hr: '/analytics',
  hr_manager: '/analytics',
  cluster_hr: '/manpower',
  property_manager: '/attendance',
  employee: '/dashboard',
  finance: '/salary',
};
