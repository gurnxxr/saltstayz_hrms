'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import Breadcrumb from '@/components/ui/Breadcrumb';
import LoadError from '@/components/ui/LoadError';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { Plus, Pencil, X, Loader2, Save, CalendarRange, Users } from 'lucide-react';

const inputCls = 'w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';

export default function LeaveControlPanelPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <Breadcrumb className="mb-2" items={[{ label: 'Leaves' }, { label: 'Control Panel' }]} />
          <h1 className="text-2xl font-bold text-foreground">Leave Control Panel</h1>
          <p className="text-secondary mt-1">Leave types, leave periods, and bulk allocation</p>
        </div>
        <LeaveTypesCard />
        <LeavePeriodsCard />
        <BulkAllocationCard />
      </div>
    </AppShell>
  );
}

// ─── Leave Types ───

function LeaveTypesCard() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<any | 'new' | null>(null);
  const [form, setForm] = useState({ name: '', default_days: '', is_paid: true, is_encashable: false, is_active: true });

  const { data: types = [], isError, refetch } = useQuery({
    queryKey: ['leave-types-all'],
    queryFn: () => api.get('/leave/types/all').then(r => r.data),
  });

  const openNew = () => { setForm({ name: '', default_days: '', is_paid: true, is_encashable: false, is_active: true }); setEditing('new'); };
  const openEdit = (t: any) => {
    setForm({ name: t.name, default_days: String(t.default_days), is_paid: !!t.is_paid, is_encashable: !!t.is_encashable, is_active: !!t.is_active });
    setEditing(t);
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(), default_days: Number(form.default_days),
        is_paid: form.is_paid, is_encashable: form.is_encashable, is_active: form.is_active,
      };
      return editing === 'new' ? api.post('/leave/types', payload) : api.put(`/leave/types/${(editing as any).id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-types-all'] });
      queryClient.invalidateQueries({ queryKey: ['leave-types'] });
      toast.success(editing === 'new' ? 'Leave type created' : 'Leave type saved');
      setEditing(null);
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to save'),
  });

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Leave Types</h2>
        <button onClick={openNew}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium hover:bg-primary/90 transition-colors">
          <Plus size={13} /> New Type
        </button>
      </div>
      {isError ? (
        <LoadError message="Couldn't load leave types." onRetry={() => refetch()} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-secondary">
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-3 py-2.5 font-medium text-right">Default Days/yr</th>
                <th className="px-4 py-2.5 font-medium">Paid</th>
                <th className="px-4 py-2.5 font-medium">Encashable</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {types.map((t: any) => (
                <tr key={t.id} className="hover:bg-muted/20">
                  <td className="px-4 py-2.5 font-medium text-foreground">{t.name}</td>
                  <td className="px-3 py-2.5 text-right text-secondary">{t.default_days}</td>
                  <td className="px-4 py-2.5">{t.is_paid
                    ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Paid</span>
                    : <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Unpaid (LOP)</span>}
                  </td>
                  <td className="px-4 py-2.5">{t.is_encashable
                    ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">Yes</span>
                    : <span className="text-xs text-secondary">—</span>}
                  </td>
                  <td className="px-4 py-2.5">{t.is_active
                    ? <span className="text-xs text-green-700">Active</span>
                    : <span className="text-xs text-secondary">Inactive</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => openEdit(t)} title="Edit"
                      className="p-1.5 rounded-lg text-secondary hover:text-foreground hover:bg-muted transition-colors">
                      <Pencil size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={() => setEditing(null)} />
          <div className="relative bg-card rounded-xl border border-border shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-base font-semibold text-foreground">{editing === 'new' ? 'New Leave Type' : 'Edit Leave Type'}</h3>
              <button onClick={() => setEditing(null)} className="p-1 rounded-lg text-secondary hover:text-foreground hover:bg-muted transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Name<span className="text-red-600"> *</span></label>
                <input className={inputCls} value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Casual Leave" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Default days per year<span className="text-red-600"> *</span></label>
                <input type="number" min={0} className={inputCls} value={form.default_days}
                  onChange={(e) => setForm(p => ({ ...p, default_days: e.target.value }))} />
              </div>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input type="checkbox" className="accent-primary w-4 h-4 mt-0.5" checked={form.is_paid}
                  onChange={(e) => setForm(p => ({ ...p, is_paid: e.target.checked }))} />
                <span className="text-sm text-foreground">Paid leave <span className="block text-xs text-secondary">Unchecked = unpaid: approved days count as Loss of Pay in payroll.</span></span>
              </label>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input type="checkbox" className="accent-primary w-4 h-4 mt-0.5" checked={form.is_encashable}
                  onChange={(e) => setForm(p => ({ ...p, is_encashable: e.target.checked }))} />
                <span className="text-sm text-foreground">Encashable <span className="block text-xs text-secondary">Unused days can be encashed from Leaves → Encashment.</span></span>
              </label>
              {editing !== 'new' && (
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" className="accent-primary w-4 h-4" checked={form.is_active}
                    onChange={(e) => setForm(p => ({ ...p, is_active: e.target.checked }))} />
                  <span className="text-sm text-foreground">Active</span>
                </label>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
              <button onClick={() => setEditing(null)} className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors">Cancel</button>
              <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !form.name.trim() || form.default_days === ''}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                {saveMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Leave Periods ───

function LeavePeriodsCard() {
  const queryClient = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', start_date: '', end_date: '' });
  const [confirmCurrent, setConfirmCurrent] = useState<any | null>(null);

  const { data: periods = [], isError, refetch } = useQuery({
    queryKey: ['leave-periods'],
    queryFn: () => api.get('/leave/periods').then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/leave/periods', form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-periods'] });
      toast.success('Leave period created');
      setShowNew(false);
      setForm({ name: '', start_date: '', end_date: '' });
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to create period'),
  });

  const setCurrentMutation = useMutation({
    mutationFn: (id: number) => api.put(`/leave/periods/${id}/current`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-periods'] });
      toast.success('Current period updated');
      setConfirmCurrent(null);
    },
    onError: (err: any) => { toast.error(err.response?.data?.error || 'Failed to update'); setConfirmCurrent(null); },
  });

  const fmt = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2"><CalendarRange size={15} className="text-primary" /> Leave Periods</h2>
        <button onClick={() => setShowNew(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium hover:bg-primary/90 transition-colors">
          <Plus size={13} /> New Period
        </button>
      </div>
      {isError ? (
        <LoadError message="Couldn't load leave periods." onRetry={() => refetch()} />
      ) : (
        <div className="divide-y divide-border">
          {periods.map((p: any) => (
            <div key={p.id} className="px-5 py-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">{p.name}
                  {!!p.is_current && <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700">Current</span>}
                </p>
                <p className="text-xs text-secondary">{fmt(p.start_date)} — {fmt(p.end_date)}</p>
              </div>
              {!p.is_current && (
                <button onClick={() => setConfirmCurrent(p)}
                  className="px-3 py-1.5 border border-border rounded-lg text-xs font-medium hover:bg-muted transition-colors">
                  Set current
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowNew(false)} />
          <div className="relative bg-card rounded-xl border border-border shadow-xl w-full max-w-sm p-5 space-y-4">
            <h3 className="text-base font-semibold text-foreground">New Leave Period</h3>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Name<span className="text-red-600"> *</span></label>
              <input className={inputCls} value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. 2027-2028" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Start<span className="text-red-600"> *</span></label>
                <input type="date" className={inputCls} value={form.start_date} onChange={(e) => setForm(p => ({ ...p, start_date: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">End<span className="text-red-600"> *</span></label>
                <input type="date" className={inputCls} value={form.end_date} min={form.start_date} onChange={(e) => setForm(p => ({ ...p, end_date: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowNew(false)} className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors">Cancel</button>
              <button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !form.name.trim() || !form.start_date || !form.end_date}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                {createMutation.isPending && <Loader2 size={14} className="animate-spin" />} Create
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmCurrent}
        title="Set current leave period?"
        danger={false}
        confirmLabel="Set current"
        message={confirmCurrent ? <>Balances, applications and allocations will use <span className="font-medium text-foreground">{confirmCurrent.name}</span> from now on. Make sure entitlements are allocated for it.</> : undefined}
        loading={setCurrentMutation.isPending}
        onConfirm={() => confirmCurrent && setCurrentMutation.mutate(confirmCurrent.id)}
        onCancel={() => setConfirmCurrent(null)}
      />
    </div>
  );
}

// ─── Bulk Allocation ───

function BulkAllocationCard() {
  const queryClient = useQueryClient();
  const [periodId, setPeriodId] = useState('');
  const [typeId, setTypeId] = useState('');
  const [days, setDays] = useState('');
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const { data: periods = [] } = useQuery({
    queryKey: ['leave-periods'],
    queryFn: () => api.get('/leave/periods').then(r => r.data),
  });
  const { data: types = [] } = useQuery({
    queryKey: ['leave-types'],
    queryFn: () => api.get('/leave/types').then(r => r.data),
  });
  const { data: properties = [] } = useQuery({
    queryKey: ['properties'],
    queryFn: () => api.get('/admin/properties').then(r => r.data),
  });

  // Default the period to current once loaded.
  const currentPeriod = periods.find((p: any) => p.is_current);
  useEffect(() => {
    if (!periodId && currentPeriod) setPeriodId(String(currentPeriod.id));
  }, [currentPeriod, periodId]);

  const { data: employees = [] } = useQuery({
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
    if (!q) return employees;
    return employees.filter((e: any) =>
      `${e.first_name} ${e.last_name}`.toLowerCase().includes(q) || e.employee_code?.toLowerCase().includes(q));
  }, [employees, search]);

  const toggle = (id: number) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allVisibleSelected = filtered.length > 0 && filtered.every((e: any) => selected.has(e.id));
  const toggleAll = () => setSelected((prev) => {
    const next = new Set(prev);
    if (allVisibleSelected) filtered.forEach((e: any) => next.delete(e.id));
    else filtered.forEach((e: any) => next.add(e.id));
    return next;
  });

  const allocateMutation = useMutation({
    mutationFn: () => api.post('/leave/entitlements/bulk', {
      leave_period_id: Number(periodId),
      leave_type_id: Number(typeId),
      days: Number(days),
      employee_ids: Array.from(selected),
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['leave-entitlements'] });
      queryClient.invalidateQueries({ queryKey: ['leave-balances'] });
      const { created, updated, skipped } = res.data;
      toast.success(`Allocated: ${created} created, ${updated} updated${skipped?.length ? `, ${skipped.length} skipped (already-used days)` : ''}`);
      setSelected(new Set());
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Bulk allocation failed'),
  });

  const canAllocate = periodId && typeId && days !== '' && Number(days) >= 0 && selected.size > 0;

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2"><Users size={15} className="text-primary" /> Bulk Allocation</h2>
        <p className="text-xs text-secondary mt-0.5">Set one leave type&apos;s allocation for many employees at once. Existing rows keep their used days.</p>
      </div>
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">Period</label>
            <select className={inputCls} value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
              {periods.map((p: any) => <option key={p.id} value={p.id}>{p.name}{p.is_current ? ' (current)' : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">Leave type</label>
            <select className={inputCls} value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              <option value="">Select…</option>
              {types.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">Days to allocate</label>
            <input type="number" min={0} className={inputCls} value={days} onChange={(e) => setDays(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">Property</label>
            <select className={inputCls} value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">All</option>
              {properties.map((p: any) => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
          </div>
        </div>

        <input className={inputCls} placeholder="Search employees…" value={search} onChange={(e) => setSearch(e.target.value)} />

        <div className="border border-border rounded-lg max-h-64 overflow-y-auto divide-y divide-border">
          <label className="flex items-center gap-2.5 px-3 py-2 bg-muted/40 cursor-pointer sticky top-0">
            <input type="checkbox" className="accent-primary w-4 h-4" checked={allVisibleSelected} onChange={toggleAll} />
            <span className="text-xs font-medium text-foreground">Select all visible ({filtered.length})</span>
          </label>
          {filtered.map((e: any) => (
            <label key={e.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-muted/20">
              <input type="checkbox" className="accent-primary w-4 h-4" checked={selected.has(e.id)} onChange={() => toggle(e.id)} />
              <span className="text-sm text-foreground flex-1">{e.first_name} {e.last_name} <span className="text-xs text-secondary">({e.employee_code}) · {e.branch_name || '—'}</span></span>
            </label>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <p className="text-xs text-secondary">{selected.size} employee(s) selected</p>
          <button onClick={() => allocateMutation.mutate()} disabled={!canAllocate || allocateMutation.isPending}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {allocateMutation.isPending && <Loader2 size={15} className="animate-spin" />} Allocate to selected
          </button>
        </div>
      </div>
    </div>
  );
}
