'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { ArrowLeft, Check, Circle, Plus, Trash2, User, Upload, Paperclip, Download, Loader2 } from 'lucide-react';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
};

export default function OnboardingChecklistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [newItem, setNewItem] = useState('');
  const [uploadingId, setUploadingId] = useState<number | null>(null);
  const [removeDoc, setRemoveDoc] = useState<{ id: number; name: string } | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['onboarding-checklist', id] });
    queryClient.invalidateQueries({ queryKey: ['onboarding-stats'] });
  };

  const { data: checklist, isLoading } = useQuery({
    queryKey: ['onboarding-checklist', id],
    queryFn: () => api.get(`/onboarding/checklists/${id}`).then(r => r.data),
  });

  const toggleMutation = useMutation({
    mutationFn: (itemId: number) => api.put(`/onboarding/items/${itemId}/toggle`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['onboarding-checklist', id] });
      queryClient.invalidateQueries({ queryKey: ['onboarding-stats'] });
    },
    onError: () => toast.error('Failed to update item'),
  });

  const addItemMutation = useMutation({
    mutationFn: (itemName: string) => api.post(`/onboarding/checklists/${id}/items`, { item_name: itemName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['onboarding-checklist', id] });
      toast.success('Item added');
      setNewItem('');
    },
    onError: () => toast.error('Failed to add item'),
  });

  const deleteItemMutation = useMutation({
    mutationFn: (itemId: number) => api.delete(`/onboarding/items/${itemId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['onboarding-checklist', id] });
      toast.success('Item removed');
    },
  });

  const uploadDocMutation = useMutation({
    mutationFn: ({ itemId, file }: { itemId: number; file: File }) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.post(`/onboarding/items/${itemId}/document`, fd);
    },
    onSuccess: () => { invalidate(); toast.success('Document uploaded'); setUploadingId(null); },
    onError: (e: any) => { toast.error(e.response?.data?.error || 'Upload failed'); setUploadingId(null); },
  });

  const removeDocMutation = useMutation({
    mutationFn: (itemId: number) => api.delete(`/onboarding/items/${itemId}/document`),
    onSuccess: () => { invalidate(); toast.success('Document removed'); setRemoveDoc(null); },
    onError: () => { toast.error('Failed to remove document'); setRemoveDoc(null); },
  });

  async function downloadDoc(itemId: number, name: string) {
    try {
      const res = await api.get(`/onboarding/items/${itemId}/document`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to download document');
    }
  }

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      </AppShell>
    );
  }

  if (!checklist) {
    return (
      <AppShell>
        <div className="text-center py-20 text-secondary">Checklist not found.</div>
      </AppShell>
    );
  }

  const completedCount = checklist.items?.filter((i: any) => i.is_completed).length ?? 0;
  const totalCount = checklist.items?.length ?? 0;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <AppShell>
      <div className="space-y-6 max-w-3xl">
        <button
          onClick={() => router.push('/onboarding')}
          className="flex items-center gap-2 text-secondary hover:text-foreground text-sm transition-colors"
        >
          <ArrowLeft size={16} />
          Back to Onboarding
        </button>

        {/* Employee Header */}
        <div className="bg-card rounded-xl border border-border p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                <User size={24} className="text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground">{checklist.first_name} {checklist.last_name}</h1>
                <p className="text-secondary">{checklist.job_title}</p>
                <p className="text-sm text-secondary">
                  {checklist.dept_name} &middot; {checklist.branch_name} &middot; {checklist.employee_code}
                </p>
              </div>
            </div>
            <span className={`px-3 py-1.5 rounded-full text-xs font-medium ${STATUS_COLORS[checklist.status]}`}>
              {checklist.status.replace('_', ' ')}
            </span>
          </div>

          <div className="mt-4 pt-4 border-t border-border grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-secondary">Email</p>
              <p className="text-sm text-foreground">{checklist.email}</p>
            </div>
            <div>
              <p className="text-xs text-secondary">Phone</p>
              <p className="text-sm text-foreground">{checklist.phone}</p>
            </div>
            <div>
              <p className="text-xs text-secondary">Joining Date</p>
              <p className="text-sm text-foreground">{new Date(checklist.date_of_joining).toLocaleDateString('en-IN')}</p>
            </div>
          </div>
        </div>

        {/* Progress */}
        <div className="bg-card rounded-xl border border-border p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-foreground">Progress</h2>
            <span className="text-sm font-medium text-foreground">{completedCount}/{totalCount} ({progressPct}%)</span>
          </div>
          <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${progressPct === 100 ? 'bg-green-500' : 'bg-primary'}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Checklist Items */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="p-4 border-b border-border">
            <h2 className="text-lg font-semibold text-foreground">Checklist Items</h2>
          </div>
          <div className="divide-y divide-border">
            {checklist.items?.map((item: any) => (
              <div key={item.id} className="px-4 py-3 group">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => toggleMutation.mutate(item.id)}
                    className="flex items-center gap-3 flex-1 text-left"
                  >
                    {item.is_completed ? (
                      <Check size={18} className="text-green-600 shrink-0" />
                    ) : (
                      <Circle size={18} className="text-secondary/40 shrink-0" />
                    )}
                    <div>
                      <p className={`text-sm ${item.is_completed ? 'line-through text-secondary' : 'text-foreground'}`}>
                        {item.item_name}
                      </p>
                      {item.is_completed && item.verified_by_email && (
                        <p className="text-xs text-secondary">
                          Verified by {item.verified_by_email} &middot; {new Date(item.completed_at).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </button>
                  <div className="flex items-center gap-1">
                    {item.document_url ? (
                      <>
                        <button
                          onClick={() => downloadDoc(item.id, item.document_name || 'document')}
                          className="inline-flex items-center gap-1.5 px-2 py-1 text-xs text-primary hover:bg-primary/5 rounded-lg max-w-[180px]"
                          title={item.document_name}
                        >
                          <Paperclip size={13} className="shrink-0" />
                          <span className="truncate">{item.document_name || 'View'}</span>
                          <Download size={12} className="shrink-0" />
                        </button>
                        <button
                          onClick={() => setRemoveDoc({ id: item.id, name: item.document_name || 'document' })}
                          className="p-1 rounded text-secondary/40 hover:text-red-500"
                          title="Remove document"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    ) : (
                      <label className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border border-border rounded-lg cursor-pointer hover:bg-muted ${uploadingId === item.id ? 'opacity-60 pointer-events-none' : ''}`}>
                        {uploadingId === item.id ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                        Upload
                        <input
                          type="file"
                          className="hidden"
                          accept=".pdf,.jpg,.jpeg,.png"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) { setUploadingId(item.id); uploadDocMutation.mutate({ itemId: item.id, file }); }
                            e.target.value = '';
                          }}
                        />
                      </label>
                    )}
                    <button
                      onClick={() => deleteItemMutation.mutate(item.id)}
                      className="p-1 rounded text-secondary/30 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                      title="Remove item"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Add New Item */}
          <div className="p-4 border-t border-border">
            <form
              onSubmit={(e) => { e.preventDefault(); if (newItem.trim()) addItemMutation.mutate(newItem.trim()); }}
              className="flex gap-2"
            >
              <input
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                placeholder="Add a custom checklist item..."
                className="flex-1 px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <button
                type="submit"
                disabled={!newItem.trim() || addItemMutation.isPending}
                className="flex items-center gap-1 px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                <Plus size={14} />
                Add
              </button>
            </form>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!removeDoc}
        title="Remove document?"
        message={`Remove "${removeDoc?.name}"? This also unchecks the item.`}
        confirmLabel="Remove"
        danger
        loading={removeDocMutation.isPending}
        onConfirm={() => removeDoc && removeDocMutation.mutate(removeDoc.id)}
        onCancel={() => setRemoveDoc(null)}
      />
    </AppShell>
  );
}
