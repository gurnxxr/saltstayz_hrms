'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import Breadcrumb from '@/components/ui/Breadcrumb';
import LoadError from '@/components/ui/LoadError';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Pagination, { pageSlice } from '@/components/ui/Pagination';
import { Plus, Pencil, X, Loader2, Save, CalendarRange, Trash2, Layers, Users, Tag, Search, Ban, Star, AlertTriangle } from 'lucide-react';
import OffDayPicker, { type OffDay } from '@/components/shifts/OffDayPicker';

const inputCls = 'w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';
const EMP_PAGE_SIZE = 20;

// Leave Types is a catalog: name, active flag, and which departments a type applies to.
// Every per-type RULE (days, paid/unpaid, encashable, limits, clubbing) now lives on a
// template row and is edited under the Templates tab — see the note in the editor below.
const BLANK_LT_FORM = {
  name: '', default_days: '', is_active: true,
  departments: [] as number[],
};

export default function LeaveControlPanelPage() {
  const [tab, setTab] = useState<'templates' | 'employees' | 'types' | 'periods'>('templates');
  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <Breadcrumb className="mb-2" items={[{ label: 'Leaves' }, { label: 'Control Panel' }]} />
          <h1 className="text-2xl font-bold text-foreground">Leave Control Panel</h1>
          <p className="text-secondary mt-1">Build leave templates, assign them to employees, and manage the type catalog & periods.</p>
        </div>
        <div className="flex gap-1 border-b border-border flex-wrap">
          <TabBtn active={tab === 'templates'} onClick={() => setTab('templates')} icon={Layers} label="Templates" />
          <TabBtn active={tab === 'employees'} onClick={() => setTab('employees')} icon={Users} label="By Employee" />
          <TabBtn active={tab === 'types'} onClick={() => setTab('types')} icon={Tag} label="Leave Types" />
          <TabBtn active={tab === 'periods'} onClick={() => setTab('periods')} icon={CalendarRange} label="Leave Periods" />
        </div>
        {tab === 'templates' && <TemplatesPanel />}
        {tab === 'employees' && <ByEmployeePanel />}
        {tab === 'types' && <LeaveTypesCard />}
        {tab === 'periods' && <LeavePeriodsCard />}
      </div>
    </AppShell>
  );
}

