'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import Breadcrumb from '@/components/ui/Breadcrumb';
import LoadError from '@/components/ui/LoadError';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { Plus, Pencil, X, Loader2, Save, CalendarRange, Trash2 } from 'lucide-react';

const inputCls = 'w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';

// Leave-type form incl. the configurable policy rules (blank = no restriction).
const BLANK_LT_FORM = {
  name: '', default_days: '', is_paid: true, is_encashable: false, is_active: true,
  min_days_per_request: '', max_days_per_request: '', advance_notice_days: '', document_required_after_days: '',
  half_day_allowed: true, after_probation_only: false, count_sandwich_days: false, eligibility: 'any',
  cannot_club_with: [] as number[],
};

export default function LeaveControlPanelPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <Breadcrumb className="mb-2" items={[{ label: 'Leaves' }, { label: 'Control Panel' }]} />
          <h1 className="text-2xl font-bold text-foreground">Leave Control Panel</h1>
          <p className="text-secondary mt-1">Leave types and leave periods</p>
        </div>
        <LeaveTypesCard />
        <LeavePeriodsCard />
      </div>
    </AppShell>
  );
}

// ─── Leave Types ───

function LeaveTypesCard() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<any | 'new' | null>(null);
  const [form, setForm] = useState<any>(BLANK_LT_FORM);
  const [confirmDelete, setConfirmDelete] = useState<any | null>(null);

  const { data: types = [], isError, refetch } = useQuery({
    queryKey: ['leave-types-all'],
    queryFn: () => api.get('/leave/types/all').then(r => r.data),
  });

  const openNew = () => { setForm(BLANK_LT_FORM); setEditing('new'); };
  const openEdit = (t: any) => {
    const num = (v: any) => (v != null ? String(v) : '');
    setForm({
      name: t.name, default_days: String(t.default_days), is_paid: !!t.is_paid, is_encashable: !!t.is_encashable, is_active: !!t.is_active,
      min_days_per_request: num(t.min_days_per_request), max_days_per_request: num(t.max_days_per_request),
      advance_notice_days: num(t.advance_notice_days), document_required_after_days: num(t.document_required_after_days),
      half_day_allowed: t.half_day_allowed !== false, after_probation_only: !!t.after_probation_only,
      count_sandwich_days: !!t.count_sandwich_days, eligibility: t.eligibility || 'any',
      cannot_club_with: Array.isArray(t.cannot_club_with) ? t.cannot_club_with : [],
    });
    setEditing(t);
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(), default_days: Number(form.default_days),
        is_paid: form.is_paid, is_encashable: form.is_encashable, is_active: form.is_active,
        // Policy rules (blank string → server stores null = no restriction).
        min_days_per_request: form.min_days_per_request, max_days_per_request: form.max_days_per_request,
        advance_notice_days: form.advance_notice_days, document_required_after_days: form.document_required_after_days,
        half_day_allowed: form.half_day_allowed, after_probation_only: form.after_probation_only,
        count_sandwich_days: form.count_sandwich_days, eligibility: form.eligibility,
        cannot_club_with: form.cannot_club_with,
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

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/leave/types/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-types-all'] });
      queryClient.invalidateQueries({ queryKey: ['leave-types'] });
      toast.success('Leave type deleted');
      setConfirmDelete(null);
    },
    onError: (err: any) => { toast.error(err.response?.data?.error || 'Failed to delete'); setConfirmDelete(null); },
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
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(t)} title="Edit"
                        className="p-1.5 rounded-lg text-secondary hover:text-foreground hover:bg-muted transition-colors">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => setConfirmDelete(t)} title="Delete"
                        className="p-1.5 rounded-lg text-secondary hover:text-red-600 hover:bg-red-50 transition-colors">
                        <Trash2 size={14} />
                      </button>
                    </div>
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
          <div className="relative bg-card rounded-xl border border-border shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-base font-semibold text-foreground">{editing === 'new' ? 'New Leave Type' : 'Edit Leave Type'}</h3>
              <button onClick={() => setEditing(null)} className="p-1 rounded-lg text-secondary hover:text-foreground hover:bg-muted transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Name<span className="text-red-600"> *</span></label>
                <input className={inputCls} value={form.name} onChange={(e) => setForm((p: any) => ({ ...p, name: e.target.value }))} placeholder="e.g. Casual Leave" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Default days per year<span className="text-red-600"> *</span></label>
                <input type="number" min={0} className={inputCls} value={form.default_days}
                  onChange={(e) => setForm((p: any) => ({ ...p, default_days: e.target.value }))} />
              </div>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input type="checkbox" className="accent-primary w-4 h-4 mt-0.5" checked={form.is_paid}
                  onChange={(e) => setForm((p: any) => ({ ...p, is_paid: e.target.checked }))} />
                <span className="text-sm text-foreground">Paid leave <span className="block text-xs text-secondary">Unchecked = unpaid: approved days count as Loss of Pay in payroll.</span></span>
              </label>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input type="checkbox" className="accent-primary w-4 h-4 mt-0.5" checked={form.is_encashable}
                  onChange={(e) => setForm((p: any) => ({ ...p, is_encashable: e.target.checked }))} />
                <span className="text-sm text-foreground">Encashable <span className="block text-xs text-secondary">Unused days can be encashed from Leaves → Encashment.</span></span>
              </label>
              {editing !== 'new' && (
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" className="accent-primary w-4 h-4" checked={form.is_active}
                    onChange={(e) => setForm((p: any) => ({ ...p, is_active: e.target.checked }))} />
                  <span className="text-sm text-foreground">Active</span>
                </label>
              )}

              {/* ── Policy rules (all optional; blank = no restriction) ── */}
              <div className="pt-3 border-t border-border space-y-3">
                <p className="text-xs font-semibold text-secondary uppercase">Policy — optional, blank = no limit</p>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    ['min_days_per_request', 'Min days / request'],
                    ['max_days_per_request', 'Max days / request'],
                    ['advance_notice_days', 'Advance notice (days)'],
                    ['document_required_after_days', 'Document required after (days)'],
                  ] as [string, string][]).map(([key, label]) => (
                    <div key={key}>
                      <label className="block text-xs font-medium text-secondary mb-1">{label}</label>
                      <input type="number" min={0} className={inputCls} value={form[key]}
                        onChange={(e) => setForm((p: any) => ({ ...p, [key]: e.target.value }))} />
                    </div>
                  ))}
                </div>
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1">Who can take it</label>
                  <select className={inputCls} value={form.eligibility} onChange={(e) => setForm((p: any) => ({ ...p, eligibility: e.target.value }))}>
                    <option value="any">Anyone</option>
                    <option value="female">Female only</option>
                    <option value="male">Male only</option>
                  </select>
                </div>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" className="accent-primary w-4 h-4" checked={form.half_day_allowed}
                    onChange={(e) => setForm((p: any) => ({ ...p, half_day_allowed: e.target.checked }))} />
                  <span className="text-sm text-foreground">Half-day allowed</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" className="accent-primary w-4 h-4" checked={form.after_probation_only}
                    onChange={(e) => setForm((p: any) => ({ ...p, after_probation_only: e.target.checked }))} />
                  <span className="text-sm text-foreground">Only after probation ends</span>
                </label>
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input type="checkbox" className="accent-primary w-4 h-4 mt-0.5" checked={form.count_sandwich_days}
                    onChange={(e) => setForm((p: any) => ({ ...p, count_sandwich_days: e.target.checked }))} />
                  <span className="text-sm text-foreground">Count holidays/weekly-offs in between (sandwich)
                    <span className="block text-xs text-secondary">Off by default. On = off-days between leave dates also count as leave.</span></span>
                </label>
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1">Cannot be clubbed with</label>
                  <div className="border border-border rounded-lg p-2 max-h-32 overflow-y-auto space-y-0.5">
                    {types.filter((o: any) => editing === 'new' || o.id !== (editing as any).id).length === 0 ? (
                      <p className="text-xs text-secondary px-1 py-0.5">No other leave types.</p>
                    ) : types.filter((o: any) => editing === 'new' || o.id !== (editing as any).id).map((o: any) => (
                      <label key={o.id} className="flex items-center gap-2 px-1 py-0.5 cursor-pointer text-sm">
                        <input type="checkbox" className="accent-primary w-4 h-4" checked={form.cannot_club_with.includes(o.id)}
                          onChange={(e) => setForm((p: any) => ({ ...p, cannot_club_with: e.target.checked ? [...p.cannot_club_with, o.id] : p.cannot_club_with.filter((x: number) => x !== o.id) }))} />
                        <span className="text-foreground">{o.name}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-secondary mt-1">Symmetric — the other type will also block this one.</p>
                </div>
              </div>
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

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete leave type?"
        danger
        confirmLabel="Delete"
        message={confirmDelete ? <>This permanently removes <span className="font-medium text-foreground">{confirmDelete.name}</span>. A type that has any leave requests, allocations or encashments can&apos;t be deleted — deactivate it instead.</> : undefined}
        loading={deleteMutation.isPending}
        onConfirm={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
        onCancel={() => setConfirmDelete(null)}
      />
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
              <input className={inputCls} value={form.name} onChange={(e) => setForm((p: any) => ({ ...p, name: e.target.value }))} placeholder="e.g. 2027-2028" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Start<span className="text-red-600"> *</span></label>
                <input type="date" className={inputCls} value={form.start_date} onChange={(e) => setForm((p: any) => ({ ...p, start_date: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">End<span className="text-red-600"> *</span></label>
                <input type="date" className={inputCls} value={form.end_date} min={form.start_date} onChange={(e) => setForm((p: any) => ({ ...p, end_date: e.target.value }))} />
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

