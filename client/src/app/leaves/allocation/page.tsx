'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import Breadcrumb from '@/components/ui/Breadcrumb';
import LoadError from '@/components/ui/LoadError';
import { CalendarPlus } from 'lucide-react';

// Allocation grid: rows = active employees, columns = active leave types; each
// cell edits total_days for (employee, type, period). Saves on blur/Enter.
export default function LeaveAllocationPage() {
  const queryClient = useQueryClient();
  const [periodId, setPeriodId] = useState('');
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState('');
  // cell drafts keyed "employeeId:typeId"
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const { data: periods = [] } = useQuery({
    queryKey: ['leave-periods'],
    queryFn: () => api.get('/leave/periods').then(r => r.data),
  });
  const currentPeriod = periods.find((p: any) => p.is_current);
  useEffect(() => {
    if (!periodId && currentPeriod) setPeriodId(String(currentPeriod.id));
  }, [currentPeriod, periodId]);

  const { data: types = [] } = useQuery({
    queryKey: ['leave-types'],
    queryFn: () => api.get('/leave/types').then(r => r.data),
  });
  const { data: properties = [] } = useQuery({
    queryKey: ['properties'],
    queryFn: () => api.get('/admin/properties').then(r => r.data),
  });

  const { data: rows = [], isError, refetch } = useQuery({
    queryKey: ['leave-entitlements', periodId, branch],
    queryFn: () => {
      const params = new URLSearchParams({ period_id: periodId });
      if (branch) params.set('branch', branch);
      return api.get(`/leave/entitlements?${params}`).then(r => r.data);
    },
    enabled: !!periodId,
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return rows;
    return rows.filter((e: any) =>
      `${e.first_name} ${e.last_name}`.toLowerCase().includes(q) || e.employee_code?.toLowerCase().includes(q));
  }, [rows, search]);

  const saveMutation = useMutation({
    mutationFn: (vars: { employee_id: number; leave_type_id: number; total_days: number }) =>
      api.put('/leave/entitlements', { ...vars, leave_period_id: Number(periodId) }),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ['leave-entitlements'] });
      queryClient.invalidateQueries({ queryKey: ['leave-balances'] });
      setDrafts((p) => { const n = { ...p }; delete n[`${vars.employee_id}:${vars.leave_type_id}`]; return n; });
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to save allocation'),
  });

  const entFor = (emp: any, typeId: number) =>
    emp.entitlements?.find((x: any) => x.leave_type_id === typeId) ?? null;

  const cellKey = (empId: number, typeId: number) => `${empId}:${typeId}`;

  const commit = (emp: any, typeId: number) => {
    const key = cellKey(emp.id, typeId);
    const draft = drafts[key];
    if (draft === undefined) return;
    const ent = entFor(emp, typeId);
    const original = ent ? String(ent.total_days) : '';
    if (draft === original || draft === '') {
      setDrafts((p) => { const n = { ...p }; delete n[key]; return n; });
      return;
    }
    const value = Number(draft);
    if (!Number.isFinite(value) || value < 0) { toast.error('Enter a valid number of days'); return; }
    if (ent && value < ent.used_days) { toast.error(`${ent.used_days} day(s) already used — allocate at least that`); return; }
    saveMutation.mutate({ employee_id: emp.id, leave_type_id: typeId, total_days: value });
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <Breadcrumb className="mb-2" items={[{ label: 'Leaves' }, { label: 'Allocation' }]} />
          <h1 className="text-2xl font-bold text-foreground">Leave Allocation</h1>
          <p className="text-secondary mt-1">Per-employee leave entitlements for a period — edit a cell and press Enter or click away to save</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select value={periodId} onChange={(e) => setPeriodId(e.target.value)}
            className="px-3 py-2 border border-border rounded-lg bg-background text-sm">
            {periods.map((p: any) => <option key={p.id} value={p.id}>{p.name}{p.is_current ? ' (current)' : ''}</option>)}
          </select>
          <select value={branch} onChange={(e) => setBranch(e.target.value)}
            className="px-3 py-2 border border-border rounded-lg bg-background text-sm">
            <option value="">All Properties</option>
            {properties.map((p: any) => <option key={p.id} value={p.name}>{p.name}</option>)}
          </select>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee…"
            className="px-3 py-2 border border-border rounded-lg bg-background text-sm min-w-56 focus:outline-none focus:ring-2 focus:ring-primary/50" />
        </div>

        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {isError ? (
            <LoadError message="Couldn't load entitlements." onRetry={() => refetch()} />
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-secondary">
              <CalendarPlus size={32} className="mx-auto mb-2 opacity-40" />
              <p className="text-sm">No employees match.</p>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b border-border text-left text-secondary">
                    <th className="px-4 py-3 font-medium">Employee</th>
                    {types.map((t: any) => (
                      <th key={t.id} className="px-3 py-3 font-medium text-center min-w-28">{t.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((emp: any) => (
                    <tr key={emp.id} className="hover:bg-muted/10">
                      <td className="px-4 py-2">
                        <p className="font-medium text-foreground">{emp.first_name} {emp.last_name}</p>
                        <p className="text-xs text-secondary">{emp.employee_code} · {emp.branch_name || '—'}</p>
                      </td>
                      {types.map((t: any) => {
                        const ent = entFor(emp, t.id);
                        const key = cellKey(emp.id, t.id);
                        const value = drafts[key] ?? (ent ? String(ent.total_days) : '');
                        return (
                          <td key={t.id} className="px-3 py-2 text-center">
                            <input
                              type="number" min={0} step="0.5"
                              value={value}
                              placeholder="—"
                              onChange={(e) => setDrafts((p) => ({ ...p, [key]: e.target.value }))}
                              onBlur={() => commit(emp, t.id)}
                              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                              className={`w-20 px-2 py-1.5 border rounded-lg bg-background text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary/50 ${drafts[key] !== undefined ? 'border-primary' : 'border-border'}`}
                            />
                            {ent && ent.used_days > 0 && (
                              <p className="text-[10px] text-secondary mt-0.5">used {ent.used_days}</p>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {filtered.length > 0 && (
          <p className="text-xs text-secondary">{filtered.length} employee(s) · empty cell = no entitlement yet (typing a value creates one) · use Control Panel → Bulk Allocation for many at once</p>
        )}
      </div>
    </AppShell>
  );
}
