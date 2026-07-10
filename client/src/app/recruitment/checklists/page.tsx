'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import Breadcrumb from '@/components/ui/Breadcrumb';
import LoadError from '@/components/ui/LoadError';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { usePermissions } from '@/hooks/usePermissions';
import { Plus, Pencil, Trash2, Check, X, Loader2, FileText, Info, ListChecks } from 'lucide-react';

const inputCls = 'w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';

export default function ChecklistTemplatesPage() {
  const { isAdmin, isCHRO, isHR } = usePermissions();
  // Server also enforces authorizeRoles('admin','chro','hr') on template writes; this
  // just hides the controls for everyone else.
  const canEdit = isAdmin || isCHRO || isHR;

  const { data: templates = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['checklist-templates'],
    queryFn: () => api.get('/checklists/templates').then(r => r.data),
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <Breadcrumb className="mb-2" items={[{ label: 'Recruitment', href: '/recruitment' }, { label: 'Checklist Templates' }]} />
          <h1 className="text-2xl font-bold text-foreground">Checklist Templates</h1>
          <p className="text-secondary mt-1">The standard checklists used to bring new hires on board — document collection, pre-joining formalities and joining day.</p>
        </div>

        <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-2.5">
          <Info size={15} className="mt-0.5 shrink-0" />
          <p>Editing a template only affects checklists created <span className="font-medium">afterwards</span>. Hires already in the joining queue keep the checklist they were given.</p>
        </div>

        {isError ? (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <LoadError message="Couldn't load checklist templates." onRetry={() => refetch()} />
          </div>
        ) : isLoading ? (
          <div className="p-8 text-center text-secondary">Loading…</div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            {templates.map((t: any) => (
              <TemplateCard key={t.id} template={t} canEdit={canEdit} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function TemplateCard({ template, canEdit }: { template: any; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [addLabel, setAddLabel] = useState('');
  const [addCategory, setAddCategory] = useState('');
  const [editing, setEditing] = useState<{ id: number; label: string; category: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<any | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['checklist-templates'] });

  const addMutation = useMutation({
    mutationFn: () => api.post(`/checklists/templates/${template.id}/items`, {
      label: addLabel.trim(), ...(addCategory.trim() ? { category: addCategory.trim() } : {}),
    }),
    onSuccess: () => { invalidate(); toast.success('Item added'); setAddLabel(''); setAddCategory(''); },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to add item'),
  });

  const renameMutation = useMutation({
    mutationFn: () => api.put(`/checklists/template-items/${editing!.id}`, {
      label: editing!.label.trim(), category: editing!.category.trim() || undefined,
    }),
    onSuccess: () => { invalidate(); toast.success('Item saved'); setEditing(null); },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to save item'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/checklists/template-items/${id}`),
    onSuccess: () => { invalidate(); toast.success('Item removed'); setConfirmDelete(null); },
    onError: (err: any) => { toast.error(err.response?.data?.error || 'Failed to remove item'); setConfirmDelete(null); },
  });

  const items: any[] = template.items ?? [];

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden flex flex-col">
      <div className="px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <ListChecks size={15} className="text-primary shrink-0" />
          <h2 className="text-sm font-semibold text-foreground">{template.name}</h2>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-xs text-secondary">{items.length} item{items.length === 1 ? '' : 's'}</span>
          {template.supports_documents && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-700">
              <FileText size={10} /> Accepts documents
            </span>
          )}
        </div>
      </div>

      <div className="divide-y divide-border flex-1">
        {items.length === 0 ? (
          <p className="px-5 py-4 text-sm text-secondary">No items yet.</p>
        ) : items.map((it: any) => (
          <div key={it.id} className="px-5 py-2.5">
            {editing?.id === it.id ? (
              <div className="space-y-2">
                <input autoFocus className={inputCls} value={editing!.label}
                  onChange={(e) => setEditing((p) => p && ({ ...p, label: e.target.value }))}
                  placeholder="Item label" />
                <input className={inputCls} value={editing!.category}
                  onChange={(e) => setEditing((p) => p && ({ ...p, category: e.target.value }))}
                  placeholder="Category (optional)" />
                <div className="flex justify-end gap-1.5">
                  <button onClick={() => setEditing(null)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-border rounded-lg text-xs font-medium hover:bg-muted transition-colors">
                    <X size={13} /> Cancel
                  </button>
                  <button onClick={() => renameMutation.mutate()} disabled={renameMutation.isPending || !editing!.label.trim()}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-primary text-white rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                    {renameMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-foreground truncate">{it.label}</p>
                  {it.category && <p className="text-xs text-secondary">{it.category}</p>}
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => setEditing({ id: it.id, label: it.label, category: it.category || '' })} title="Rename"
                      className="p-1.5 rounded-lg text-secondary hover:text-foreground hover:bg-muted transition-colors">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => setConfirmDelete(it)} title="Delete"
                      className="p-1.5 rounded-lg text-secondary hover:text-red-600 hover:bg-red-50 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {canEdit && (
        <div className="px-5 py-4 border-t border-border space-y-2 bg-muted/20">
          <input className={inputCls} value={addLabel} onChange={(e) => setAddLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && addLabel.trim() && !addMutation.isPending) addMutation.mutate(); }}
            placeholder="New item label" />
          <div className="flex gap-2">
            <input className={inputCls} value={addCategory} onChange={(e) => setAddCategory(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && addLabel.trim() && !addMutation.isPending) addMutation.mutate(); }}
              placeholder="Category (optional)" />
            <button onClick={() => addMutation.mutate()} disabled={addMutation.isPending || !addLabel.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors shrink-0">
              {addMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete checklist item?"
        danger
        confirmLabel="Delete"
        message={confirmDelete ? <>This removes <span className="font-medium text-foreground">{confirmDelete.label}</span> from the <span className="font-medium text-foreground">{template.name}</span> template. Checklists already created keep it.</> : undefined}
        loading={deleteMutation.isPending}
        onConfirm={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
