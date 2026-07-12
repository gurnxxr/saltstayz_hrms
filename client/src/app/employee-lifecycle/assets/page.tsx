'use client';

import { useState, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import Breadcrumb from '@/components/ui/Breadcrumb';
import LoadError from '@/components/ui/LoadError';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useAuth } from '@/lib/auth';
import {
  Plus, Package, X, Loader2, RotateCcw, Trash2, Pencil, Boxes, Search, Upload, History,
} from 'lucide-react';

const inputCls = 'w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';
const todayStr = () => new Date().toISOString().slice(0, 10);
const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

const STATUS_STYLE: Record<string, string> = {
  assigned: 'bg-amber-100 text-amber-700',
  returned: 'bg-green-100 text-green-700',
  lost: 'bg-red-100 text-red-700',
};

export default function CompanyAssetsPage() {
  const { user } = useAuth();
  const isAdmin = user?.roleName === 'admin';
  const [tab, setTab] = useState<'register' | 'history' | 'catalog'>('register');

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <Breadcrumb className="mb-2" items={[{ label: 'Employee Lifecycle' }, { label: 'Company Assets' }]} />
          <h1 className="text-2xl font-bold text-foreground">Company Assets</h1>
          <p className="text-secondary mt-1">Track company property issued to employees — laptops, uniforms, access cards — and collect it back at exit.</p>
        </div>

        <div className="flex gap-1 border-b border-border">
          <TabBtn active={tab === 'register'} onClick={() => setTab('register')} icon={Package} label="Asset Register" />
          <TabBtn active={tab === 'history'} onClick={() => setTab('history')} icon={History} label="History" />
          {isAdmin && <TabBtn active={tab === 'catalog'} onClick={() => setTab('catalog')} icon={Boxes} label="Item Catalog" />}
        </div>

        {tab === 'register' ? <RegisterTab isAdmin={isAdmin} /> : tab === 'history' ? <HistoryTab isAdmin={isAdmin} /> : <CatalogTab />}
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

// ─────────────────────────────── Register ───────────────────────────────

function RegisterTab({ isAdmin }: { isAdmin: boolean }) {
  const [search, setSearch] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [returning, setReturning] = useState<any | null>(null);
  const [deleting, setDeleting] = useState<any | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const queryClient = useQueryClient();

  // Active register = currently-assigned items only; returned/lost live in the History tab.
  const { data: rows = [], isError, refetch } = useQuery({
    queryKey: ['asset-assignments', 'assigned'],
    queryFn: () => api.get('/employee-lifecycle/assets/assignments?status=assigned').then(r => r.data),
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return rows;
    return rows.filter((r: any) =>
      `${r.first_name} ${r.last_name}`.toLowerCase().includes(q) ||
      r.employee_code?.toLowerCase().includes(q) ||
      r.asset_name?.toLowerCase().includes(q) ||
      r.identifier?.toLowerCase().includes(q));
  }, [rows, search]);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/employee-lifecycle/assets/assignments/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-assignments'] });
      toast.success('Assignment removed');
      setDeleting(null);
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to remove'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
          <input className={`${inputCls} pl-9 w-64`} placeholder="Search employee, item, serial…"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowUpload(true)}
            className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors">
            <Upload size={16} /> Upload Assets
          </button>
          <button onClick={() => setAssigning(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
            <Plus size={16} /> Assign Asset
          </button>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {isError ? (
          <LoadError message="Couldn't load the asset register." onRetry={() => refetch()} />
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-secondary">
            <Package size={32} className="mx-auto mb-2 opacity-40" />
            <p className="text-sm font-medium text-foreground">No asset assignments yet</p>
            <p className="text-xs mt-1">Use “Assign Asset” to issue a laptop, uniform, or access card to an employee.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-secondary">
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Item</th>
                  <th className="px-4 py-3 font-medium">Serial / Tag</th>
                  <th className="px-4 py-3 font-medium">Assigned</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Returned</th>
                  <th className="px-4 py-3 font-medium text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((r: any) => (
                  <tr key={r.id} className="hover:bg-muted/20">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-foreground">{r.first_name} {r.last_name}</p>
                      <p className="text-xs text-secondary">{r.employee_code} · {r.branch_name || '—'}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="text-foreground">{r.asset_name}</p>
                      <p className="text-xs text-secondary">{r.asset_category}</p>
                    </td>
                    <td className="px-4 py-2.5 text-secondary">{r.identifier || '—'}</td>
                    <td className="px-4 py-2.5">
                      <p className="text-secondary">{fmt(r.assigned_date)}</p>
                      {r.assigned_by_email && <p className="text-xs text-secondary/70">by {r.assigned_by_email}</p>}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[r.status] || 'bg-muted text-secondary'}`}>{r.status}</span>
                    </td>
                    <td className="px-4 py-2.5 text-secondary">{r.status === 'assigned' ? '—' : fmt(r.returned_date)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        {r.status === 'assigned' && (
                          <>
                            <button onClick={() => setReturning(r)} title="Mark returned / lost"
                              className="flex items-center gap-1 px-2.5 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 transition-colors">
                              <RotateCcw size={13} /> Return
                            </button>
                            <button onClick={() => setEditing(r)} title="Edit"
                              className="p-1.5 rounded-lg text-secondary hover:text-foreground hover:bg-muted transition-colors">
                              <Pencil size={14} />
                            </button>
                          </>
                        )}
                        {isAdmin && (
                          <button onClick={() => setDeleting(r)} title="Delete record"
                            className="p-1.5 rounded-lg text-secondary hover:text-red-600 hover:bg-red-50 transition-colors">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {assigning && <AssignDialog onClose={() => setAssigning(false)} />}
      {editing && <AssignDialog existing={editing} onClose={() => setEditing(null)} />}
      {returning && <ReturnDialog assignment={returning} onClose={() => setReturning(null)} />}
      {showUpload && <UploadDialog onClose={() => setShowUpload(false)} />}
      <ConfirmDialog
        open={!!deleting}
        title="Delete asset record?"
        message={deleting && <>This permanently removes the <strong>{deleting.asset_name}</strong> record for {deleting.first_name} {deleting.last_name}. Use “Return” instead to keep the history.</>}
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

// Bulk-import the assignment register from a CSV.
function UploadDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.post('/employee-lifecycle/assets/assignments/bulk-upload', fd).then(r => r.data);
    },
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ['asset-assignments'] });
      queryClient.invalidateQueries({ queryKey: ['asset-types'] });
      queryClient.invalidateQueries({ queryKey: ['asset-types-active'] });
      toast.success(`${data.created} asset row(s) added${data.skipped ? `, ${data.skipped} skipped` : ''}`);
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Upload failed'),
  });

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) { setResult(null); mutation.mutate(file); }
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card rounded-xl border border-border shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-base font-semibold text-foreground">Upload Assets</h3>
          <button onClick={onClose} className="p-1 rounded-lg text-secondary hover:text-foreground hover:bg-muted transition-colors"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-secondary">
            Import a CSV of assets assigned per employee. Columns:{' '}
            <span className="font-medium text-foreground">Employee Name, EmpCode, Property Name, Item, Serial/Tag, Assigned Date, Assigned By(Email), Status</span>.
            EmpCode and Item are required. A row with Status <span className="font-medium text-foreground">returned</span> or <span className="font-medium text-foreground">lost</span> lands in the History tab; an item not in the catalog is added automatically.
          </p>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={onFile} />
          <button onClick={() => fileRef.current?.click()} disabled={mutation.isPending}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {mutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {mutation.isPending ? 'Processing…' : 'Choose CSV file'}
          </button>
          {result && (
            <div className="rounded-lg border border-border p-3 text-sm space-y-2">
              <p className="font-medium text-foreground">{result.total} row(s) processed</p>
              <div className="flex flex-wrap gap-4 text-xs">
                <span className="text-green-600">{result.created} added</span>
                {result.skipped > 0 && <span className="text-amber-600">{result.skipped} skipped</span>}
              </div>
              {result.errors?.length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded bg-red-50 border border-red-200 p-2 space-y-0.5">
                  {result.errors.map((e: string, i: number) => <p key={i} className="text-xs text-red-700">{e}</p>)}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors">Done</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────── History ───────────────────────────────
// Returned & lost assets — the closed-out records, out of the active register.

function HistoryTab({ isAdmin }: { isAdmin: boolean }) {
  const [search, setSearch] = useState('');
  const [outcome, setOutcome] = useState(''); // '' = returned & lost
  const [deleting, setDeleting] = useState<any | null>(null);
  const queryClient = useQueryClient();

  const { data: rows = [], isError, refetch } = useQuery({
    queryKey: ['asset-assignments', 'history'],
    queryFn: () => api.get('/employee-lifecycle/assets/assignments').then(r => r.data),
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return rows.filter((r: any) =>
      r.status !== 'assigned' &&
      (!outcome || r.status === outcome) &&
      (!q ||
        `${r.first_name} ${r.last_name}`.toLowerCase().includes(q) ||
        r.employee_code?.toLowerCase().includes(q) ||
        r.asset_name?.toLowerCase().includes(q) ||
        r.identifier?.toLowerCase().includes(q)));
  }, [rows, search, outcome]);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/employee-lifecycle/assets/assignments/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['asset-assignments'] }); toast.success('Record removed'); setDeleting(null); },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to remove'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
          <input className={`${inputCls} pl-9 w-64`} placeholder="Search employee, item, serial…"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select value={outcome} onChange={(e) => setOutcome(e.target.value)}
          className="px-3 py-2 border border-border rounded-lg bg-background text-sm">
          <option value="">Returned & Lost</option>
          <option value="returned">Returned</option>
          <option value="lost">Lost</option>
        </select>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {isError ? (
          <LoadError message="Couldn't load asset history." onRetry={() => refetch()} />
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-secondary">
            <History size={32} className="mx-auto mb-2 opacity-40" />
            <p className="text-sm font-medium text-foreground">No returned assets yet</p>
            <p className="text-xs mt-1">Once an asset is returned or marked lost, it moves here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-secondary">
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Item</th>
                  <th className="px-4 py-3 font-medium">Serial / Tag</th>
                  <th className="px-4 py-3 font-medium">Assigned</th>
                  <th className="px-4 py-3 font-medium">Outcome</th>
                  <th className="px-4 py-3 font-medium">Returned</th>
                  {isAdmin && <th className="px-4 py-3 font-medium text-right"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((r: any) => (
                  <tr key={r.id} className="hover:bg-muted/20">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-foreground">{r.first_name} {r.last_name}</p>
                      <p className="text-xs text-secondary">{r.employee_code} · {r.branch_name || '—'}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="text-foreground">{r.asset_name}</p>
                      <p className="text-xs text-secondary">{r.asset_category}</p>
                    </td>
                    <td className="px-4 py-2.5 text-secondary">{r.identifier || '—'}</td>
                    <td className="px-4 py-2.5 text-secondary">{fmt(r.assigned_date)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[r.status] || 'bg-muted text-secondary'}`}>{r.status}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="text-secondary">{fmt(r.returned_date)}</p>
                      {r.returned_by_email && <p className="text-xs text-secondary/70">by {r.returned_by_email}</p>}
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end">
                          <button onClick={() => setDeleting(r)} title="Delete record"
                            className="p-1.5 rounded-lg text-secondary hover:text-red-600 hover:bg-red-50 transition-colors">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleting}
        title="Delete asset record?"
        message={deleting && <>This permanently removes the <strong>{deleting.asset_name}</strong> record for {deleting.first_name} {deleting.last_name}.</>}
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

// Assign (create) or edit an assignment — same form, POST vs PUT.
function AssignDialog({ existing, onClose }: { existing?: any; onClose: () => void }) {
  const queryClient = useQueryClient();
  const isEdit = !!existing;
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [form, setForm] = useState({
    employee_id: existing ? String(existing.employee_id) : '',
    asset_type_id: existing ? String(existing.asset_type_id) : '',
    identifier: existing?.identifier || '',
    assigned_date: existing?.assigned_date ? String(existing.assigned_date).slice(0, 10) : todayStr(),
    note: existing?.note || '',
  });

  const { data: employees = [] } = useQuery({
    queryKey: ['lifecycle-employees'],
    queryFn: () => api.get('/employee-lifecycle/employees').then(r => r.data),
    enabled: !isEdit,
  });
  const { data: types = [] } = useQuery({
    queryKey: ['asset-types-active'],
    queryFn: () => api.get('/employee-lifecycle/assets/types').then(r => r.data),
  });

  const filteredEmployees = useMemo(() => {
    const q = employeeSearch.toLowerCase();
    if (!q) return employees;
    return employees.filter((e: any) =>
      `${e.first_name} ${e.last_name}`.toLowerCase().includes(q) || e.employee_code?.toLowerCase().includes(q));
  }, [employees, employeeSearch]);

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        asset_type_id: Number(form.asset_type_id),
        identifier: form.identifier || undefined,
        assigned_date: form.assigned_date,
        note: form.note || undefined,
      };
      return isEdit
        ? api.put(`/employee-lifecycle/assets/assignments/${existing.id}`, payload)
        : api.post('/employee-lifecycle/assets/assignments', { ...payload, employee_id: Number(form.employee_id) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-assignments'] });
      toast.success(isEdit ? 'Assignment updated' : 'Asset assigned');
      onClose();
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to save'),
  });

  const canSubmit = form.asset_type_id && form.assigned_date && (isEdit || form.employee_id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card rounded-xl border border-border shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-base font-semibold text-foreground">{isEdit ? 'Edit Assignment' : 'Assign Asset'}</h3>
          <button onClick={onClose} className="p-1 rounded-lg text-secondary hover:text-foreground hover:bg-muted transition-colors"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          {isEdit ? (
            <div className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
              <span className="text-secondary">Employee: </span>
              <span className="font-medium text-foreground">{existing.first_name} {existing.last_name} ({existing.employee_code})</span>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Employee<span className="text-red-600"> *</span></label>
              <input className={`${inputCls} mb-1.5`} placeholder="Search name or code…"
                value={employeeSearch} onChange={(e) => setEmployeeSearch(e.target.value)} />
              <select className={inputCls} value={form.employee_id} size={5}
                onChange={(e) => setForm(p => ({ ...p, employee_id: e.target.value }))}>
                {filteredEmployees.map((e: any) => (
                  <option key={e.id} value={e.id}>{e.first_name} {e.last_name} ({e.employee_code}) · {e.branch_name || '—'}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Item<span className="text-red-600"> *</span></label>
            <select className={inputCls} value={form.asset_type_id}
              onChange={(e) => setForm(p => ({ ...p, asset_type_id: e.target.value }))}>
              <option value="">Select an item…</option>
              {types.map((t: any) => <option key={t.id} value={t.id}>{t.name} · {t.category}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Serial / Tag / Size</label>
              <input className={inputCls} value={form.identifier} placeholder="e.g. SN-4821, Size L"
                onChange={(e) => setForm(p => ({ ...p, identifier: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Assigned date<span className="text-red-600"> *</span></label>
              <input type="date" className={inputCls} value={form.assigned_date}
                onChange={(e) => setForm(p => ({ ...p, assigned_date: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Note</label>
            <textarea rows={2} className={`${inputCls} resize-none`} value={form.note}
              onChange={(e) => setForm(p => ({ ...p, note: e.target.value }))} placeholder="Optional" />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {mutation.isPending && <Loader2 size={14} className="animate-spin" />} {isEdit ? 'Save' : 'Assign'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReturnDialog({ assignment, onClose }: { assignment: any; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ status: 'returned', returned_date: todayStr(), condition_note: '' });

  const mutation = useMutation({
    mutationFn: () => api.put(`/employee-lifecycle/assets/assignments/${assignment.id}/return`, {
      status: form.status,
      returned_date: form.returned_date,
      condition_note: form.condition_note || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-assignments'] });
      queryClient.invalidateQueries({ queryKey: ['exit-interviews'] });
      toast.success(form.status === 'lost' ? 'Marked as lost' : 'Asset collected');
      onClose();
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to update'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card rounded-xl border border-border shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h3 className="text-base font-semibold text-foreground">Close Out Asset</h3>
            <p className="text-xs text-secondary mt-0.5">{assignment.asset_name}{assignment.identifier ? ` · ${assignment.identifier}` : ''} — {assignment.first_name} {assignment.last_name}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-secondary hover:text-foreground hover:bg-muted transition-colors"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Outcome</label>
              <select className={inputCls} value={form.status} onChange={(e) => setForm(p => ({ ...p, status: e.target.value }))}>
                <option value="returned">Returned (collected)</option>
                <option value="lost">Lost / not returned</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Date</label>
              <input type="date" className={inputCls} value={form.returned_date}
                onChange={(e) => setForm(p => ({ ...p, returned_date: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Condition note</label>
            <textarea rows={2} className={`${inputCls} resize-none`} value={form.condition_note}
              onChange={(e) => setForm(p => ({ ...p, condition_note: e.target.value }))} placeholder="e.g. Good condition / charger missing" />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors">
            {mutation.isPending && <Loader2 size={14} className="animate-spin" />} Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────── Catalog ───────────────────────────────

function CatalogTab() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<any | null>(null);
  const [adding, setAdding] = useState(false);

  const { data: types = [], isError, refetch } = useQuery({
    queryKey: ['asset-types', 'all'],
    queryFn: () => api.get('/employee-lifecycle/assets/types?all=1').then(r => r.data),
  });

  const toggleMutation = useMutation({
    mutationFn: (t: any) => api.put(`/employee-lifecycle/assets/types/${t.id}`, { is_active: !t.is_active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-types'] });
      queryClient.invalidateQueries({ queryKey: ['asset-types-active'] });
      toast.success('Catalog updated');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to update'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-secondary">The master list of issuable items. Deactivating an item hides it from new assignments but keeps existing records.</p>
        <button onClick={() => setAdding(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shrink-0">
          <Plus size={16} /> Add Item
        </button>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {isError ? (
          <LoadError message="Couldn't load the item catalog." onRetry={() => refetch()} />
        ) : types.length === 0 ? (
          <div className="p-10 text-center text-secondary">
            <Boxes size={32} className="mx-auto mb-2 opacity-40" />
            <p className="text-sm font-medium text-foreground">No items yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-secondary">
                  <th className="px-4 py-3 font-medium">Item</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {types.map((t: any) => (
                  <tr key={t.id} className="hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-medium text-foreground">{t.name}</td>
                    <td className="px-4 py-2.5 text-secondary">{t.category}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${t.is_active ? 'bg-green-100 text-green-700' : 'bg-muted text-secondary'}`}>
                        {t.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => setEditing(t)} className="p-1.5 rounded-lg text-secondary hover:text-foreground hover:bg-muted transition-colors" title="Edit"><Pencil size={14} /></button>
                        <button onClick={() => toggleMutation.mutate(t)}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-muted transition-colors">
                          {t.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {(adding || editing) && <TypeDialog existing={editing} onClose={() => { setAdding(false); setEditing(null); }} />}
    </div>
  );
}

function TypeDialog({ existing, onClose }: { existing?: any; onClose: () => void }) {
  const queryClient = useQueryClient();
  const isEdit = !!existing;
  const [form, setForm] = useState({ name: existing?.name || '', category: existing?.category || 'Other' });

  const { data: options } = useQuery({
    queryKey: ['lifecycle-options'],
    queryFn: () => api.get('/employee-lifecycle/options').then(r => r.data),
  });
  const categories: string[] = options?.asset_categories || ['IT Equipment', 'Uniform', 'Access & Keys', 'Vehicle', 'Finance', 'Other'];

  const mutation = useMutation({
    mutationFn: () => {
      const payload = { name: form.name, category: form.category };
      return isEdit
        ? api.put(`/employee-lifecycle/assets/types/${existing.id}`, payload)
        : api.post('/employee-lifecycle/assets/types', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-types'] });
      queryClient.invalidateQueries({ queryKey: ['asset-types-active'] });
      toast.success(isEdit ? 'Item updated' : 'Item added');
      onClose();
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to save'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card rounded-xl border border-border shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-base font-semibold text-foreground">{isEdit ? 'Edit Item' : 'Add Item'}</h3>
          <button onClick={onClose} className="p-1 rounded-lg text-secondary hover:text-foreground hover:bg-muted transition-colors"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Item name<span className="text-red-600"> *</span></label>
            <input className={inputCls} value={form.name} placeholder="e.g. Laptop"
              onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} autoFocus />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Category</label>
            <select className={inputCls} value={form.category} onChange={(e) => setForm(p => ({ ...p, category: e.target.value }))}>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={!form.name.trim() || mutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {mutation.isPending && <Loader2 size={14} className="animate-spin" />} {isEdit ? 'Save' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}
