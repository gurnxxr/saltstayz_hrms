'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import Breadcrumb from '@/components/ui/Breadcrumb';
import LoadError from '@/components/ui/LoadError';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import api from '@/lib/api';
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning';
import { Plus, CalendarClock, Pencil, Trash2, ArrowLeft, Save, Loader2, X } from 'lucide-react';

// Weekday indices 0=Sun … 6=Sat (matches the app-wide convention).
const DAYS = [
  { i: 0, label: 'Sunday', short: 'Sun' },
  { i: 1, label: 'Monday', short: 'Mon' },
  { i: 2, label: 'Tuesday', short: 'Tue' },
  { i: 3, label: 'Wednesday', short: 'Wed' },
  { i: 4, label: 'Thursday', short: 'Thu' },
  { i: 5, label: 'Friday', short: 'Fri' },
  { i: 6, label: 'Saturday', short: 'Sat' },
];
const dayShort = (i: number) => DAYS.find((d) => d.i === i)?.short ?? '';

const FREQUENCIES = [
  { weeks: 1, label: 'Every Week' },
  { weeks: 2, label: 'Every 2 Weeks' },
  { weeks: 3, label: 'Every 3 Weeks' },
  { weeks: 4, label: 'Every 4 Weeks' },
];
const freqLabel = (w: number) => FREQUENCIES.find((f) => f.weeks === w)?.label ?? `Every ${w} Weeks`;

const inputCls =
  'w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';

interface ShiftSchedule {
  id: number;
  name: string;
  shift_type_id: number;
  shift_name: string | null;
  frequency_weeks: number;
  days: number[];
}

interface ScheduleForm {
  name: string;
  shift_type_id: string;
  frequency_weeks: string;
  days: number[]; // one entry per child row
}

const emptyForm = (): ScheduleForm => ({ name: '', shift_type_id: '', frequency_weeks: '1', days: [1] });

