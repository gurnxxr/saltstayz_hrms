'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import LoadError from '@/components/ui/LoadError';
import api from '@/lib/api';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useAuth } from '@/lib/auth';
import { Clock, Check, X, Search, User } from 'lucide-react';

const fmt = (t?: string) => (t ? t.slice(0, 5) : '');

// Shift-type definitions live under Shift Management → Shift Types (/shift-setup/type);
// this page handles per-employee assignment and change-request approvals.
type Tab = 'employees' | 'requests';

export default function ShiftsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canApprove = user?.roleName === 'admin' || user?.roleName === 'chro';

  // Tab lives in the URL (?tab=) so a refresh or deep link keeps you on the same tab.
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawTab = searchParams.get('tab');
  const tab: Tab = (['employees', 'requests'].includes(rawTab || '') ? rawTab : 'employees') as Tab;
  const setTab = (t: Tab) => router.replace(`/shifts?tab=${t}`, { scroll: false });

  // Employee search state
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);

  const { data: shiftTypes = [] } = useQuery({
    queryKey: ['all-shift-types'],
    queryFn: () => api.get('/shifts/types').then(r => r.data),
  });
  const activeShifts = shiftTypes.filter((s: any) => s.is_active);

  const { data: employeeShifts = [], isLoading: empLoading } = useQuery({
    queryKey: ['employee-shifts', debouncedSearch],
    queryFn: () => api.get(`/shifts/employee-shifts?q=${encodeURIComponent(debouncedSearch)}`).then(r => r.data),
    enabled: tab === 'employees',
  });

  const { data: changeRequests = [], isError: reqError, refetch: refetchReq } = useQuery({
    queryKey: ['change-requests'],
    queryFn: () => api.get('/shifts/change-requests').then(r => r.data),
    enabled: tab === 'requests',
  });

  const assignEmpMutation = useMutation({
    mutationFn: ({ employeeId, shiftTypeId }: { employeeId: number; shiftTypeId: string }) =>
      shiftTypeId
        ? api.put(`/shifts/employee-shifts/${employeeId}`, { shift_type_id: Number(shiftTypeId) })
        : api.delete(`/shifts/employee-shifts/${employeeId}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['employee-shifts'] }); toast.success('Shift updated'); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to update shift'),
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, approved }: { id: number; approved: boolean }) => api.put(`/shifts/change-requests/${id}`, { approved }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['change-requests'] });
      queryClient.invalidateQueries({ queryKey: ['all-shift-types'] });
      queryClient.invalidateQueries({ queryKey: ['employee-shifts'] });
      toast.success('Request processed');
    },
    onError: () => toast.error('Failed to process request'),
  });

  const pendingCount = changeRequests.filter((r: any) => r.status === 'pending').length;

  const TABS: { key: Tab; label: string }[] = [
    { key: 'employees', label: 'Employee Shifts' },
    { key: 'requests', label: 'Change Requests' },
  ];

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Shift Management</h1>
          <p className="text-secondary mt-1">Per-employee shift assignment and change requests</p>
        </div>

        <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === t.key ? 'bg-card text-foreground shadow-sm' : 'text-secondary hover:text-foreground'}`}>
              {t.label}
              {t.key === 'requests' && pendingCount > 0 && (
                <span className="ml-2 px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded-full text-xs">{pendingCount}</span>
              )}
            </button>
          ))}
        </div>

        {/* ─── Employee Shifts ─── */}
        {tab === 'employees' && (
          <div className="space-y-4">
            <div className="relative max-w-md">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search employee by name, code, or designation..."
                className="w-full pl-9 pr-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>

            {activeShifts.length === 0 && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                No shift types yet. Create one under <Link href="/shift-setup/type" className="underline font-medium">Shift Types</Link> first.
              </p>
            )}

            <div className="bg-card rounded-xl border border-border overflow-hidden">
              {empLoading ? (
                <div className="p-6 space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-10 bg-muted rounded animate-pulse" />)}</div>
              ) : employeeShifts.length === 0 ? (
                <div className="p-8 text-center text-secondary">No employees found</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Employee</th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Designation</th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Current Shift</th>
                        <th className="text-right px-4 py-3 text-xs font-medium text-secondary uppercase">Assign Shift</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {employeeShifts.map((e: any) => (
                        <tr key={e.id} className="hover:bg-muted/30">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0"><User size={14} className="text-primary" /></div>
                              <div>
                                <p className="text-sm font-medium text-foreground">{e.first_name} {e.last_name}</p>
                                <p className="text-xs text-secondary">{e.employee_code}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-secondary">{e.designation || '—'}</td>
                          <td className="px-4 py-3">
                            {e.shift_name ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                                <Clock size={12} /> {e.shift_name} ({fmt(e.start_time)}–{fmt(e.end_time)})
                              </span>
                            ) : (
                              <span className="text-xs text-secondary">Unassigned</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <select value={e.shift_type_id ? String(e.shift_type_id) : ''}
                              onChange={(ev) => assignEmpMutation.mutate({ employeeId: e.id, shiftTypeId: ev.target.value })}
                              disabled={assignEmpMutation.isPending || activeShifts.length === 0}
                              className="px-3 py-1.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50">
                              <option value="">— Unassigned —</option>
                              {activeShifts.map((s: any) => <option key={s.id} value={s.id}>{s.name} ({fmt(s.start_time)}–{fmt(s.end_time)})</option>)}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── Change Requests ─── */}
        {tab === 'requests' && (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            {reqError ? (
              <LoadError message="Couldn't load change requests." onRetry={() => refetchReq()} />
            ) : changeRequests.length === 0 ? (
              <div className="p-8 text-center text-secondary">No change requests.</div>
            ) : (
              <div className="divide-y divide-border">
                {changeRequests.map((cr: any) => {
                  const isAssignment = cr.field_changed === 'shift_assignment';
                  return (
                    <div key={cr.id} className="p-4 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        {isAssignment ? (
                          <p className="text-sm font-medium text-foreground">
                            {cr.requested_by_name || cr.requested_by_email} requests shift change
                          </p>
                        ) : (
                          <p className="text-sm font-medium text-foreground">
                            {cr.shift_name}: change <span className="font-mono text-xs bg-muted px-1 rounded">{cr.field_changed}</span>
                          </p>
                        )}
                        <p className="text-sm text-secondary">{cr.old_value} → <span className="font-semibold text-foreground">{cr.new_value}</span></p>
                        {cr.reason && <p className="text-xs text-secondary mt-1">Reason: {cr.reason}</p>}
                        <p className="text-xs text-secondary mt-1">Requested by {cr.requested_by_email} &middot; {new Date(cr.created_at).toLocaleDateString()}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {cr.status === 'pending' && canApprove ? (
                          <>
                            <button onClick={() => approveMutation.mutate({ id: cr.id, approved: true })} className="p-2 rounded-lg bg-green-50 text-green-600 hover:bg-green-100 transition-colors" title="Approve"><Check size={16} /></button>
                            <button onClick={() => approveMutation.mutate({ id: cr.id, approved: false })} className="p-2 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors" title="Reject"><X size={16} /></button>
                          </>
                        ) : (
                          <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${cr.status === 'approved' ? 'bg-green-100 text-green-700' : cr.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>{cr.status}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

      </div>
    </AppShell>
  );
}
