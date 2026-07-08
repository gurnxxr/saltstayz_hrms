import { type RoleName, type NavItem } from './types';

export const NAVIGATION: NavItem[] = [
  {
    label: 'Dashboard',
    href: '/dashboard',
    icon: 'LayoutDashboard',
    roles: ['admin', 'chro', 'hr', 'hr_manager', 'property_manager', 'employee', 'finance'],
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
    // Employees & property managers get self-service ("My Leave"); admin/CHRO/HR
    // also get the management pages below.
    roles: ['admin', 'chro', 'hr', 'property_manager', 'employee'],
    children: [
      { label: 'My Leave', href: '/leaves/my', icon: 'CalendarCheck', roles: ['admin', 'chro', 'hr', 'property_manager', 'employee'] },
      { label: 'Application', href: '/leaves/application', icon: 'FileText', roles: ['admin', 'chro', 'hr'] },
      { label: 'Encashment', href: '/leaves/encashment', icon: 'Coins', roles: ['admin', 'chro', 'hr'] },
      { label: 'Control Panel', href: '/leaves/control-panel', icon: 'SlidersHorizontal', roles: ['admin', 'chro', 'hr'] },
      { label: 'Allocation', href: '/leaves/allocation', icon: 'CalendarPlus', roles: ['admin', 'chro', 'hr'] },
    ],
  },
  {
    label: 'Recruitment',
    href: '/recruitment',
    icon: 'Briefcase',
    roles: ['admin', 'chro', 'hr', 'hr_manager'],
    module: 'recruitment',
  },
  {
    label: 'Employee Lifecycle',
    href: '/onboarding',
    icon: 'UserCog',
    roles: ['admin', 'chro', 'hr', 'hr_manager'],
    children: [
      { label: 'Onboarding', href: '/onboarding', icon: 'UserPlus', roles: ['admin', 'chro', 'hr', 'hr_manager'], module: 'onboarding' },
      { label: 'Offboarding', href: '/offboarding', icon: 'UserMinus', roles: ['admin', 'chro', 'hr', 'hr_manager'], module: 'onboarding' },
      { label: 'Employee Promotion', href: '/employee-lifecycle/promotion', icon: 'TrendingUp', roles: ['admin', 'chro', 'hr', 'hr_manager'] },
      { label: 'Employee Transfer', href: '/employee-lifecycle/transfer', icon: 'ArrowRightLeft', roles: ['admin', 'chro', 'hr', 'hr_manager'] },
      { label: 'Exit Interview', href: '/employee-lifecycle/exit-interview', icon: 'ClipboardList', roles: ['admin', 'chro', 'hr', 'hr_manager'] },
      { label: 'Company Assets', href: '/employee-lifecycle/assets', icon: 'Package', roles: ['admin', 'chro', 'hr', 'hr_manager'] },
    ],
  },
  {
    label: 'Payroll',
    href: '/payroll',
    icon: 'Wallet',
    roles: ['admin', 'chro', 'hr', 'finance', 'employee'],
    children: [
      { label: 'Salary Slips', href: '/payroll', icon: 'FileText', roles: ['admin', 'chro', 'hr', 'finance', 'employee'], module: 'payroll' },
      { label: 'Salary Structures', href: '/admin/salary-structure', icon: 'IndianRupee', roles: ['admin'] },
      { label: 'Pay Schedule', href: '/setup/pay-schedule', icon: 'CalendarClock', roles: ['admin', 'finance'] },
      { label: 'Statutory Components', href: '/setup/statutory-components', icon: 'Landmark', roles: ['admin', 'finance'] },
      { label: 'Salary Components', href: '/setup/salary-components', icon: 'Coins', roles: ['admin', 'finance'] },
    ],
  },
  {
    label: 'Shift Management',
    href: '/shifts/roster',
    icon: 'Clock',
    roles: ['admin', 'chro', 'hr', 'property_manager'],
    children: [
      // Roster: build + publish the weekly plan. Property managers roster their own site.
      { label: 'Roster', href: '/shifts/roster', icon: 'CalendarDays', roles: ['admin', 'chro', 'hr', 'property_manager'] },
      // Employee assignment + change-request approvals live on /shifts and were
      // previously admin-only (the Admin dashboard card), so keep them admin-only.
      { label: 'Employee Shifts', href: '/shifts', icon: 'Users', roles: ['admin'] },
      // Shift-type/schedule/location config was the old "Shift Setup" (admin/CHRO/HR).
      { label: 'Shift Types', href: '/shift-setup/type', icon: 'Tag', roles: ['admin', 'chro', 'hr'] },
      { label: 'Shift Schedule', href: '/shift-setup/schedule', icon: 'CalendarClock', roles: ['admin', 'chro', 'hr'] },
      { label: 'Shift Location', href: '/shift-setup/location', icon: 'MapPin', roles: ['admin', 'chro', 'hr'] },
      { label: 'Change Requests', href: '/shifts?tab=requests', icon: 'ClipboardList', roles: ['admin'] },
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

// Recruitment funnel: a strict forward sequence. "rejected" is the off-ramp, not a
// step. A candidate may only advance one stage at a time (or be rejected). Mirrors
// the server-side rule in recruitment.service.ts (the server is authoritative).
export const RECRUITMENT_FUNNEL_ORDER = ['screening', 'interview', 'shortlisted', 'offered'] as const;

/** Stages a candidate at `from` may move to: the next funnel stage + "rejected". */
export function allowedNextStages(from: string): string[] {
  if (from === 'offered' || from === 'rejected') return [];
  const i = RECRUITMENT_FUNNEL_ORDER.indexOf(from as typeof RECRUITMENT_FUNNEL_ORDER[number]);
  const next: string[] = [];
  if (i !== -1 && i + 1 < RECRUITMENT_FUNNEL_ORDER.length) next.push(RECRUITMENT_FUNNEL_ORDER[i + 1]);
  next.push('rejected');
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
  finance: '/payroll',
};
