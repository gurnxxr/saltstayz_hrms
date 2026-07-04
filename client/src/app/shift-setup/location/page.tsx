'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import Breadcrumb from '@/components/ui/Breadcrumb';
import LoadError from '@/components/ui/LoadError';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import api from '@/lib/api';
import { Plus, MapPin, Pencil, Trash2, Save, Loader2, X } from 'lucide-react';

interface ShiftLocation {
  id: number;
  name: string;
}

const inputCls =
  'w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';

export default function ShiftLocationPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ShiftLocation | 'new' | null>(null);
  const [name, setName] = useState('');
  const [confirmDel, setConfirmDel] = useState<ShiftLocation | null>(null);

  const { data: locations = [], isError, refetch } = useQuery<ShiftLocation[]>({
    queryKey: ['shift-locations'],
    queryFn: () => api.get('/shifts/locations').then((r) => r.data),
  });

  const openNew = () => { setName(''); setEditing('new'); };
  const openEdit = (loc: ShiftLocation) => { setName(loc.name); setEditing(loc); };
  const close = () => { setEditing(null); setName(''); };

  const saveMutation = useMutation({
    mutationFn: () =>
      editing === 'new'
        ? api.post('/shifts/locations', { name: name.trim() })
        : api.put(`/shifts/locations/${(editing as ShiftLocation).id}`, { name: name.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shift-locations'] });
      toast.success(editing === 'new' ? 'Shift location created' : 'Shift location updated');
      close();
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to save shift location'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/shifts/locations/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shift-locations'] });
      toast.success('Shift location deleted');
      setConfirmDel(null);
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Failed to delete shift location');
      setConfirmDel(null);
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast.error('Location name is required'); return; }
    saveMutation.mutate();
  };

  return (
    <AppShell>
      <div className="space-y-6 max-w-3xl">
        <Breadcrumb items={[{ label: 'Shift Setup' }, { label: 'Shift Location' }]} />

        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Shift Location</h1>
            <p className="text-secondary mt-1">Physical locations where shifts occur.</p>
          </div>
          <button
            onClick={openNew}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shrink-0"
          >
            <Plus size={16} /> New Shift Location
          </button>
        </div>

        {isError ? (
          <LoadError message="Couldn't load shift locations." onRetry={() => refetch()} />
        ) : locations.length === 0 ? (
          <div className="bg-card rounded-xl border border-border p-10 text-center">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
              <MapPin className="w-6 h-6 text-primary" />
            </div>
            <p className="text-sm font-medium text-foreground">Create your first Shift Location</p>
            <p className="text-sm text-secondary mt-1">Add the physical locations where your shifts are worked.</p>
            <button
              onClick={openNew}
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus size={15} /> New Shift Location
            </button>
          </div>
        ) : (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-secondary">
                    <th className="px-4 py-3 font-medium w-20">ID</th>
                    <th className="px-4 py-3 font-medium">Location Name</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {locations.map((loc) => (
                    <tr key={loc.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3 text-secondary tabular-nums">{loc.id}</td>
                      <td className="px-4 py-3 font-medium text-foreground">{loc.name}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEdit(loc)}
                            className="p-1.5 rounded-lg text-secondary hover:text-foreground hover:bg-muted transition-colors"
                            title="Edit"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            onClick={() => setConfirmDel(loc)}
                            className="p-1.5 rounded-lg text-secondary hover:text-red-600 hover:bg-red-50 transition-colors"
                            title="Delete"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Add / edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={saveMutation.isPending ? undefined : close} />
          <div className="relative bg-card rounded-xl border border-border shadow-xl w-full max-w-md">
            <form onSubmit={submit}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <h3 className="text-base font-semibold text-foreground">
                  {editing === 'new' ? 'New Shift Location' : 'Edit Shift Location'}
                </h3>
                <button type="button" onClick={close} className="p-1 rounded-lg text-secondary hover:text-foreground hover:bg-muted transition-colors">
                  <X size={18} />
                </button>
              </div>
              <div className="p-5">
                <label className="block text-sm font-medium text-foreground mb-1">
                  Location Name<span className="text-red-600"> *</span>
                </label>
                <input
                  autoFocus
                  className={inputCls}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Front Desk"
                />
              </div>
              <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
                <button type="button" onClick={close} className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saveMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {saveMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  {editing === 'new' ? 'Create' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDel}
        title="Delete shift location?"
        message={confirmDel ? <>This permanently removes <span className="font-medium text-foreground">{confirmDel.name}</span>.</> : undefined}
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
        onConfirm={() => confirmDel && deleteMutation.mutate(confirmDel.id)}
        onCancel={() => setConfirmDel(null)}
      />
    </AppShell>
  );
}
