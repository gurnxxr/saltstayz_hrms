'use client';

import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import { formatINR } from '@/lib/utils';
import { INDIAN_STATES } from '@/lib/constants';
import { Plus, Pencil, Trash2, X, Upload } from 'lucide-react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Pagination, { pageSlice } from '@/components/ui/Pagination';

// ─── Properties Tab ───

export function PropertiesTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: '', hotel_id: '', city: '', state: '', address: '', category: '' });
  const [showForm, setShowForm] = useState(false);
  const [delTarget, setDelTarget] = useState<any>(null);
  const [page, setPage] = useState(1);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: items = [] } = useQuery({
    queryKey: ['org-properties'],
    queryFn: () => api.get('/admin/properties').then(r => r.data),
  });

  // Category is a managed pick-list (Admin → Organization → Property Categories).
  const { data: categories = [] } = useQuery({
    queryKey: ['org-property-categories'],
    queryFn: () => api.get('/admin/property-categories').then(r => r.data),
  });

  const saveMutation = useMutation({
    mutationFn: (data: typeof form) =>
      editing
        ? api.put(`/admin/properties/${editing.id}`, data)
        : api.post('/admin/properties', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['org-properties'] }); toast.success('Saved'); closeForm(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/properties/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['org-properties'] }); toast.success('Property deleted'); setDelTarget(null); },
    onError: (e: any) => { toast.error(e.response?.data?.error || 'Cannot delete'); setDelTarget(null); },
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.post('/admin/properties/upload', fd).then(r => r.data);
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['org-properties'] });
      toast.success(`${data.created} properties added${data.skipped ? `, ${data.skipped} skipped` : ''}`);
      if (data.errors?.length) data.errors.slice(0, 3).forEach((e: string) => toast.info(e));
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Upload failed'),
  });

  function openEdit(item: any) {
    setEditing(item);
    setForm({ name: item.name, hotel_id: item.hotel_id || '', city: item.city || '', state: item.state || '', address: item.address || '', category: item.category || '' });
    setShowForm(true);
  }

  function closeForm() { setShowForm(false); setEditing(null); setForm({ name: '', hotel_id: '', city: '', state: '', address: '', category: '' }); }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadMutation.mutate(file);
    if (fileRef.current) fileRef.current.value = '';
  }

  // Options for the Category dropdown: the managed list, plus the property's current
  // category if it's an off-list value (older data), so editing never drops it.
  const catOptions: string[] = categories.map((c: any) => c.name as string);
  const curCategory = (form.category ?? '').trim();
  if (curCategory && !catOptions.includes(curCategory)) catOptions.push(curCategory);

  // ── Pagination: 10 properties per page ──
  const PAGE_SIZE = 10;
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  const visible = pageSlice(items, Math.min(page, totalPages), PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
          <button onClick={() => fileRef.current?.click()} disabled={uploadMutation.isPending} className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted disabled:opacity-50">
            <Upload size={16} /> {uploadMutation.isPending ? 'Uploading...' : 'Upload CSV'}
          </button>
        </div>
        <button onClick={() => { closeForm(); setShowForm(true); }} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium">
          <Plus size={16} /> Add Property
        </button>
      </div>

      {showForm && (
        <div className="bg-card rounded-xl border border-border p-5">
          <div className="flex justify-between mb-3">
            <h3 className="font-semibold text-foreground">{editing ? 'Edit Property' : 'New Property'}</h3>
            <button onClick={closeForm}><X size={16} className="text-secondary" /></button>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); saveMutation.mutate(form); }} className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Name *</label>
              <input required value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Hotel ID</label>
              <input value={form.hotel_id} onChange={e => setForm(p => ({ ...p, hotel_id: e.target.value }))} className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">City *</label>
              <input required value={form.city} onChange={e => setForm(p => ({ ...p, city: e.target.value }))} className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">State *</label>
              <select required value={form.state} onChange={e => setForm(p => ({ ...p, state: e.target.value }))} className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm">
                <option value="">Select state…</option>
                {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <p className="mt-1 text-[11px] text-secondary">Statutory rules (LWF, PT, minimum wage) follow this state.</p>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium mb-1">Address *</label>
              <input required value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Category *</label>
              <select required value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm">
                <option value="">Select category…</option>
                {catOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="col-span-3 flex gap-2">
              <button type="submit" disabled={saveMutation.isPending} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">{editing ? 'Update' : 'Create'}</button>
              <button type="button" onClick={closeForm} className="px-4 py-2 border border-border rounded-lg text-sm">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <table className="w-full">
          <thead><tr className="border-b border-border bg-muted/50">
            <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Name</th>
            <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Hotel ID</th>
            <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">City</th>
            <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">State</th>
            <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Address</th>
            <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Category</th>
            <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Status</th>
            <th className="text-right px-4 py-3 text-xs font-medium text-secondary uppercase">Actions</th>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {visible.map((item: any) => (
              <tr key={item.id} className="hover:bg-muted/30">
                <td className="px-4 py-3 text-sm font-medium text-foreground">{item.name}</td>
                <td className="px-4 py-3 text-sm text-secondary">{item.hotel_id || '—'}</td>
                <td className="px-4 py-3 text-sm text-secondary">{item.city || '—'}</td>
                <td className="px-4 py-3 text-sm text-secondary">{item.state || <span className="text-amber-600">Not set</span>}</td>
                <td className="px-4 py-3 text-sm text-secondary max-w-[200px] truncate">{item.address || '—'}</td>
                <td className="px-4 py-3 text-sm text-secondary">{item.category || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-1 rounded-full ${item.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {item.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => openEdit(item)} className="p-1.5 text-secondary hover:text-foreground"><Pencil size={14} /></button>
                  <button onClick={() => setDelTarget(item)} className="p-1.5 text-secondary hover:text-red-600"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && <p className="text-center py-8 text-secondary text-sm">No properties found</p>}
        <Pagination total={items.length} page={page} pageSize={PAGE_SIZE} onPageChange={setPage} shown={visible.length} itemLabel="properties" />
      </div>

      <ConfirmDialog
        open={!!delTarget}
        title="Delete property?"
        message={<>This permanently deletes <strong className="text-foreground">{delTarget?.name}</strong>. This action cannot be undone.</>}
        confirmLabel="Delete property"
        loading={deleteMutation.isPending}
        onConfirm={() => delTarget && deleteMutation.mutate(delTarget.id)}
        onCancel={() => setDelTarget(null)}
      />
    </div>
  );
}

// ─── Simple List Tab ───

export function SimpleListTab({ endpoint, label, fieldName = 'name', queryKey }: { endpoint: string; label: string; fieldName?: string; queryKey: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any>(null);
  const [value, setValue] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [delTarget, setDelTarget] = useState<any>(null);

  const { data: items = [] } = useQuery({
    queryKey: [queryKey],
    queryFn: () => api.get(`/admin/${endpoint}`).then(r => r.data),
  });

  const saveMutation = useMutation({
    mutationFn: (val: string) =>
      editing
        ? api.put(`/admin/${endpoint}/${editing.id}`, { [fieldName]: val })
        : api.post(`/admin/${endpoint}`, { [fieldName]: val }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [queryKey] }); toast.success('Saved'); closeForm(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/${endpoint}/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [queryKey] }); toast.success('Deleted'); setDelTarget(null); },
    onError: (e: any) => { toast.error(e.response?.data?.error || 'Cannot delete'); setDelTarget(null); },
  });

  function openEdit(item: any) { setEditing(item); setValue(item[fieldName]); setShowForm(true); }
  function closeForm() { setShowForm(false); setEditing(null); setValue(''); }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => { closeForm(); setShowForm(true); }} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium">
          <Plus size={16} /> Add {label}
        </button>
      </div>

      {showForm && (
        <div className="bg-card rounded-xl border border-border p-5">
          <div className="flex justify-between mb-3">
            <h3 className="font-semibold text-foreground">{editing ? `Edit ${label}` : `New ${label}`}</h3>
            <button onClick={closeForm}><X size={16} className="text-secondary" /></button>
          </div>
          <form onSubmit={e => { e.preventDefault(); saveMutation.mutate(value); }} className="flex gap-3">
            <input required value={value} onChange={e => setValue(e.target.value)} placeholder={`${label} name`} className="flex-1 px-3 py-2 border border-border rounded-lg bg-background text-sm" />
            <button type="submit" disabled={saveMutation.isPending} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">{editing ? 'Update' : 'Create'}</button>
            <button type="button" onClick={closeForm} className="px-4 py-2 border border-border rounded-lg text-sm">Cancel</button>
          </form>
        </div>
      )}

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <table className="w-full">
          <thead><tr className="border-b border-border bg-muted/50">
            <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">{label}</th>
            <th className="text-right px-4 py-3 text-xs font-medium text-secondary uppercase">Actions</th>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {items.map((item: any) => (
              <tr key={item.id} className="hover:bg-muted/30">
                <td className="px-4 py-3 text-sm font-medium text-foreground">{item[fieldName]}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => openEdit(item)} className="p-1.5 text-secondary hover:text-foreground"><Pencil size={14} /></button>
                  <button onClick={() => setDelTarget(item)} className="p-1.5 text-secondary hover:text-red-600"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!delTarget}
        title={`Delete ${label.toLowerCase()}?`}
        message={<>This permanently deletes <strong className="text-foreground">{delTarget?.[fieldName]}</strong>. This action cannot be undone.</>}
        confirmLabel={`Delete ${label.toLowerCase()}`}
        loading={deleteMutation.isPending}
        onConfirm={() => delTarget && deleteMutation.mutate(delTarget.id)}
        onCancel={() => setDelTarget(null)}
      />
    </div>
  );
}

// ─── Departments Tab ───
// Like SimpleListTab but each department also carries a standard working-hours-per-day.

export function DepartmentsTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: '', working_hours_per_day: '' });
  const [showForm, setShowForm] = useState(false);
  const [delTarget, setDelTarget] = useState<any>(null);

  const { data: items = [] } = useQuery({
    queryKey: ['org-departments'],
    queryFn: () => api.get('/admin/departments').then(r => r.data),
  });

  const saveMutation = useMutation({
    mutationFn: (data: typeof form) => {
      const body = { name: data.name, working_hours_per_day: data.working_hours_per_day === '' ? null : Number(data.working_hours_per_day) };
      return editing ? api.put(`/admin/departments/${editing.id}`, body) : api.post('/admin/departments', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-departments'] });
      qc.invalidateQueries({ queryKey: ['departments'] }); // the app-wide department picker
      toast.success('Saved'); closeForm();
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/departments/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-departments'] });
      qc.invalidateQueries({ queryKey: ['departments'] });
      toast.success('Deleted'); setDelTarget(null);
    },
    onError: (e: any) => { toast.error(e.response?.data?.error || 'Cannot delete'); setDelTarget(null); },
  });

  function openEdit(item: any) {
    setEditing(item);
    setForm({ name: item.name, working_hours_per_day: item.working_hours_per_day != null ? String(Number(item.working_hours_per_day)) : '' });
    setShowForm(true);
  }
  function closeForm() { setShowForm(false); setEditing(null); setForm({ name: '', working_hours_per_day: '' }); }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => { closeForm(); setShowForm(true); }} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium">
          <Plus size={16} /> Add Department
        </button>
      </div>

      {showForm && (
        <div className="bg-card rounded-xl border border-border p-5">
          <div className="flex justify-between mb-3">
            <h3 className="font-semibold text-foreground">{editing ? 'Edit Department' : 'New Department'}</h3>
            <button onClick={closeForm}><X size={16} className="text-secondary" /></button>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); saveMutation.mutate(form); }} className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Name *</label>
              <input required value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Working Hours / Day</label>
              <input type="number" step="0.5" min="0" max="24" value={form.working_hours_per_day}
                onChange={e => setForm(p => ({ ...p, working_hours_per_day: e.target.value }))}
                placeholder="e.g. 8" className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm" />
            </div>
            <div className="col-span-2 flex gap-2">
              <button type="submit" disabled={saveMutation.isPending} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">{editing ? 'Update' : 'Create'}</button>
              <button type="button" onClick={closeForm} className="px-4 py-2 border border-border rounded-lg text-sm">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <table className="w-full">
          <thead><tr className="border-b border-border bg-muted/50">
            <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Department</th>
            <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Working Hours / Day</th>
            <th className="text-right px-4 py-3 text-xs font-medium text-secondary uppercase">Actions</th>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {items.map((item: any) => (
              <tr key={item.id} className="hover:bg-muted/30">
                <td className="px-4 py-3 text-sm font-medium text-foreground">{item.name}</td>
                <td className="px-4 py-3 text-sm text-secondary">{item.working_hours_per_day != null ? `${Number(item.working_hours_per_day)} hrs` : <span className="text-secondary/60">Not set</span>}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => openEdit(item)} className="p-1.5 text-secondary hover:text-foreground"><Pencil size={14} /></button>
                  <button onClick={() => setDelTarget(item)} className="p-1.5 text-secondary hover:text-red-600"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && <p className="text-center py-8 text-secondary text-sm">No departments found</p>}
      </div>

      <ConfirmDialog
        open={!!delTarget}
        title="Delete department?"
        message={<>This permanently deletes <strong className="text-foreground">{delTarget?.name}</strong>. This action cannot be undone.</>}
        confirmLabel="Delete department"
        loading={deleteMutation.isPending}
        onConfirm={() => delTarget && deleteMutation.mutate(delTarget.id)}
        onCancel={() => setDelTarget(null)}
      />
    </div>
  );
}

