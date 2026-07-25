'use client';

import AppShell from '@/components/layout/AppShell';
import EmployeeDashboard from '@/components/dashboard/EmployeeDashboard';

/**
 * The self-service dashboard on its own route.
 *
 * `/dashboard` picks admin-vs-employee purely from the signed-in role, so staff could never
 * reach the employee view — which made the `dashboard_employee` module toggle a no-op for
 * everyone except employees. This route renders that view unconditionally, and the nav entry
 * pointing here is gated on `dashboard_employee`, so granting the module now does something.
 *
 * No access gate is needed beyond the sidebar's: EmployeeDashboard only ever reads the signed-in
 * user's OWN records (their leave, shifts, attendance), so reaching it directly discloses
 * nothing the viewer isn't already entitled to see.
 */
export default function MyDashboardPage() {
  return <AppShell><EmployeeDashboard /></AppShell>;
}
