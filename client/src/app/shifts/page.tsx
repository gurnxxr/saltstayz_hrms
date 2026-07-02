'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useAuth } from '@/lib/auth';
import { Plus, Clock, Check, X, Search, User } from 'lucide-react';

const fmt = (t?: string) => (t ? t.slice(0, 5) : '');

type Tab = 'employees' | 'types' | 'requests';

export default function ShiftsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canApprove = user?.roleName === 'admin' || user?.roleName === 'chro';

  const [tab, setTab] = useState<Tab>('employees');

  // Shift Types form + Employee search state
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', start_time: '', end_time: '' });
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

  const { data: changeRequests = [] } = useQuery({
    queryKey: ['change-requests'],
    queryFn: () => api.get('/shifts/change-requests').then(r => r.data).catch(() => []),
    enabled: tab === 'requests',
  });

  const createTypeMutation = useMutation({
    mutationFn: (data: typeof form) => api.post('/shifts/types', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-shift-types'] });
      toast.success('Shift type created');
      setShowForm(false);
      setForm({ name: '', start_time: '', end_time: '' });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to create shift type'),
  });

  const toggleTypeMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) => api.put(`/shifts/types/${id}`, { is_active }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['all-shift-types'] }); toast.success('Shift type updated'); },
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
    { key: 'types', label: 'Shift Types' },
    { key: 'requests', label: 'Change Requests' },
  ];

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Shift Management</h1>
          <p className="text-secondary mt-1">Per-employee shifts, shift types, and change requests</p>
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
                No shift types yet. Add one under the <button onClick={() => setTab('types')} className="underline font-medium">Shift Types</button> tab first.
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

        {/* ─── Shift Types ─── */}
        {tab === 'types' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
                <Plus size={16} /> Add Shift Type
              </button>
            </div>

            {showForm && (
              <form
                onSubmit={(e) => { e.preventDefault(); if (!form.name || !form.start_time || !form.end_time) { toast.error('Fill all fields'); return; } createTypeMutation.mutate(form); }}
                className="bg-card rounded-xl border border-border p-6 grid grid-cols-1 sm:grid-cols-3 gap-4"
              >
                <div>
                  <label className="block text-sm font-medium mb-1">Name *</label>
                  <input value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Morning, Night"
                    className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Start Time *</label>
                  <input type="time" value={form.start_time} onChange={(e) => setForm(p => ({ ...p, start_time: e.target.value }))}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">End Time *</label>
                  <input type="time" value={form.end_time} onChange={(e) => setForm(p => ({ ...p, end_time: e.target.value }))}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                </div>
                <div className="sm:col-span-3 flex gap-2">
                  <button type="submit" disabled={createTypeMutation.isPending} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">
                    {createTypeMutation.isPending ? 'Creating...' : 'Create'}
                  </button>
                  <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 border border-border rounded-lg text-sm">Cancel</button>
                </div>
              </form>
            )}

            <div className="bg-card rounded-xl border border-border overflow-hidden">
              {shiftTypes.length === 0 ? (
                <div className="p-8 text-center text-secondary">No shift types configured yet.</div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Name</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Timing</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Status</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-secondary uppercase">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {shiftTypes.map((st: any) => (
                      <tr key={st.id} className="hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2"><Clock size={14} className="text-secondary" /><span className="text-sm font-medium text-foreground">{st.name}</span></div>
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">{fmt(st.start_time)} – {fmt(st.end_time)}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${st.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{st.is_active ? 'Active' : 'Inactive'}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => toggleTypeMutation.mutate({ id: st.id, is_active: !st.is_active })} className="text-xs px-3 py-1 border border-border rounded-lg hover:bg-muted transition-colors">
                            {st.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ─── Change Requests ─── */}
        {tab === 'requests' && (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            {changeRequests.length === 0 ? (
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
