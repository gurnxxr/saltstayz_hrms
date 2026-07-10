'use client';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import Breadcrumb from '@/components/ui/Breadcrumb';
import LoadError from '@/components/ui/LoadError';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import api from '@/lib/api';
import { INDIAN_STATES } from '@/lib/constants';
import { Upload, Plus, Trash2, Loader2, CalendarDays } from 'lucide-react';

const inputCls = 'w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';

// Admin manages the holiday calendar per scope: National (everyone) or one state.
export default function AdminHolidaysPage() {
  const qc = useQueryClient();
  const [scope, setScope] = useState('national'); // 'national' | <state name>
  const [add, setAdd] = useState({ name: '', date: '' });
  const [confirmDel, setConfirmDel] = useState<any | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const isNational = scope === 'national';

  const { data: holidays = [], isError, refetch } = useQuery({
    queryKey: ['admin-holidays', scope],
    queryFn: () => api.get(isNational ? '/leave/holidays?scope=national' : `/leave/holidays?state=${encodeURIComponent(scope)}`).then(r => r.data),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-holidays'] });
    qc.invalidateQueries({ queryKey: ['my-holidays'] });
  };

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('is_national', String(isNational));
      if (!isNational) fd.append('state', scope);
      return api.post('/leave/holidays/upload-csv', fd).then(r => r.data);
    },
    onSuccess: (data) => { invalidate(); toast.success(`${data.inserted} holiday(s) imported for ${isNational ? 'National' : scope}`); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Upload failed'),
  });

  const addMutation = useMutation({
    mutationFn: () => api.post('/leave/holidays', { name: add.name.trim(), date: add.date, is_national: isNational, state: isNational ? null : scope }),
    onSuccess: () => { invalidate(); toast.success('Holiday added'); setAdd({ name: '', date: '' }); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to add'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/leave/holidays/${id}`),
    onSuccess: () => { invalidate(); toast.success('Holiday deleted'); setConfirmDel(null); },
    onError: (e: any) => { toast.error(e.response?.data?.error || 'Failed to delete'); setConfirmDel(null); },
  });

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadMutation.mutate(file);
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <AppShell>
      <div className="space-y-6 max-w-4xl">
        <Breadcrumb items={[{ label: 'Admin', href: '/admin' }, { label: 'Holidays' }]} />
        <div>
          <h1 className="text-2xl font-bold text-foreground">Holidays</h1>
          <p className="text-secondary mt-1">Manage the holiday calendar. National holidays apply to everyone; a state&apos;s holidays apply to employees whose property is in that state.</p>
        </div>

        {/* Scope + upload */}
        <div className="bg-card rounded-xl border border-border p-6 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">Scope</label>
              <select className={inputCls + ' min-w-[220px]'} value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="national">National (everyone)</option>
                <optgroup label="State">
                  {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </optgroup>
              </select>
            </div>
            <div>
              <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} className="hidden" />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploadMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {uploadMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                Upload CSV
              </button>
            </div>
          </div>
          <p className="text-xs text-secondary">
            CSV columns: <span className="font-medium text-foreground">Holiday Name, Date</span> (date as YYYY-MM-DD or DD-MM-YYYY).
            Uploading <span className="font-medium">replaces</span> all {isNational ? 'national' : scope} holidays.
          </p>
        </div>

        {/* Manual add */}
        <div className="bg-card rounded-xl border border-border p-6">
          <h2 className="text-sm font-semibold text-foreground mb-3">Add a holiday to {isNational ? 'National' : scope}</h2>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-secondary mb-1">Name</label>
              <input className={inputCls} value={add.name} onChange={(e) => setAdd((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Diwali" />
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">Date</label>
              <input type="date" className={inputCls} value={add.date} onChange={(e) => setAdd((p) => ({ ...p, date: e.target.value }))} />
            </div>
            <button
              onClick={() => addMutation.mutate()}
              disabled={addMutation.isPending || !add.name.trim() || !add.date}
              className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              {addMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Add
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">{isNational ? 'National' : scope} holidays</h2>
          </div>
          {isError ? (
            <LoadError message="Couldn't load holidays." onRetry={() => refetch()} />
          ) : holidays.length === 0 ? (
            <div className="p-8 text-center text-secondary">
              <CalendarDays size={32} className="mx-auto mb-2 opacity-40" />
              <p>No {isNational ? 'national' : scope} holidays yet.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-secondary">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Holiday</th>
                  <th className="px-4 py-3 font-medium text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {holidays.map((h: any) => (
                  <tr key={h.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 whitespace-nowrap text-foreground">
                      {new Date(h.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">{h.name}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => setConfirmDel(h)} title="Delete"
                        className="p-1.5 rounded-lg text-secondary hover:text-red-600 hover:bg-red-50 transition-colors">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmDel}
        title="Delete holiday?"
        danger
        confirmLabel="Delete"
        message={confirmDel ? <>Remove <span className="font-medium text-foreground">{confirmDel.name}</span>?</> : undefined}
        loading={deleteMutation.isPending}
        onConfirm={() => confirmDel && deleteMutation.mutate(confirmDel.id)}
        onCancel={() => setConfirmDel(null)}
      />
    </AppShell>
  );
}
