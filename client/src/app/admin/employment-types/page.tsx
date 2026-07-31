'use client';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import Breadcrumb from '@/components/ui/Breadcrumb';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import LoadError from '@/components/ui/LoadError';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Plus, Pencil, Trash2, X, Upload, Download, Contact, CheckCircle2, Loader2, Ban } from 'lucide-react';

interface EmploymentType {
  id: number;
  name: string;
  is_confirmed: boolean;
  prefix: string | null;
  probation_period_months: number | null;
  notice_period_days: number;
  is_active: boolean;
  restricted_type_ids: number[];
  restricted_type_names: string[];
}

const emptyForm = () => ({
  name: '', prefix: '', is_confirmed: false,
  probation_period_months: '', notice_period_days: '0', is_active: true,
  restricted_type_ids: [] as number[],
});
type FormState = ReturnType<typeof emptyForm>;

const inputCls = 'w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';

export default function EmploymentTypesPage() {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canCreate = can('admin', 'create');
  const canUpdate = can('admin', 'update');
  const canDelete = can('admin', 'delete');

  const [editing, setEditing] = useState<EmploymentType | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [deleteTarget, setDeleteTarget] = useState<EmploymentType | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  const { data: types = [], isLoading, isError, refetch } = useQuery<EmploymentType[]>({
    queryKey: ['employment-types'],
    queryFn: () => api.get('/admin/employment-types').then(r => r.data),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['employment-types'] });

  function openEdit(t: EmploymentType | 'new') {
    setEditing(t);
    setForm(t === 'new' ? emptyForm() : {
      name: t.name, prefix: t.prefix ?? '', is_confirmed: t.is_confirmed,
      probation_period_months: t.probation_period_months == null ? '' : String(t.probation_period_months),
      notice_period_days: String(t.notice_period_days ?? 0), is_active: t.is_active,
      restricted_type_ids: [...t.restricted_type_ids],
    });
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        prefix: form.prefix.trim() || null,
        is_confirmed: form.is_confirmed,
        probation_period_months: form.probation_period_months === '' ? null : Number(form.probation_period_months),
        notice_period_days: Number(form.notice_period_days) || 0,
        is_active: form.is_active,
        restricted_type_ids: form.restricted_type_ids,
      };
      return editing === 'new'
        ? api.post('/admin/employment-types', payload)
        : api.put(`/admin/employment-types/${(editing as EmploymentType).id}`, payload);
    },
    onSuccess: () => { invalidate(); toast.success(editing === 'new' ? 'Employment type created' : 'Employment type saved'); setEditing(null); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/employment-types/${id}`),
    onSuccess: () => { invalidate(); toast.success('Employment type deleted'); setDeleteTarget(null); },
    onError: (e: any) => { toast.error(e.response?.data?.error || 'Failed to delete'); setDeleteTarget(null); },
  });

  const importMutation = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.post('/admin/employment-types/import', fd).then(r => r.data);
    },
    onSuccess: (data) => {
      setImportResult(data);
      invalidate();
      const summary = `${data.created} added, ${data.updated} updated${data.skipped ? `, ${data.skipped} skipped` : ''}`;
      // A 200 can still mean "nothing imported" (every row skipped) or "imported with errors" —
      // don't show a plain green success in those cases.
      if (data.created + data.updated === 0) toast.error(`Nothing imported — ${summary}`);
      else if (data.errors?.length || data.skipped) toast.warning(`${summary} — see details`);
      else toast.success(summary);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Import failed'),
  });

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) { setImportResult(null); importMutation.mutate(file); }
    if (importFileRef.current) importFileRef.current.value = '';
  }

  async function handleExport() {
    try {
      const res = await api.get('/admin/employment-types/export', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Employment_Types_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch { toast.error('Export failed'); }
  }

  // Other types available to restrict (exclude the one being edited).
  const restrictionOptions = types.filter((t) => editing === 'new' || t.id !== (editing as EmploymentType)?.id);
  const toggleRestriction = (id: number) =>
    setForm((p) => ({
      ...p,
      restricted_type_ids: p.restricted_type_ids.includes(id)
        ? p.restricted_type_ids.filter((x) => x !== id)
        : [...p.restricted_type_ids, id],
    }));

  const canSave = !!form.name.trim() && !saveMutation.isPending;

  return (
    <AppShell>
      <div className="space-y-6">
        <Breadcrumb items={[{ label: 'Admin', href: '/admin' }, { label: 'Employment Types' }]} />
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><Contact className="text-primary" size={20} /></div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Employment Types</h1>
              <p className="text-secondary mt-1">Define each employment type and its variables — probation, notice period, prefix and the types it restricts.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={handleExport}
              className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors">
              <Download size={16} /> Export CSV
            </button>
            {canCreate && (
              <button onClick={() => { setImportResult(null); setShowImport(true); }}
                className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors">
                <Upload size={16} /> Import CSV
              </button>
            )}
            {canCreate && (
              <button onClick={() => openEdit('new')}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
                <Plus size={16} /> New Type
              </button>
            )}
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {isError ? (
            <LoadError message="Couldn't load employment types." onRetry={() => refetch()} />
          ) : isLoading ? (
            <div className="p-3 space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 bg-muted rounded animate-pulse" />)}</div>
          ) : types.length === 0 ? (
            <div className="p-10 text-center text-secondary">No employment types yet. Create one, or import a CSV.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-xs font-semibold text-secondary uppercase tracking-wide">
                    <th className="px-4 py-3">Employment Type</th>
                    <th className="px-4 py-3">Prefix</th>
                    <th className="px-4 py-3">Confirmed</th>
                    <th className="px-4 py-3">Probation</th>
                    <th className="px-4 py-3">Notice</th>
                    <th className="px-4 py-3">Restricts</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {types.map((t) => (
                    <tr key={t.id} className={`hover:bg-muted/30 ${!t.is_active ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-3 font-medium text-foreground">
                        {t.name}
                        {!t.is_active && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-muted text-secondary">Inactive</span>}
                      </td>
                      <td className="px-4 py-3 text-secondary">{t.prefix || '—'}</td>
                      <td className="px-4 py-3">
                        {t.is_confirmed
                          ? <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-green-100 text-green-700"><CheckCircle2 size={11} /> Yes</span>
                          : <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-secondary">No</span>}
                      </td>
                      <td className="px-4 py-3 text-secondary">{t.probation_period_months == null ? '—' : `${t.probation_period_months} mo`}</td>
                      <td className="px-4 py-3 text-secondary">{t.notice_period_days} day{t.notice_period_days === 1 ? '' : 's'}</td>
                      <td className="px-4 py-3">
                        {t.restricted_type_names.length === 0 ? <span className="text-secondary">—</span> : (
                          <div className="flex flex-wrap gap-1">
                            {t.restricted_type_names.map((n) => (
                              <span key={n} className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700"><Ban size={10} /> {n}</span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {canUpdate && (
                            <button onClick={() => openEdit(t)} className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-primary/10 transition-colors" title="Edit">
                              <Pencil size={15} />
                            </button>
                          )}
                          {canDelete && (
                            <button onClick={() => setDeleteTarget(t)} className="p-1.5 rounded-lg text-secondary hover:text-red-600 hover:bg-red-50 transition-colors" title="Delete">
                              <Trash2 size={15} />
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
      </div>

      {/* Create / Edit modal */}
      {editing !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditing(null)}>
          <div className="bg-card rounded-xl border border-border w-full max-w-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-foreground">{editing === 'new' ? 'New Employment Type' : `Edit — ${(editing as EmploymentType).name}`}</h3>
              <button onClick={() => setEditing(null)}><X size={16} className="text-secondary" /></button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); if (canSave) saveMutation.mutate(); }} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-secondary mb-1">Employment Type<span className="text-red-600"> *</span></label>
                  <input required value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} className={inputCls} placeholder="e.g. Probation" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1">Prefix</label>
                  <input value={form.prefix} onChange={(e) => setForm(p => ({ ...p, prefix: e.target.value }))} className={inputCls} placeholder="e.g. P" maxLength={10} />
                </div>
                <label className="flex items-center gap-2 mt-6 cursor-pointer select-none">
                  <input type="checkbox" checked={form.is_confirmed} onChange={(e) => setForm(p => ({ ...p, is_confirmed: e.target.checked }))}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-primary/50" />
                  <span className="text-sm text-foreground">Is Confirmed</span>
                </label>
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1">Probation Period (months)</label>
                  <input type="number" min={0} value={form.probation_period_months}
                    onChange={(e) => setForm(p => ({ ...p, probation_period_months: e.target.value }))}
                    className={inputCls} placeholder="Leave blank if none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1">Notice Period (days)</label>
                  <input type="number" min={0} value={form.notice_period_days}
                    onChange={(e) => setForm(p => ({ ...p, notice_period_days: e.target.value }))} className={inputCls} />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-secondary mb-1">Restriction for Employment Type</label>
                <p className="text-[11px] text-secondary mb-2">Other employment types this one restricts.</p>
                {restrictionOptions.length === 0 ? (
                  <p className="text-xs text-secondary">No other types to restrict yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {restrictionOptions.map((t) => {
                      const on = form.restricted_type_ids.includes(t.id);
                      return (
                        <button key={t.id} type="button" onClick={() => toggleRestriction(t.id)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${on ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-border text-secondary hover:bg-muted'}`}>
                          {t.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm(p => ({ ...p, is_active: e.target.checked }))}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-primary/50" />
                <span className="text-sm text-foreground">Active</span>
              </label>

              <div className="flex gap-3 pt-1">
                <button type="submit" disabled={!canSave}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                  {saveMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : null} Save
                </button>
                <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 border border-border rounded-lg text-sm">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import CSV modal */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowImport(false)}>
          <div className="bg-card rounded-xl border border-border w-full max-w-lg p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-foreground">Import Employment Types</h3>
              <button onClick={() => setShowImport(false)}><X size={16} className="text-secondary" /></button>
            </div>
            <p className="text-sm text-secondary">
              Upload a CSV. Columns: <span className="font-medium text-foreground">Employment Type</span> (required), Is Confirmed (Y/N),
              Prefix, Restriction for Employment Type (comma-separated type names), Probation Period (In Months), Notice Period (In Days).
              Existing types are matched by name and updated. The <button onClick={handleExport} className="text-primary underline">current export</button> is the template.
            </p>
            <input ref={importFileRef} type="file" accept=".csv" className="hidden" onChange={handleImportFile} />
            <button onClick={() => importFileRef.current?.click()} disabled={importMutation.isPending}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
              <Upload size={16} /> {importMutation.isPending ? 'Processing…' : 'Choose CSV file'}
            </button>
            {importResult && (
              <div className="rounded-lg border border-border p-3 text-sm space-y-2">
                <p className="font-medium text-foreground">{importResult.total} row(s) processed</p>
                <div className="flex flex-wrap gap-4 text-xs">
                  <span className="text-green-600">{importResult.created} added</span>
                  <span className="text-blue-600">{importResult.updated} updated</span>
                  {importResult.skipped > 0 && <span className="text-yellow-600">{importResult.skipped} skipped</span>}
                </div>
                {importResult.errors?.length > 0 && (
                  <div className="max-h-40 overflow-y-auto rounded bg-red-50 border border-red-200 p-2 space-y-0.5">
                    {importResult.errors.map((err: string, i: number) => <p key={i} className="text-xs text-red-700">{err}</p>)}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete employment type?"
        message={deleteTarget ? <>Permanently delete <span className="font-medium text-foreground">{deleteTarget.name}</span>? This cannot be undone.</> : undefined}
        confirmLabel="Delete"
        danger
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </AppShell>
  );
}