export default function ShiftSchedulePage() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'list' | 'form'>('list');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ScheduleForm>(emptyForm());
  const [dirty, setDirty] = useState(false);
  const [filterType, setFilterType] = useState('');
  const [confirmDel, setConfirmDel] = useState<ShiftSchedule | null>(null);

  useUnsavedChangesWarning(mode === 'form' && dirty);

  const { data: schedules = [], isError, refetch } = useQuery<ShiftSchedule[]>({
    queryKey: ['shift-schedules', filterType],
    queryFn: () => api.get(`/shifts/schedules${filterType ? `?shift_type_id=${filterType}` : ''}`).then((r) => r.data),
  });

  const { data: shiftTypes = [] } = useQuery<any[]>({
    queryKey: ['shift-types-config'],
    queryFn: () => api.get('/shifts/types').then((r) => r.data),
  });

  const upd = (patch: Partial<ScheduleForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };

  const openNew = () => { setForm(emptyForm()); setEditingId(null); setDirty(false); setMode('form'); };
  const openEdit = (s: ShiftSchedule) => {
    setForm({
      name: s.name,
      shift_type_id: String(s.shift_type_id),
      frequency_weeks: String(s.frequency_weeks),
      days: s.days.length ? [...s.days] : [1],
    });
    setEditingId(s.id);
    setDirty(false);
    setMode('form');
  };
  const close = () => { setMode('list'); setEditingId(null); setDirty(false); };

  const saveMutation = useMutation({
    mutationFn: (payload: any) =>
      editingId ? api.put(`/shifts/schedules/${editingId}`, payload) : api.post('/shifts/schedules', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shift-schedules'] });
      toast.success(editingId ? 'Shift schedule updated' : 'Shift schedule created');
      close();
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to save shift schedule'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/shifts/schedules/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shift-schedules'] });
      toast.success('Shift schedule deleted');
      setConfirmDel(null);
    },
    onError: (err: any) => { toast.error(err.response?.data?.error || 'Failed to delete'); setConfirmDel(null); },
  });

  // ── Repeat On Days child-table helpers ──
  const addDayRow = () => {
    // default a new row to the first weekday not already chosen (fallback Monday)
    const used = new Set(form.days);
    const next = DAYS.find((d) => !used.has(d.i))?.i ?? 1;
    upd({ days: [...form.days, next] });
  };
  const setDayRow = (idx: number, value: number) => {
    upd({ days: form.days.map((d, i) => (i === idx ? value : d)) });
  };
  const removeDayRow = (idx: number) => {
    upd({ days: form.days.filter((_, i) => i !== idx) });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    if (!form.shift_type_id) { toast.error('Shift Type is required'); return; }
    if (form.days.length === 0) { toast.error('Add at least one weekday under Repeat On Days'); return; }
    if (new Set(form.days).size !== form.days.length) { toast.error('Repeat On Days has duplicate weekdays — remove the duplicates'); return; }
    saveMutation.mutate({
      name: form.name.trim(),
      shift_type_id: Number(form.shift_type_id),
      frequency_weeks: Number(form.frequency_weeks),
      days: form.days,
    });
  };

  return (
    <AppShell>
      <div className="space-y-6 max-w-3xl">
        <Breadcrumb items={[{ label: 'Shift Management' }, { label: 'Shift Schedule' }]} />

        {mode === 'list' ? (
          <>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-foreground">Shift Schedule</h1>
                <p className="text-secondary mt-1">Recurring patterns that assign a Shift Type on chosen weekdays.</p>
              </div>
              <button
                onClick={openNew}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shrink-0"
              >
                <Plus size={16} /> New Shift Schedule
              </button>
            </div>

            {/* Shift Type quick filter */}
            <div className="flex items-center gap-2">
              <label className="text-sm text-secondary">Shift Type</label>
              <select className="px-3 py-2 border border-border rounded-lg bg-background text-sm" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                <option value="">All</option>
                {shiftTypes.map((t: any) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            {isError ? (
              <LoadError message="Couldn't load shift schedules." onRetry={() => refetch()} />
            ) : schedules.length === 0 ? (
              <div className="bg-card rounded-xl border border-border p-10 text-center">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <CalendarClock className="w-6 h-6 text-primary" />
                </div>
                <p className="text-sm font-medium text-foreground">
                  {filterType ? 'No schedules for this shift type' : 'Create your first Shift Schedule'}
                </p>
                <p className="text-sm text-secondary mt-1">Define a recurring pattern of weekdays for a shift type.</p>
                {!filterType && (
                  <button
                    onClick={openNew}
                    className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
                  >
                    <Plus size={15} /> New Shift Schedule
                  </button>
                )}
              </div>
            ) : (
              <div className="bg-card rounded-xl border border-border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-secondary">
                        <th className="px-4 py-3 font-medium">Name</th>
                        <th className="px-4 py-3 font-medium">Shift Type</th>
                        <th className="px-4 py-3 font-medium">Frequency</th>
                        <th className="px-4 py-3 font-medium">Repeat On Days</th>
                        <th className="px-4 py-3 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {schedules.map((s) => (
                        <tr key={s.id} className="hover:bg-muted/30">
                          <td className="px-4 py-3 font-medium text-foreground">{s.name}</td>
                          <td className="px-4 py-3 text-secondary">{s.shift_name || '—'}</td>
                          <td className="px-4 py-3 text-secondary">{freqLabel(s.frequency_weeks)}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {s.days.map((d) => (
                                <span key={d} className="px-1.5 py-0.5 rounded bg-muted text-xs font-medium text-foreground">{dayShort(d)}</span>
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => openEdit(s)} className="p-1.5 rounded-lg text-secondary hover:text-foreground hover:bg-muted transition-colors" title="Edit">
                                <Pencil size={15} />
                              </button>
                              <button onClick={() => setConfirmDel(s)} className="p-1.5 rounded-lg text-secondary hover:text-red-600 hover:bg-red-50 transition-colors" title="Delete">
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
          </>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <div className="flex items-center gap-3">
              <button type="button" onClick={close} className="p-2 rounded-lg text-secondary hover:text-foreground hover:bg-muted transition-colors" title="Back">
                <ArrowLeft size={18} />
              </button>
              <h1 className="text-2xl font-bold text-foreground">{editingId ? 'Edit Shift Schedule' : 'New Shift Schedule'}</h1>
            </div>

            <div className="bg-card rounded-xl border border-border p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Name<span className="text-red-600"> *</span></label>
                <input className={inputCls} value={form.name} onChange={(e) => upd({ name: e.target.value })} placeholder="e.g. Weekday Mornings" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Shift Type<span className="text-red-600"> *</span></label>
                  <select className={inputCls} value={form.shift_type_id} onChange={(e) => upd({ shift_type_id: e.target.value })}>
                    <option value="">Select a shift type</option>
                    {shiftTypes.map((t: any) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Frequency<span className="text-red-600"> *</span></label>
                  <select className={inputCls} value={form.frequency_weeks} onChange={(e) => upd({ frequency_weeks: e.target.value })}>
                    {FREQUENCIES.map((f) => (
                      <option key={f.weeks} value={f.weeks}>{f.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Repeat On Days child table */}
            <div className="bg-card rounded-xl border border-border p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">Repeat On Days<span className="text-red-600"> *</span></h2>
                <button
                  type="button"
                  onClick={addDayRow}
                  disabled={form.days.length >= 7}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-sm font-medium hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Plus size={14} /> Add row
                </button>
              </div>
              {form.days.length === 0 ? (
                <p className="text-sm text-secondary">Add at least one weekday.</p>
              ) : (
                <div className="space-y-2">
                  {form.days.map((day, idx) => {
                    const dup = form.days.indexOf(day) !== idx;
                    return (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="text-xs text-secondary w-6 tabular-nums">{idx + 1}.</span>
                        <select
                          className={`${inputCls} ${dup ? 'border-red-500 ring-1 ring-red-500' : ''} max-w-xs`}
                          value={day}
                          onChange={(e) => setDayRow(idx, Number(e.target.value))}
                        >
                          {DAYS.map((d) => (
                            <option key={d.i} value={d.i}>{d.label}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => removeDayRow(idx)}
                          className="p-1.5 rounded-lg text-secondary hover:text-red-600 hover:bg-red-50 transition-colors"
                          title="Remove"
                        >
                          <X size={16} />
                        </button>
                        {dup && <span className="text-xs text-red-600">Duplicate</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={saveMutation.isPending}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {saveMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {editingId ? 'Save Changes' : 'Create Shift Schedule'}
              </button>
              <button type="button" onClick={close} className="px-5 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors">
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      <ConfirmDialog
        open={!!confirmDel}
        title="Delete shift schedule?"
        message={confirmDel ? <>This permanently removes <span className="font-medium text-foreground">{confirmDel.name}</span>.</> : undefined}
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
        onConfirm={() => confirmDel && deleteMutation.mutate(confirmDel.id)}
        onCancel={() => setConfirmDel(null)}
      />
    </AppShell>
  );
}
