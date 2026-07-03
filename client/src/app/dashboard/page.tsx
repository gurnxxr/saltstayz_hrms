'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import AppShell from '@/components/layout/AppShell';
import LoadError from '@/components/ui/LoadError';
import { usePermissions } from '@/hooks/usePermissions';
import api from '@/lib/api';
import EmployeeDashboard from '@/components/dashboard/EmployeeDashboard';
import { CalendarCheck, CalendarOff, Users, Clock, Briefcase, UserPlus } from 'lucide-react';

export default function DashboardPage() {
  const { isEmployee } = usePermissions();

  if (isEmployee) {
    return <AppShell><EmployeeDashboard /></AppShell>;
  }
  return <AppShell><OrgDashboard /></AppShell>;
}

function OrgDashboard() {
  const router = useRouter();
  const { can } = usePermissions();

  // Only surface quick actions the user can actually open (no dead-end 403s).
  const quickActions = [
    { label: 'View Analytics', href: '/analytics', module: 'analytics' },
    { label: 'Manage Shifts', href: '/shifts', module: 'shifts' },
    { label: 'Recruitment', href: '/recruitment', module: 'recruitment' },
    { label: 'Employees', href: '/employees', module: 'employees' },
  ].filter(a => can(a.module, 'read'));

  const { data: overview, isError: overviewError, refetch: refetchOverview } = useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: () => api.get('/analytics/overview').then(r => r.data),
  });

  return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-secondary mt-1">Organization overview</p>
        </div>

        {overviewError && <LoadError message="Couldn't load the dashboard overview." onRetry={() => refetchOverview()} />}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <DashboardCard
            icon={<Users className="w-6 h-6" />}
            label="Total Employees"
            value={overview?.totalEmployees ?? '--'}
            color="bg-blue-50 text-blue-600"
          />
          <DashboardCard
            icon={<CalendarCheck className="w-6 h-6" />}
            label="Present Today"
            value={overview?.presentToday ?? '--'}
            color="bg-green-50 text-green-600"
          />
          <DashboardCard
            icon={<CalendarOff className="w-6 h-6" />}
            label="On Leave Today"
            value={overview?.onLeaveToday ?? '--'}
            color="bg-amber-50 text-amber-600"
          />
          <DashboardCard
            icon={<Clock className="w-6 h-6" />}
            label="Pending Leaves"
            value={overview?.pendingLeaves ?? '--'}
            color="bg-red-50 text-red-600"
          />
          <DashboardCard
            icon={<Briefcase className="w-6 h-6" />}
            label="Open Vacancies"
            value={overview?.openVacancies ?? '--'}
            color="bg-purple-50 text-purple-600"
          />
          <DashboardCard
            icon={<UserPlus className="w-6 h-6" />}
            label="Total Candidates"
            value={overview?.totalCandidates ?? '--'}
            color="bg-cyan-50 text-cyan-600"
          />
        </div>

        {/* Quick Actions */}
        {quickActions.length > 0 && (
          <div className="bg-card rounded-xl border border-border p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Quick Actions</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {quickActions.map(action => (
                <button
                  key={action.label}
                  onClick={() => router.push(action.href)}
                  className="px-4 py-3 border border-border rounded-lg text-sm font-medium text-foreground hover:bg-muted transition-colors text-left"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Recent Hires */}
        {overview?.recentHires?.length > 0 && (
          <div className="bg-card rounded-xl border border-border p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Recent Hires</h2>
            <div className="divide-y divide-border">
              {overview.recentHires.map((emp: any) => (
                <div key={emp.id} className="py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-bold">
                      {emp.first_name[0]}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{emp.first_name} {emp.last_name}</p>
                      <p className="text-xs text-secondary">{emp.employee_code}</p>
                    </div>
                  </div>
                  <p className="text-xs text-secondary">
                    Joined {new Date(emp.date_of_joining).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
  );
}

function DashboardCard({ icon, label, value, color }: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-secondary">{label}</p>
          <p className="text-2xl font-bold text-foreground mt-1">{value}</p>
        </div>
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}
