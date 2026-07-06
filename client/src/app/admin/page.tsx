'use client';

import AppShell from '@/components/layout/AppShell';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Building2, Clock, ClipboardList, ShieldCheck, IndianRupee, ScrollText, DatabaseBackup, Play, CalendarCheck, Wallet, SlidersHorizontal, AlertTriangle } from 'lucide-react';

const adminModules = [
  { label: 'Property Configuration', href: '/admin/property-config', icon: SlidersHorizontal, description: 'Per-property workers, salaries, spend, budget & status', roles: ['admin'] },
  { label: 'Budget Control', href: '/admin/budget-control', icon: Wallet, description: 'Set sanctioned budget & headcount per property', roles: ['admin'] },
  { label: 'Module Access', href: '/admin/access', icon: ShieldCheck, description: 'Grant or revoke module access per employee', roles: ['admin'] },
  { label: 'Salary Structures', href: '/admin/salary-structure', icon: IndianRupee, description: 'Component-based salary templates per employee category', roles: ['admin'] },
  { label: 'Leave Approvals', href: '/admin/leave-approvals', icon: CalendarCheck, description: 'Review and approve pending leave requests', roles: ['admin', 'chro', 'hr'] },
  { label: 'Payroll Runs', href: '/admin/payroll-runs', icon: Play, description: 'Run and lock monthly payroll', roles: ['admin'] },
  { label: 'Audit Log', href: '/admin/audit-log', icon: ScrollText, description: 'Who changed what, when — full activity trail', roles: ['admin'] },
  { label: 'Database Backups', href: '/admin/backups', icon: DatabaseBackup, description: 'Create and review database snapshots', roles: ['admin'] },
  { label: 'Organization', href: '/admin/organization', icon: Building2, description: 'Properties, departments, and employee categories', roles: ['admin'] },
  { label: 'Shift Management', href: '/shifts', icon: Clock, description: 'Shift types, assignments, and change requests', roles: ['admin'] },
  { label: 'Attendance Admin', href: '/admin/attendance', icon: ClipboardList, description: 'Upload & review property attendance', roles: ['admin', 'chro', 'hr'] },
];

export default function AdminPage() {
  const { user } = useAuth();
  const isAdmin = user?.roleName === 'admin';
  const visibleModules = adminModules.filter(m => m.roles.includes(user?.roleName || ''));

  // How many properties have more workers hired than sanctioned — surfaced as a
  // badge on the Property Configuration card so the alert finds the admin, not
  // the other way around.
  const { data: budgets = [] } = useQuery({
    queryKey: ['admin-property-budgets'],
    queryFn: () => api.get('/manpower/property-budgets').then(r => r.data).catch(() => []),
    enabled: isAdmin,
  });
  const overLimitCount = budgets.filter((b: any) => b.over_worker_limit).length;

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Admin Panel</h1>
          <p className="text-secondary mt-1">System configuration</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleModules.map((mod) => {
            const Icon = mod.icon;
            return (
              <Link
                key={mod.href}
                href={mod.href}
                className="bg-card rounded-xl border border-border p-6 hover:border-primary hover:shadow-sm transition-all group"
              >
                <Icon className="w-8 h-8 text-primary mb-3" />
                <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors flex items-center gap-2">
                  {mod.label}
                  {mod.href === '/admin/property-config' && overLimitCount > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[11px] font-semibold" title="Properties with more workers hired than sanctioned">
                      <AlertTriangle size={11} /> {overLimitCount} over limit
                    </span>
                  )}
                </h3>
                <p className="text-sm text-secondary mt-1">{mod.description}</p>
              </Link>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