// ─── Pay Grades Tab ───

export function PayGradesTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: '', min_salary: '', max_salary: '' });
  const [showForm, setShowForm] = useState(false);
  const [delTarget, setDelTarget] = useState<any>(null);

  const { data: items = [] } = useQuery({
    queryKey: ['org-pay-grades'],
    queryFn: () => api.get('/admin/pay-grades').then(r => r.data),
  });

  const saveMutation = useMutation({
    mutationFn: (data: typeof form) => {
      const body = { name: data.name, min_salary: data.min_salary ? Number(data.min_salary) : null, max_salary: data.max_salary ? Number(data.max_salary) : null };
      return editing ? api.put(`/admin/pay-grades/${editing.id}`, body) : api.post('/admin/pay-grades', body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['org-pay-grades'] }); toast.success('Saved'); closeForm(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/pay-grades/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['org-pay-grades'] }); toast.success('Deleted'); setDelTarget(null); },
    onError: (e: any) => { toast.error(e.response?.data?.error || 'Cannot delete'); setDelTarget(null); },
  });

  function openEdit(item: any) {
    setEditing(item);
    setForm({ name: item.name, min_salary: String(item.min_salary ?? ''), max_salary: String(item.max_salary ?? '') });
    setShowForm(true);
  }

  function closeForm() { setShowForm(false); setEditing(null); setForm({ name: '', min_salary: '', max_salary: '' }); }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => { closeForm(); setShowForm(true); }} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium">
          <Plus size={16} /> Add Pay Grade
        </button>
      </div>

      {showForm && (
        <div className="bg-card rounded-xl border border-border p-5">
          <div className="flex justify-between mb-3">
            <h3 className="font-semibold text-foreground">{editing ? 'Edit Pay Grade' : 'New Pay Grade'}</h3>
            <button onClick={closeForm}><X size={16} className="text-secondary" /></button>
          </div>
          <form onSubmit={e => { e.preventDefault(); saveMutation.mutate(form); }} className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Name *</label>
              <input required value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Min Salary</label>
              <input type="number" value={form.min_salary} onChange={e => setForm(p => ({ ...p, min_salary: e.target.value }))} className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Max Salary</label>
              <input type="number" value={form.max_salary} onChange={e => setForm(p => ({ ...p, max_salary: e.target.value }))} className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm" />
            </div>
            <div className="col-span-3 flex gap-2">
              <button type="submit" disabled={saveMutation.isPending} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">{editing ? 'Update' : 'Create'}</button>
              <button type="button" onClick={closeForm} className="px-4 py-2 border border-border rounded-lg text-sm">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <table className="w-full">
          <thead><tr className="border-b border-border bg-muted/50">
            <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Grade</th>
            <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Min Salary</th>
            <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Max Salary</th>
            <th className="text-right px-4 py-3 text-xs font-medium text-secondary uppercase">Actions</th>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {items.map((item: any) => (
              <tr key={item.id} className="hover:bg-muted/30">
                <td className="px-4 py-3 text-sm font-medium text-foreground">{item.name}</td>
                <td className="px-4 py-3 text-sm text-secondary">{formatINR(item.min_salary)}</td>
                <td className="px-4 py-3 text-sm text-secondary">{formatINR(item.max_salary)}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => openEdit(item)} className="p-1.5 text-secondary hover:text-foreground"><Pencil size={14} /></button>
                  <button onClick={() => setDelTarget(item)} className="p-1.5 text-secondary hover:text-red-600"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!delTarget}
        title="Delete pay grade?"
        message={<>This permanently deletes <strong className="text-foreground">{delTarget?.name}</strong>. This action cannot be undone.</>}
        confirmLabel="Delete pay grade"
        loading={deleteMutation.isPending}
        onConfirm={() => delTarget && deleteMutation.mutate(delTarget.id)}
        onCancel={() => setDelTarget(null)}
      />
    </div>
  );
}