function TabBtn({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: React.ElementType; label: string }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${active ? 'border-primary text-primary' : 'border-transparent text-secondary hover:text-foreground'}`}>
      <Icon size={15} /> {label}
    </button>
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

  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: () => api.get('/admin/departments').then(r => r.data),
  });

  const openNew = () => { setForm(BLANK_LT_FORM); setEditing('new'); };
  const openEdit = (t: any) => {
    setForm({
      name: t.name, default_days: String(t.default_days), is_active: !!t.is_active,
      departments: Array.isArray(t.departments) ? t.departments : [],
    });
    setEditing(t);
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      // Catalog fields only. On CREATE, default_days seeds the type's starting row on the
      // Default template (server-side); rules are refined per template afterwards. On EDIT we
      // send only what still takes effect live — name, active, and department applicability.
      const payload = editing === 'new'
        ? { name: form.name.trim(), default_days: Number(form.default_days), departments: form.departments }
        : { name: form.name.trim(), is_active: form.is_active, departments: form.departments };
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
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {types.map((t: any) => (
                <tr key={t.id} className="hover:bg-muted/20">
                  <td className="px-4 py-2.5 font-medium text-foreground">{t.name}</td>
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
              <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-800">
                A leave type is just a name and where it applies. Paid/unpaid, encashable, per-request
                limits and clubbing are set <span className="font-medium">per template</span> under the
                Templates tab — so different employees can get different rules for the same type.
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Name<span className="text-red-600"> *</span></label>
                <input className={inputCls} value={form.name} onChange={(e) => setForm((p: any) => ({ ...p, name: e.target.value }))} placeholder="e.g. Casual Leave" />
              </div>
              {editing === 'new' && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Starting days per year<span className="text-red-600"> *</span></label>
                  <input type="number" min={0} className={inputCls} value={form.default_days}
                    onChange={(e) => setForm((p: any) => ({ ...p, default_days: e.target.value }))} />
                  <p className="text-xs text-secondary mt-1">Seeds this type on the Default template. Adjust it — and every other rule — under Templates.</p>
                </div>
              )}
              {editing !== 'new' && (
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input type="checkbox" className="accent-primary w-4 h-4 mt-0.5" checked={form.is_active}
                    onChange={(e) => setForm((p: any) => ({ ...p, is_active: e.target.checked }))} />
                  <span className="text-sm text-foreground">Active <span className="block text-xs text-secondary">Inactive types are hidden from balances and can&apos;t be applied for.</span></span>
                </label>
              )}
              <div>
                <label className="block text-xs font-medium text-secondary mb-1">Applies to departments</label>
                <div className="border border-border rounded-lg p-2 max-h-32 overflow-y-auto space-y-0.5">
                  {departments.length === 0 ? (
                    <p className="text-xs text-secondary px-1 py-0.5">No departments configured.</p>
                  ) : departments.map((d: any) => (
                    <label key={d.id} className="flex items-center gap-2 px-1 py-0.5 cursor-pointer text-sm">
                      <input type="checkbox" className="accent-primary w-4 h-4" checked={form.departments.includes(d.id)}
                        onChange={(e) => setForm((p: any) => ({ ...p, departments: e.target.checked ? [...p.departments, d.id] : p.departments.filter((x: number) => x !== d.id) }))} />
                      <span className="text-foreground">{d.name}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-secondary mt-1">Leave all unticked to make this type available to every department.</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
              <button onClick={() => setEditing(null)} className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors">Cancel</button>
              <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !form.name.trim() || (editing === 'new' && form.default_days === '')}
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

// ─── Templates ───

interface TRow {
  leave_type_id: number; leave_type_name: string;
  default_days: number | string; is_paid: boolean; is_encashable: boolean;
  min_days_per_request: number | string | null; max_days_per_request: number | string | null;
  advance_notice_days: number | string | null; document_required_after_days: number | string | null;
  half_day_allowed: boolean; after_probation_only: boolean; count_sandwich_days: boolean;
  eligibility: string; cannot_club_with: number[];
}
type TForm = {
  name: string; is_active: boolean; rows: TRow[]; off_day_rules: OffDay[]; department_ids: number[];
};
const BLANK_TEMPLATE: TForm = { name: '', is_active: true, rows: [], off_day_rules: [], department_ids: [] };

function TemplatesPanel() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | 'new' | null>(null);
  const [form, setForm] = useState<TForm>(BLANK_TEMPLATE);
  const [confirmDel, setConfirmDel] = useState<any | null>(null);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['leave-templates'], queryFn: () => api.get('/leave/templates').then(r => r.data),
  });
  const { data: leaveTypes = [] } = useQuery({
    queryKey: ['leave-types-all'], queryFn: () => api.get('/leave/types/all').then(r => r.data),
  });
  // Departments + headcount + which template already claims each.
  const { data: deptCoverage = [] } = useQuery({
    queryKey: ['leave-template-departments'],
    queryFn: () => api.get('/leave/templates/departments').then(r => r.data),
  });
  const { data: detail } = useQuery({
    queryKey: ['leave-template', selectedId],
    queryFn: () => api.get(`/leave/templates/${selectedId}`).then(r => r.data),
    enabled: typeof selectedId === 'number',
  });

  useEffect(() => {
    if (selectedId === 'new') { setForm(BLANK_TEMPLATE); return; }
    if (detail) setForm({
      name: detail.name, is_active: detail.is_active, rows: detail.rows.map((r: any) => ({ ...r })),
      off_day_rules: detail.off_day_rules ?? [],
      department_ids: detail.department_ids ?? [],
    });
  }, [detail, selectedId]);

  const selected = typeof selectedId === 'number' ? templates.find((t: any) => t.id === selectedId) : null;
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['leave-templates'] });
    queryClient.invalidateQueries({ queryKey: ['leave-template'] });
    queryClient.invalidateQueries({ queryKey: ['leave-assignments'] });
    // A save can move people between plans, so the coverage map and the By Employee tab are both stale.
    queryClient.invalidateQueries({ queryKey: ['leave-template-departments'] });
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const norm = (v: any) => (v === '' || v === null || v === undefined ? null : Number(v));
      const payload = {
        name: form.name.trim(), is_active: form.is_active, off_day_rules: form.off_day_rules,
        department_ids: form.department_ids,
        rows: form.rows.map((r) => ({
          leave_type_id: r.leave_type_id, default_days: Number(r.default_days) || 0,
          is_paid: r.is_paid, is_encashable: r.is_encashable,
          min_days_per_request: norm(r.min_days_per_request), max_days_per_request: norm(r.max_days_per_request),
          advance_notice_days: norm(r.advance_notice_days), document_required_after_days: norm(r.document_required_after_days),
          half_day_allowed: r.half_day_allowed, after_probation_only: r.after_probation_only,
          count_sandwich_days: r.count_sandwich_days, eligibility: r.eligibility, cannot_club_with: r.cannot_club_with,
        })),
      };
      return selectedId === 'new' ? api.post('/leave/templates', payload) : api.put(`/leave/templates/${selectedId}`, payload);
    },
    onSuccess: (res) => {
      invalidate();
      // Report the people actually MOVED, not the size of the departments — "22 employees" when
      // 21 were already on the plan reads as though the save did far more than it did.
      const moved = Number(res.data?.employees_moved ?? 0);
      const base = selectedId === 'new' ? 'Template created' : 'Template saved';
      toast.success(moved > 0 ? `${base} — ${moved} employee${moved === 1 ? '' : 's'} moved onto this plan` : base);
      if (selectedId === 'new' && res.data?.id) setSelectedId(res.data.id);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/leave/templates/${id}`),
    onSuccess: () => { invalidate(); toast.success('Template deleted'); setConfirmDel(null); setSelectedId(null); },
    onError: (e: any) => { toast.error(e.response?.data?.error || 'Failed to delete'); setConfirmDel(null); },
  });

  const usedIds = new Set(form.rows.map((r) => r.leave_type_id));
  const addableTypes = leaveTypes.filter((t: any) => t.is_active && !usedIds.has(t.id));
  const addRow = (ltId: number) => {
    const lt = leaveTypes.find((t: any) => t.id === ltId); if (!lt) return;
    setForm((p) => ({ ...p, rows: [...p.rows, {
      leave_type_id: lt.id, leave_type_name: lt.name, default_days: lt.default_days ?? 0, is_paid: !!lt.is_paid,
      is_encashable: false, min_days_per_request: '', max_days_per_request: '', advance_notice_days: '',
      document_required_after_days: '', half_day_allowed: true, after_probation_only: false, count_sandwich_days: false,
      eligibility: lt.eligibility ?? 'any', cannot_club_with: [],
    }] }));
  };
  const removeRow = (ltId: number) => setForm((p) => ({ ...p, rows: p.rows.filter((r) => r.leave_type_id !== ltId) }));
  const setRow = (ltId: number, patch: Partial<TRow>) => setForm((p) => ({ ...p, rows: p.rows.map((r) => (r.leave_type_id === ltId ? { ...r, ...patch } : r)) }));
  const canSave = !!form.name.trim() && form.rows.length > 0 && !saveMutation.isPending;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5 items-start">
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="p-3 border-b border-border">
          <button onClick={() => setSelectedId('new')} className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
            <Plus size={15} /> New Template
          </button>
        </div>
        <div className="max-h-[600px] overflow-y-auto divide-y divide-border">
          {isLoading ? <div className="p-3 space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-11 bg-muted rounded animate-pulse" />)}</div>
            : templates.map((t: any) => (
              <button key={t.id} onClick={() => setSelectedId(t.id)} className={`w-full text-left px-4 py-2.5 transition-colors ${selectedId === t.id ? 'bg-primary/5' : 'hover:bg-muted/40'}`}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground truncate flex-1">{t.name}</span>
                  {t.is_default && <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700"><Star size={10} /> Default</span>}
                  {!t.is_active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-secondary">Inactive</span>}
                </div>
                <p className="text-[11px] text-secondary mt-0.5">{t.row_count} leave type{t.row_count === 1 ? '' : 's'} · {t.employee_count} employee{t.employee_count === 1 ? '' : 's'}</p>
                {t.departments?.length > 0 && (
                  <p className="text-[11px] text-primary mt-0.5 truncate" title={t.departments.map((d: any) => d.name).join(', ')}>
                    {t.departments.map((d: any) => d.name).join(', ')}
                  </p>
                )}
              </button>
            ))}
        </div>
      </div>

      {selectedId === null ? (
        <div className="bg-card rounded-xl border border-border flex flex-col items-center justify-center py-20 text-secondary">
          <Layers size={40} className="opacity-30 mb-3" />
          <p className="text-sm">Select a template, or create one</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-card rounded-xl border border-border p-5 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-lg font-semibold text-foreground">
                {selectedId === 'new' ? 'New Template' : `Edit — ${selected?.name ?? ''}`}
                {selected?.is_default && <span className="ml-2 text-xs font-normal text-blue-700">(Default)</span>}
              </h2>
              <div className="flex items-center gap-2">
                {typeof selectedId === 'number' && !selected?.is_default && (
                  <button onClick={() => setConfirmDel(selected)} className="p-2 rounded-lg text-secondary hover:text-red-600 hover:bg-red-50 transition-colors" title="Delete"><Trash2 size={16} /></button>
                )}
                <button onClick={() => saveMutation.mutate()} disabled={!canSave} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                  {saveMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-secondary mb-1">Template name<span className="text-red-600"> *</span></label>
                <input className={inputCls} value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Front Office Plan" />
              </div>
              <label className={`flex items-center gap-2 mt-6 select-none ${selected?.is_default ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                <input type="checkbox" checked={selected?.is_default ? true : form.is_active} disabled={selected?.is_default}
                  onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))} className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-primary/50" />
                <span className="text-sm text-foreground">Active {selected?.is_default && <span className="text-xs text-secondary">(the Default plan is always active)</span>}</span>
              </label>
            </div>

            {/* Department governance — the bulk lever. Everything else on this screen is edited
                once and applies to whoever happens to be on the plan; this decides WHO is on it. */}
            <div className="border-t border-border pt-4">
              <label className="block text-xs font-medium text-secondary mb-1">Applies to departments</label>
              <p className="text-xs text-secondary mb-3">
                Everyone in a selected department moves onto this plan when you save, and anyone hired
                into it afterwards starts on it. A department can only be on one plan.
              </p>
              <DepartmentPicker
                coverage={deptCoverage}
                selected={form.department_ids}
                currentTemplateId={typeof selectedId === 'number' ? selectedId : null}
                onChange={(ids) => setForm((p) => ({ ...p, department_ids: ids }))}
              />
            </div>

            {/* The work week. This is what decides whether a day was one the person was SCHEDULED
                to work — and therefore whether an unevidenced day costs them anything. It lives on
                the leave template because that is where the business decides it. */}
            <div className="border-t border-border pt-4">
              <label className="block text-xs font-medium text-secondary mb-1">Weekly off</label>
              <p className="text-xs text-secondary mb-3">
                The days employees on this plan are not scheduled to work. A missing punch on one of
                these costs them nothing — they were never rostered. Leave it unset and they fall back
                to the Default plan&apos;s week.
              </p>
              <OffDayPicker
                value={form.off_day_rules}
                onChange={(v) => setForm((p) => ({ ...p, off_day_rules: v }))}
                emptyHint="No weekly off set — employees on this plan fall back to the Default plan, then the company work week."
                preview
              />
            </div>
          </div>

          {form.rows.length === 0 ? (
            <div className="bg-card rounded-xl border border-border p-6 text-center text-sm text-secondary">No leave types yet — add one below. A type left out means employees on this template don&apos;t get that leave.</div>
          ) : form.rows.map((r) => (
            <TemplateRowEditor key={r.leave_type_id} row={r} allRows={form.rows} onChange={(patch) => setRow(r.leave_type_id, patch)} onRemove={() => removeRow(r.leave_type_id)} />
          ))}

          {addableTypes.length > 0 && (
            <div className="bg-card rounded-xl border border-dashed border-border p-4 flex items-center gap-3 flex-wrap">
              <span className="text-sm text-secondary">Add leave type:</span>
              <select className={`${inputCls} max-w-xs`} value="" onChange={(e) => { if (e.target.value) addRow(Number(e.target.value)); }}>
                <option value="">Choose…</option>
                {addableTypes.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog open={!!confirmDel} title="Delete template?" danger confirmLabel="Delete"
        message={confirmDel ? <>Permanently delete <span className="font-medium text-foreground">{confirmDel.name}</span>? Employees on it must be reassigned first.</> : undefined}
        loading={deleteMutation.isPending} onConfirm={() => confirmDel && deleteMutation.mutate(confirmDel.id)} onCancel={() => setConfirmDel(null)} />
    </div>
  );
}

/**
 * Pick the departments this leave plan governs.
 *
 * Every department is shown, including those already on another plan — hiding them would leave
 * the admin wondering why a department they can see in Organisation is missing here. A claimed
 * one is disabled and says which plan holds it, so the answer to "why can't I pick Housekeeping"
 * is on the chip itself rather than in an error after a failed save.
 */
function DepartmentPicker({ coverage, selected, currentTemplateId, onChange }: {
  coverage: any[];
  selected: number[];
  currentTemplateId: number | null;
  onChange: (ids: number[]) => void;
}) {
  const isOn = (id: number) => selected.includes(id);
  const toggle = (id: number) => onChange(isOn(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  // Headcount of what is ticked right now, so the cost of Save is visible before pressing it.
  const reach = coverage
    .filter((d: any) => isOn(d.id))
    .reduce((sum: number, d: any) => sum + Number(d.employee_count || 0), 0);

  if (!coverage.length) {
    return <p className="text-xs text-secondary">No departments configured yet — add them under Admin → Organisation.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {coverage.map((d: any) => {
          const on = isOn(d.id);
          // "Taken" means another template holds it. A department this template already governs
          // comes back with template_id === currentTemplateId and must stay untickable-off-able.
          const takenBy = d.template_id != null && d.template_id !== currentTemplateId ? d.template_name : null;
          return (
            <button
              key={d.id}
              type="button"
              disabled={!!takenBy}
              onClick={() => toggle(d.id)}
              title={takenBy ? `Already on the "${takenBy}" plan — remove it there first` : undefined}
              className={`px-3 py-1.5 rounded-lg border text-sm transition-colors text-left ${
                takenBy
                  ? 'border-border bg-muted/50 text-secondary cursor-not-allowed'
                  : on
                    ? 'border-primary bg-primary/5 text-foreground'
                    : 'border-border hover:bg-muted'
              }`}
            >
              <span className="font-medium">{d.name}</span>
              <span className="text-xs text-secondary ml-1.5">
                {d.employee_count} {d.employee_count === 1 ? 'person' : 'people'}
              </span>
              {takenBy && <span className="block text-[11px] text-amber-700 mt-0.5">on {takenBy}</span>}
            </button>
          );
        })}
      </div>

      {selected.length > 0 ? (
        <p className="text-xs text-secondary">
          <b className="text-foreground">{reach}</b> {reach === 1 ? 'person is' : 'people are'} in the{' '}
          {selected.length} selected department{selected.length === 1 ? '' : 's'}. Saving moves anyone not
          already on this plan onto it — which changes the leave they get.
        </p>
      ) : (
        <p className="text-xs text-secondary">
          No departments selected — this plan applies only to people assigned individually on the
          By Employee tab.
        </p>
      )}
      <p className="text-xs text-secondary">
        Unticking a department later stops NEW hires landing here, but leaves the people already
        moved on this plan. Move them back from the By Employee tab if that is what you meant.
      </p>
    </div>
  );
}

function TemplateRowEditor({ row, allRows, onChange, onRemove }: { row: TRow; allRows: TRow[]; onChange: (p: Partial<TRow>) => void; onRemove: () => void }) {
  const others = allRows.filter((r) => r.leave_type_id !== row.leave_type_id);
  const numField = (k: keyof TRow, label: string) => (
    <div>
      <label className="block text-xs font-medium text-secondary mb-1">{label}</label>
      <input type="number" min={0} className={inputCls} value={(row[k] as any) ?? ''}
        onChange={(e) => onChange({ [k]: e.target.value === '' ? '' : Number(e.target.value) } as any)} />
    </div>
  );
  const chk = (k: keyof TRow, label: string) => (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <input type="checkbox" checked={!!row[k]} onChange={(e) => onChange({ [k]: e.target.checked } as any)} className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-primary/50" />
      <span className="text-sm text-foreground">{label}</span>
    </label>
  );
  return (
    <div className="bg-card rounded-xl border border-border p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><Tag size={14} className="text-primary" /> {row.leave_type_name}</h3>
        <button onClick={onRemove} className="p-1.5 rounded-lg text-secondary hover:text-red-600 hover:bg-red-50 transition-colors" title="Remove from template"><X size={15} /></button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {numField('default_days', 'Days / year')}
        {numField('min_days_per_request', 'Min / request')}
        {numField('max_days_per_request', 'Max / request')}
        {numField('advance_notice_days', 'Notice (days)')}
        {numField('document_required_after_days', 'Document after (days)')}
        <div>
          <label className="block text-xs font-medium text-secondary mb-1">Eligibility</label>
          <select className={inputCls} value={row.eligibility} onChange={(e) => onChange({ eligibility: e.target.value })}>
            <option value="any">Anyone</option>
            <option value="female">Female only</option>
            <option value="male">Male only</option>
          </select>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {chk('is_paid', 'Paid')}
        {chk('is_encashable', 'Encashable')}
        {chk('half_day_allowed', 'Half-day allowed')}
        {chk('after_probation_only', 'After probation only')}
        {chk('count_sandwich_days', 'Count sandwich days')}
      </div>
      {others.length > 0 && (
        <div>
          <label className="block text-xs font-medium text-secondary mb-1">Cannot be clubbed with</label>
          <div className="flex flex-wrap gap-2">
            {others.map((o) => {
              const on = row.cannot_club_with.includes(o.leave_type_id);
              return (
                <button key={o.leave_type_id} type="button"
                  onClick={() => onChange({ cannot_club_with: on ? row.cannot_club_with.filter((x) => x !== o.leave_type_id) : [...row.cannot_club_with, o.leave_type_id] })}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${on ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-border text-secondary hover:bg-muted'}`}>
                  {on && <Ban size={11} />} {o.leave_type_name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── By Employee ───

function ByEmployeePanel() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkTemplate, setBulkTemplate] = useState('');
  const [page, setPage] = useState(1);

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ['leave-assignments'], queryFn: () => api.get('/leave/templates/assignments').then(r => r.data),
  });
  const { data: templates = [] } = useQuery({
    queryKey: ['leave-templates'], queryFn: () => api.get('/leave/templates').then(r => r.data),
  });
  const activeTemplates = templates.filter((t: any) => t.is_active);
  // Reassigning changes each template's employee_count too, so refresh the Templates tab as well.
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['leave-assignments'] });
    queryClient.invalidateQueries({ queryKey: ['leave-templates'] });
  };

  const setOneMutation = useMutation({
    mutationFn: ({ employeeId, templateId }: { employeeId: number; templateId: number }) => api.put(`/leave/employees/${employeeId}/template`, { template_id: templateId }),
    onSuccess: () => { invalidate(); toast.success('Template updated'); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to update'),
  });
  const bulkMutation = useMutation({
    mutationFn: () => api.post('/leave/templates/assign', { employee_ids: [...selected], template_id: Number(bulkTemplate) }),
    onSuccess: (res) => { invalidate(); toast.success(`${res.data.assigned} employee(s) reassigned`); setSelected(new Set()); setBulkTemplate(''); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to assign'),
  });

  const filtered = employees.filter((e: any) => {
    const q = search.toLowerCase();
    return !q || `${e.first_name} ${e.last_name}`.toLowerCase().includes(q) || e.employee_code?.toLowerCase().includes(q) || e.designation?.toLowerCase().includes(q);
  });

  // Client-side pagination over the filtered rows. `paged` is what the table renders;
  // `selected` persists across pages so a bulk reassignment can span several of them.
  const totalPages = Math.max(1, Math.ceil(filtered.length / EMP_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages); // clamp when the filtered set shrinks past the current page
  const paged = pageSlice(filtered, currentPage, EMP_PAGE_SIZE);
  useEffect(() => { setPage(1); }, [search]); // a new search starts at page 1

  const toggle = (id: number) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // Header checkbox acts on the current page only, matching what's on screen.
  const allVisibleSelected = paged.length > 0 && paged.every((e: any) => selected.has(e.id));
  const toggleAllVisible = (checked: boolean) => setSelected((p) => {
    const n = new Set(p);
    paged.forEach((e: any) => (checked ? n.add(e.id) : n.delete(e.id)));
    return n;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee, code, designation…"
            className="w-full pl-9 pr-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
        </div>
        {selected.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-secondary">{selected.size} selected →</span>
            <select className="px-3 py-2 border border-border rounded-lg bg-background text-sm" value={bulkTemplate} onChange={(e) => setBulkTemplate(e.target.value)}>
              <option value="">Assign to…</option>
              {activeTemplates.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button onClick={() => bulkMutation.mutate()} disabled={!bulkTemplate || bulkMutation.isPending} className="px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">Apply</button>
          </div>
        )}
      </div>
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs font-semibold text-secondary uppercase tracking-wide">
                <th className="px-4 py-3 w-8"><input type="checkbox" checked={allVisibleSelected} onChange={(e) => toggleAllVisible(e.target.checked)} className="h-4 w-4 rounded border-border text-primary" /></th>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Designation</th>
                <th className="px-4 py-3">Property</th>
                <th className="px-4 py-3">Leave template</th>
                <th className="px-4 py-3">Weekly off</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? <tr><td colSpan={6} className="p-6 text-center text-secondary">Loading…</td></tr>
                : filtered.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-secondary">No employees.</td></tr>
                : paged.map((e: any) => (
                  <tr key={e.id} className="hover:bg-muted/30">
                    <td className="px-4 py-2.5"><input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} className="h-4 w-4 rounded border-border text-primary" /></td>
                    <td className="px-4 py-2.5"><span className="font-medium text-foreground">{e.first_name} {e.last_name}</span><span className="block text-[11px] text-secondary">{e.employee_code}</span></td>
                    <td className="px-4 py-2.5 text-secondary">{e.designation || '—'}</td>
                    <td className="px-4 py-2.5 text-secondary">{e.branch_name || '—'}</td>
                    <td className="px-4 py-2.5">
                      <select className="px-2.5 py-1.5 border border-border rounded-lg bg-background text-sm" value={e.leave_template_id ?? ''} disabled={setOneMutation.isPending}
                        onChange={(ev) => setOneMutation.mutate({ employeeId: e.id, templateId: Number(ev.target.value) })}>
                        {/* If they sit on a now-inactive template, keep it visible & selected so a stray
                            pick can't silently move them — it just isn't offered to others. */}
                        {e.leave_template_id != null && !activeTemplates.some((t: any) => t.id === e.leave_template_id) && (
                          <option value={e.leave_template_id}>{e.template_name} (inactive)</option>
                        )}
                        {activeTemplates.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </td>
                    {/* The days this person is NOT scheduled to work — resolved exactly as payroll
                        resolves it, so this column and their pay can never disagree. "Not set"
                        is deliberately not blank: an unconfigured work week is the thing that
                        made an unevidenced Sunday cost somebody a day's pay. */}
                    <td className="px-4 py-2.5">
                      {e.off_days === 'Not set'
                        ? <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700"><AlertTriangle size={11} /> Not set</span>
                        : <span className="text-secondary whitespace-nowrap">{e.off_days}</span>}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {!isLoading && (
          <Pagination
            total={filtered.length}
            page={currentPage}
            pageSize={EMP_PAGE_SIZE}
            shown={paged.length}
            itemLabel="employees"
            onPageChange={setPage}
          />
        )}
      </div>
    </div>
  );
}

