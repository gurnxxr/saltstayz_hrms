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
    roles: ['admin', 'chro', 'hr', 'hr_manager', 'employee'],
    module: 'analytics',
  },
  {
    label: 'Employee Details',
    href: '/employees',
    icon: 'Users',
    roles: ['admin', 'chro', 'hr', 'hr_manager', 'property_manager'],
    module: 'employees',
  },
  {
    label: 'Leave & Attendance',
    href: '/attendance',
    icon: 'CalendarCheck',
    roles: ['admin', 'chro', 'hr', 'property_manager', 'employee'],
    module: 'attendance',
  },
  {
    label: 'Recruitment',
    href: '/recruitment',
    icon: 'Briefcase',
    roles: ['admin', 'chro', 'hr', 'hr_manager'],
    module: 'recruitment',
  },
  {
    label: 'Onboarding',
    href: '/onboarding',
    icon: 'UserPlus',
    roles: ['admin', 'chro', 'hr', 'hr_manager'],
    module: 'onboarding',
  },
  {
    label: 'Offboarding',
    href: '/offboarding',
    icon: 'UserMinus',
    roles: ['admin', 'chro', 'hr', 'hr_manager'],
    module: 'onboarding',
  },
  {
    label: 'Financial Details',
    href: '/finance',
    icon: 'Landmark',
    roles: ['admin', 'chro', 'hr', 'finance'],
    module: 'finance',
  },
  {
    label: 'Payroll',
    href: '/payroll',
    icon: 'Wallet',
    roles: ['admin', 'chro', 'hr', 'finance', 'employee'],
    module: 'payroll',
  },
  {
    label: 'Manpower & Budget',
    href: '/manpower',
    icon: 'ShieldCheck',
    roles: ['admin', 'chro', 'cluster_hr', 'property_manager'],
    module: 'manpower',
  },
  {
    label: 'Setup & Configuration',
    href: '/setup/pay-schedule',
    icon: 'SlidersHorizontal',
    roles: ['admin', 'finance'],
    children: [
      { label: 'Pay Schedule', href: '/setup/pay-schedule', icon: 'CalendarClock', roles: ['admin', 'finance'] },
      { label: 'Statutory Components', href: '/setup/statutory-components', icon: 'Landmark', roles: ['admin', 'finance'] },
      { label: 'Salary Components', href: '/setup/salary-components', icon: 'Coins', roles: ['admin', 'finance'] },
    ],
  },
  {
    label: 'Admin',
    href: '/admin',
    icon: 'Settings',
    roles: ['admin', 'chro', 'hr'],
    module: 'admin',
  },
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
