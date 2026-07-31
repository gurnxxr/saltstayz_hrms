'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import Breadcrumb from '@/components/ui/Breadcrumb';
import { Search, User, ShieldCheck, RotateCcw, AlertTriangle } from 'lucide-react';

const MODULE_LABELS: Record<string, string> = {
  dashboard_admin: 'Dashboard (Admin)',
  dashboard_employee: 'Dashboard (Employee)',
  analytics: 'Analytics',
  attendance: 'Attendance',
  // One key covers both the employee's own "My Leaves" page and the admin Leaves group,
  // because every leave endpoint is gated on it. Named so the toggle doesn't read as
  // controlling only the admin side.
  leave: 'Leaves (incl. My Leaves)',
  recruitment: 'Recruitment',
  employee_lifecycle: 'Employee Lifecycle',
  payroll: 'Payroll',
  salary: 'Salary',
  shifts: 'Shift Management',
  my_shifts: 'My Shift',
  admin: 'Admin',
  employees: 'Employee Records',
  onboarding: 'Onboarding',
  manpower: 'Manpower & Budget',
  finance: 'Bank Details',
  'admin.users': 'User Administration',
  payroll_setup: 'Payroll Configuration',
};

export default function ModuleAccessPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data: employees = [], isLoading: searching } = useQuery({
    queryKey: ['access-employee-search', debouncedSearch],
    queryFn: () => api.get(`/admin/module-access/employees?q=${encodeURIComponent(debouncedSearch)}`).then(r => r.data),
  });

  const { data: access, isLoading: accessLoading } = useQuery({
    queryKey: ['employee-access', selectedId],
    queryFn: () => api.get(`/admin/module-access/${selectedId}`).then(r => r.data),
    enabled: !!selectedId,
  });

  const setMutation = useMutation({
    mutationFn: ({ module, allowed }: { module: string; allowed: boolean | null }) =>
      api.put(`/admin/module-access/${selectedId}`, { module, allowed }).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employee-access', selectedId] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to update access'),
  });

  const resetMutation = useMutation({
    mutationFn: () => api.delete(`/admin/module-access/${selectedId}`).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employee-access', selectedId] });
      toast.success('Reverted to role defaults');
    },
  });

  const hasOverrides = access?.modules?.some((m: any) => m.override !== null);

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <Breadcrumb className="mb-2" items={[{ label: 'Admin', href: '/admin' }, { label: 'Module Access' }]} />
          <h1 className="text-2xl font-bold text-foreground">Module Access</h1>
          <p className="text-secondary mt-1">Search any employee and grant or revoke access to specific modules</p>
          <div className="mt-3 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 max-w-2xl">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              Granting a module gives <span className="font-semibold">full access</span> to it —
              every permission-gated action for that module (create, edit, delete, and any
              org-wide reads it has), regardless of the person&apos;s role. A few controls stay
              admin-only no matter what — e.g. approving over-limit hires and saving sanctioned
              budgets — so a grant won&apos;t hand those over. Grant only modules the employee
              should fully operate.
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-5 items-start">
          {/* Search + results */}
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Name, emp code, or designation..."
                  className="w-full pl-9 pr-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>
            <div className="max-h-[520px] overflow-y-auto divide-y divide-border">
              {searching ? (
                <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 bg-muted rounded animate-pulse" />)}</div>
              ) : employees.length === 0 ? (
                <p className="p-6 text-center text-sm text-secondary">No employees found</p>
              ) : (
                employees.map((e: any) => (
                  <button
                    key={e.id}
                    onClick={() => setSelectedId(e.id)}
                    className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors ${selectedId === e.id ? 'bg-primary/5' : 'hover:bg-muted/40'}`}
                  >
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <User size={15} className="text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{e.first_name} {e.last_name}</p>
                      <p className="text-xs text-secondary truncate">{e.employee_code} · {e.designation || 'No designation'}</p>
                    </div>
                    {!e.has_login && <span className="text-[10px] text-secondary border border-border rounded px-1.5 py-0.5 shrink-0">No login</span>}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Access detail */}
          <div className="bg-card rounded-xl border border-border min-h-[300px]">
            {!selectedId ? (
              <div className="flex flex-col items-center justify-center h-full py-20 text-secondary">
                <ShieldCheck size={40} className="opacity-30 mb-3" />
                <p className="text-sm">Select an employee to manage their module access</p>
              </div>
            ) : accessLoading || !access ? (
              <div className="p-6 space-y-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-12 bg-muted rounded animate-pulse" />)}</div>
            ) : (
              <>
                <div className="px-6 py-4 border-b border-border flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">{access.employee.first_name} {access.employee.last_name}</h2>
                    <p className="text-sm text-secondary">
                      {access.employee.employee_code} · {access.employee.designation || 'No designation'}
                      {access.role ? <> · access level <span className="font-medium text-foreground">{access.role}</span></> : ' · no login account'}
                    </p>
                  </div>
                  {hasOverrides && (
                    <button onClick={() => resetMutation.mutate()} disabled={resetMutation.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-xs hover:bg-muted transition-colors shrink-0">
                      <RotateCcw size={13} /> Reset to defaults
                    </button>
                  )}
                </div>

                {!access.hasLogin && (
                  <div className="mx-6 mt-4 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    This employee has no login account yet. Access settings are saved and will apply once a user account is created for them.
                  </div>
                )}

                <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {access.modules.map((m: any) => {
                    const isOverride = m.override !== null;
                    return (
                      <div key={m.module} className={`flex items-center justify-between gap-3 rounded-lg border p-3 ${isOverride ? 'border-primary/40 bg-primary/5' : 'border-border'}`}>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{MODULE_LABELS[m.module] || m.module}</p>
                          <p className="text-[11px] text-secondary">
                            {isOverride
                              ? <span className="text-primary">Custom · role default {m.roleDefault ? 'allowed' : 'denied'}</span>
                              : `Role default · ${m.roleDefault ? 'allowed' : 'denied'}`}
                          </p>
                        </div>
                        <button
                          onClick={() => setMutation.mutate({ module: m.module, allowed: !m.effective })}
                          disabled={setMutation.isPending}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${m.effective ? 'bg-green-500' : 'bg-gray-300'} ${setMutation.isPending ? 'opacity-60' : ''}`}
                          title={m.effective ? 'Click to revoke' : 'Click to grant'}
                        >
                          <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${m.effective ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
