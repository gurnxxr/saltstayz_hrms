'use client';

import { useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import Breadcrumb from '@/components/ui/Breadcrumb';
import LoadError from '@/components/ui/LoadError';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import api from '@/lib/api';
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning';
import { Plus, Clock, Pencil, Trash2, ArrowLeft, Save, Loader2, Info, Moon } from 'lucide-react';

const ROSTER_COLORS: { name: string; hex: string }[] = [
  { name: 'Blue', hex: '#3b82f6' },
  { name: 'Cyan', hex: '#06b6d4' },
  { name: 'Fuchsia', hex: '#d946ef' },
  { name: 'Green', hex: '#22c55e' },
  { name: 'Lime', hex: '#84cc16' },
  { name: 'Orange', hex: '#f97316' },
  { name: 'Pink', hex: '#ec4899' },
  { name: 'Red', hex: '#ef4444' },
  { name: 'Violet', hex: '#8b5cf6' },
  { name: 'Yellow', hex: '#eab308' },
];
const colorHex = (name: string) => ROSTER_COLORS.find((c) => c.name === name)?.hex ?? '#3b82f6';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const inputCls =
  'w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';

/** An off day, and optionally which occurrences of it in the month (null = every week). */

interface ShiftTypeForm {
  name: string;
  effective_from: string;
  roster_color: string;
  start_time: string;
  end_time: string;
  ends_next_day: boolean;
  office_hour_time: string;
  max_early_in_mins: string;
  max_late_out_mins: string;
  force_time_out: string;
  grace_enabled: boolean;
  late_in_grace_mins: string;
  early_out_grace_mins: string;
  grace_occurrences_per_month: string;
  enable_auto_attendance: boolean;
  attendance_basis: string;
  absent_hours: string;
  half_day_hours: string;
  full_day_hours: string;
  consider_na: string;
  allow_overtime: boolean;
  overtime_after_hours: string;
  monthly_adjustment: string;
}

const todayStr = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const emptyForm = (): ShiftTypeForm => ({
  name: '',
  effective_from: todayStr(),
  roster_color: 'Blue',
  start_time: '',
  end_time: '',
  ends_next_day: false,
  office_hour_time: '',
  max_early_in_mins: '60',
  max_late_out_mins: '60',
  force_time_out: '',
  grace_enabled: false,
  late_in_grace_mins: '0',
  early_out_grace_mins: '0',
  grace_occurrences_per_month: '0',
  enable_auto_attendance: false,
  attendance_basis: 'first_last',
  absent_hours: '0',
  half_day_hours: '0',
  full_day_hours: '0',
  consider_na: '',
  allow_overtime: false,
  overtime_after_hours: '0',
  monthly_adjustment: '',
});

function hydrate(row: any): ShiftTypeForm {
  // `row.weekly_off_days` is deliberately not read. A shift's own off days are rung 1 of the
  // engine's ladder and OVERRIDE the employee's leave template, which is where this business
  // actually sets rest days — so this screen no longer offers them. The stored value is left
  // alone rather than cleared: the save payload simply omits the key, and shift.service only
  // writes the column when it is present.
  return {
    name: row.name ?? '',
    // Deliberately NOT defaulted to today. Almost every existing shift has no effective date,
    // and stamping one on open-and-save would silently make the shift start today — which then
    // refuses any assignment backdated to cover the month being set up, the exact thing the
    // rollout asks HR to do.
    effective_from: (row.effective_from ?? '').slice(0, 10),
    roster_color: row.roster_color ?? 'Blue',
    start_time: (row.start_time ?? '').slice(0, 5),
    end_time: (row.end_time ?? '').slice(0, 5),
    ends_next_day: !!row.ends_next_day,
    office_hour_time: (row.office_hour_time ?? '').slice(0, 5),
    max_early_in_mins: String(row.max_early_in_mins ?? 60),
    max_late_out_mins: String(row.max_late_out_mins ?? 60),
    force_time_out: (row.force_time_out ?? '').slice(0, 5),
    grace_enabled: !!row.grace_enabled,
    late_in_grace_mins: String(row.late_in_grace_mins ?? 0),
    early_out_grace_mins: String(row.early_out_grace_mins ?? 0),
    grace_occurrences_per_month: String(row.grace_occurrences_per_month ?? 0),
    enable_auto_attendance: !!row.enable_auto_attendance,
    attendance_basis: row.attendance_basis ?? 'first_last',
    absent_hours: String(row.absent_hours ?? 0),
    half_day_hours: String(row.half_day_hours ?? 0),
    full_day_hours: String(row.full_day_hours ?? 0),
    consider_na: row.consider_na ?? '',
    allow_overtime: !!row.allow_overtime,
    overtime_after_hours: String(row.overtime_after_hours ?? 0),
    monthly_adjustment: row.monthly_adjustment != null ? String(row.monthly_adjustment) : '',
  };
}

// ── Small presentational helpers ──
function Field({ label, required, help, children }: { label: string; required?: boolean; help?: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </label>
      {children}
      {help && <p className="text-xs text-secondary mt-1">{help}</p>}
    </div>
  );
}

function CheckboxField({ checked, onChange, label, help }: { checked: boolean; onChange: (v: boolean) => void; label: string; help?: string }) {
  return (
    <label className="flex items-start gap-2.5 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-primary/50"
      />
      <span>
        <span className="text-sm font-medium text-foreground">{label}</span>
        {help && <span className="block text-xs text-secondary mt-0.5">{help}</span>}
      </span>
    </label>
  );
}

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="bg-card rounded-xl border border-border p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {subtitle && <p className="text-xs text-secondary mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

/** Marks a field that is stored and shown but doesn't yet affect anyone's pay. */
function NotYetApplied() {
  return (
    <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 align-middle">
      <Info size={10} /> not applied yet
    </span>
  );
}

export default function ShiftTypePage() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'list' | 'form'>('list');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ShiftTypeForm>(emptyForm());
  const [dirty, setDirty] = useState(false);
  const [confirmDel, setConfirmDel] = useState<any | null>(null);

  useUnsavedChangesWarning(mode === 'form' && dirty);

  const { data: shiftTypes = [], isError, refetch } = useQuery({
    queryKey: ['shift-types'],
    queryFn: () => api.get('/shifts/types').then((r) => r.data),
  });

  const upd = (patch: Partial<ShiftTypeForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };

  const openNew = () => { setForm(emptyForm()); setEditingId(null); setDirty(false); setMode('form'); };
  const openEdit = (row: any) => { setForm(hydrate(row)); setEditingId(row.id); setDirty(false); setMode('form'); };
  const closeForm = () => { setMode('list'); setEditingId(null); setDirty(false); };

  const saveMutation = useMutation({
    mutationFn: (payload: any) =>
      editingId ? api.put(`/shifts/types/${editingId}`, payload) : api.post('/shifts/types', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shift-types'] });
      toast.success(editingId ? 'Shift type updated' : 'Shift type created');
      closeForm();
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to save shift type'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/shifts/types/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shift-types'] });
      toast.success('Shift type deleted');
      setConfirmDel(null);
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Failed to delete shift type');
      setConfirmDel(null);
    },
  });

  // An end at or before the start can only mean the shift runs past midnight.
  const impliesNextDay = !!form.start_time && !!form.end_time && form.end_time <= form.start_time;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.start_time || !form.end_time) {
      toast.error('Name, start time and end time are required');
      return;
    }
    if (impliesNextDay && !form.ends_next_day) {
      toast.error('This shift ends at or before it starts, so "ends next day" must be on');
      return;
    }
    const num = (s: string) => (Number.isFinite(Number(s)) ? Number(s) : 0);
    const absent = num(form.absent_hours), half = num(form.half_day_hours), full = num(form.full_day_hours);
    if (absent > 0 && half > 0 && absent >= half) {
      toast.error('Absent hours must be less than half-day hours');
      return;
    }
    if (half > 0 && full > 0 && half >= full) {
      toast.error('Half-day hours must be less than full-day hours');
      return;
    }

    saveMutation.mutate({
      name: form.name.trim(),
      effective_from: form.effective_from || null,
      roster_color: form.roster_color,
      start_time: form.start_time,
      end_time: form.end_time,
      ends_next_day: form.ends_next_day,
      // No `weekly_off_days`. Omitting the key leaves whatever is stored untouched —
      // shift.service only writes the column when the field is present in the payload.
      office_hour_time: form.office_hour_time || null,
      max_early_in_mins: num(form.max_early_in_mins),
      max_late_out_mins: num(form.max_late_out_mins),
      force_time_out: form.force_time_out || null,
      grace_enabled: form.grace_enabled,
      late_in_grace_mins: form.grace_enabled ? num(form.late_in_grace_mins) : 0,
      early_out_grace_mins: form.grace_enabled ? num(form.early_out_grace_mins) : 0,
      grace_occurrences_per_month: form.grace_enabled ? num(form.grace_occurrences_per_month) : 0,
      enable_auto_attendance: form.enable_auto_attendance,
      attendance_basis: form.attendance_basis,
      absent_hours: absent,
      half_day_hours: half,
      full_day_hours: full,
      consider_na: form.consider_na || null,
      allow_overtime: form.allow_overtime,
      overtime_after_hours: form.allow_overtime ? num(form.overtime_after_hours) : 0,
      monthly_adjustment: form.monthly_adjustment || null,
    });
  };

  return (
    <AppShell>
      <div className="space-y-6 max-w-4xl">
        <Breadcrumb items={[{ label: 'Shift Management' }, { label: 'Shift Type' }]} />

        {mode === 'list' ? (
          <>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-foreground">Shift Type</h1>
                <p className="text-secondary mt-1">
                  Each shift carries its own rules — timings, grace and hour thresholds. Employees are then mapped to a shift. Off days come from their leave template, not from here.
                </p>
              </div>
              <button
                onClick={openNew}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shrink-0"
              >
                <Plus size={16} /> New Shift Type
              </button>
            </div>

            {isError ? (
              <LoadError message="Couldn't load shift types." onRetry={() => refetch()} />
            ) : shiftTypes.length === 0 ? (
              <div className="bg-card rounded-xl border border-border p-10 text-center">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <Clock className="w-6 h-6 text-primary" />
                </div>
                <p className="text-sm font-medium text-foreground">No shift types yet</p>
                <p className="text-sm text-secondary mt-1">Create your first shift (e.g. Morning, Night) to start assigning employees.</p>
                <button
                  onClick={openNew}
                  className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
                >
                  <Plus size={15} /> New Shift Type
                </button>
              </div>
            ) : (
              <div className="bg-card rounded-xl border border-border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-secondary">
                        <th className="px-4 py-3 font-medium">Name</th>
                        <th className="px-4 py-3 font-medium">Timing</th>
                        <th className="px-4 py-3 font-medium">Hours (A/H/F)</th>
                        <th className="px-4 py-3 font-medium">Overtime</th>
                        <th className="px-4 py-3 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {shiftTypes.map((s: any) => (
                        <tr key={s.id} className="hover:bg-muted/30">
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colorHex(s.roster_color) }} />
                              <span className="font-medium text-foreground">{s.name}</span>
                              {!s.is_active && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-secondary">inactive</span>
                              )}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-secondary whitespace-nowrap">
                            {(s.start_time ?? '').slice(0, 5)} – {(s.end_time ?? '').slice(0, 5)}
                            {s.ends_next_day && (
                              <span className="ml-1.5 inline-flex items-center gap-0.5 text-[11px] text-purple-600" title="Ends the next day">
                                <Moon size={11} /> +1
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-secondary whitespace-nowrap">
                            {Number(s.absent_hours) || 0} / {Number(s.half_day_hours) || 0} / {Number(s.full_day_hours) || 0}
                          </td>
                          <td className="px-4 py-3 text-secondary">
                            {s.allow_overtime ? `after ${Number(s.overtime_after_hours) || 0}h` : '—'}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => openEdit(s)}
                                className="p-1.5 rounded-lg text-secondary hover:text-foreground hover:bg-muted transition-colors"
                                title="Edit"
                              >
                                <Pencil size={15} />
                              </button>
                              <button
                                onClick={() => setConfirmDel(s)}
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
          </>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={closeForm}
                className="p-1.5 rounded-lg text-secondary hover:text-foreground hover:bg-muted transition-colors"
              >
                <ArrowLeft size={18} />
              </button>
              <h1 className="text-2xl font-bold text-foreground">
                {editingId ? 'Edit Shift Type' : 'New Shift Type'}
              </h1>
            </div>

            <SectionCard title="Shift">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Field label="Shift name" required>
                  <input className={inputCls} value={form.name} onChange={(e) => upd({ name: e.target.value })} placeholder="e.g. Morning" />
                </Field>
                <Field label="Effective date" help="Attendance is judged by these rules from this date on.">
                  <input type="date" className={inputCls} value={form.effective_from} onChange={(e) => upd({ effective_from: e.target.value })} />
                </Field>
                <Field label="Colour">
                  <select className={inputCls} value={form.roster_color} onChange={(e) => upd({ roster_color: e.target.value })}>
                    {ROSTER_COLORS.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                  </select>
                </Field>
              </div>
            </SectionCard>

            <SectionCard title="Timing">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Field label="Start time" required>
                  <input type="time" className={inputCls} value={form.start_time} onChange={(e) => upd({ start_time: e.target.value })} />
                </Field>
                <Field label="End time" required>
                  <input type="time" className={inputCls} value={form.end_time} onChange={(e) => upd({ end_time: e.target.value })} />
                </Field>
                <Field label="Office hour time" help="Expected paid hours in a normal day, if breaks make it shorter than start to end.">
                  <input type="time" className={inputCls} value={form.office_hour_time} onChange={(e) => upd({ office_hour_time: e.target.value })} />
                </Field>
              </div>
              <CheckboxField
                checked={form.ends_next_day}
                onChange={(v) => upd({ ends_next_day: v })}
                label="Ends the next day"
                help="For a shift running past midnight, like 22:00 to 06:00. This decides which day the hours count towards."
              />
              {impliesNextDay && !form.ends_next_day && (
                <p className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <Info size={13} className="mt-0.5 shrink-0" />
                  This shift ends at or before it starts, so it must end the next day.
                </p>
              )}
            </SectionCard>

            {/* No off-day picker here. Off days come from the employee's leave template
                (Leaves → Control Panel → Templates), which is the rung the engine reads for
                everyone. A pattern set on the shift would override that template silently. */}

            <SectionCard title="Punch limits" subtitle="How far outside the shift a punch still counts towards the day.">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Field label="Maximum early-in punch" help="Minutes before the start time.">
                  <input type="number" min={0} className={inputCls} value={form.max_early_in_mins} onChange={(e) => upd({ max_early_in_mins: e.target.value })} />
                </Field>
                <Field label="Maximum late-out punch" help="Minutes after the end time.">
                  <input type="number" min={0} className={inputCls} value={form.max_late_out_mins} onChange={(e) => upd({ max_late_out_mins: e.target.value })} />
                </Field>
                <Field label="Force time out" help="Close off a day with no punch-out at this time.">
                  <input type="time" className={inputCls} value={form.force_time_out} onChange={(e) => upd({ force_time_out: e.target.value })} />
                </Field>
              </div>
              <p className="text-xs text-secondary">
                Force time out is stored and shown but does not affect pay yet.<NotYetApplied />
              </p>
            </SectionCard>

            <SectionCard title="Grace">
              <CheckboxField
                checked={form.grace_enabled}
                onChange={(v) => upd({ grace_enabled: v })}
                label="Allow a grace period"
                help="Lets someone arrive late or leave early by a few minutes without it counting against them."
              />
              {form.grace_enabled && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Field label="Late-in grace" help="Minutes.">
                    <input type="number" min={0} className={inputCls} value={form.late_in_grace_mins} onChange={(e) => upd({ late_in_grace_mins: e.target.value })} />
                  </Field>
                  <Field label="Early-out grace" help="Minutes.">
                    <input type="number" min={0} className={inputCls} value={form.early_out_grace_mins} onChange={(e) => upd({ early_out_grace_mins: e.target.value })} />
                  </Field>
                  <Field label="Allowed occurrences per month" help="0 means unlimited.">
                    <input type="number" min={0} className={inputCls} value={form.grace_occurrences_per_month} onChange={(e) => upd({ grace_occurrences_per_month: e.target.value })} />
                  </Field>
                </div>
              )}
            </SectionCard>

            <SectionCard title="Attendance">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Attendance based on" help="How the day's in and out are picked from the punches.">
                  <select className={inputCls} value={form.attendance_basis} onChange={(e) => upd({ attendance_basis: e.target.value })}>
                    <option value="first_last">First and last punch of the day</option>
                    <option value="every_valid">Every valid in/out pair</option>
                  </select>
                </Field>
                <Field label="Consider NA" help="A day with no attendance record at all. Leave blank to use the company setting.">
                  <select className={inputCls} value={form.consider_na} onChange={(e) => upd({ consider_na: e.target.value })}>
                    <option value="">Use the company setting</option>
                    <option value="present">Count as present</option>
                    <option value="absent">Count as absent</option>
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Field label="Absent hours" help="Below this, the day doesn't count.">
                  <input type="number" min={0} step="0.5" className={inputCls} value={form.absent_hours} onChange={(e) => upd({ absent_hours: e.target.value })} />
                </Field>
                <Field label="Half-day hours" help="Below this, half a day.">
                  <input type="number" min={0} step="0.5" className={inputCls} value={form.half_day_hours} onChange={(e) => upd({ half_day_hours: e.target.value })} />
                </Field>
                <Field label="Full-day hours" help="At or above this, a full day.">
                  <input type="number" min={0} step="0.5" className={inputCls} value={form.full_day_hours} onChange={(e) => upd({ full_day_hours: e.target.value })} />
                </Field>
              </div>
              <CheckboxField
                checked={form.enable_auto_attendance}
                onChange={(v) => upd({ enable_auto_attendance: v })}
                label="Judge attendance automatically"
                help="Uses the hours above to decide full, half or absent once the day's attendance is uploaded."
              />
              {form.enable_auto_attendance && Number(form.absent_hours) === 0 && Number(form.half_day_hours) === 0 && (
                <p className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <Info size={13} className="mt-0.5 shrink-0" />
                  Set absent and half-day hours, otherwise there is nothing to judge against and days are left as they were uploaded.
                </p>
              )}
            </SectionCard>

            <SectionCard title="Overtime">
              <CheckboxField
                checked={form.allow_overtime}
                onChange={(v) => upd({ allow_overtime: v })}
                label="Allow overtime on this shift"
              />
              {form.allow_overtime && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="Overtime after hours" help="Hours worked beyond this count as overtime.">
                    <input type="number" min={0} step="0.5" className={inputCls} value={form.overtime_after_hours} onChange={(e) => upd({ overtime_after_hours: e.target.value })} />
                  </Field>
                </div>
              )}
            </SectionCard>

            <SectionCard title="Monthly adjustment">
              <Field label={'Monthly adjustment'} help="Stored and shown, but not applied to pay — confirm what this should mean first.">
                <input className={inputCls} value={form.monthly_adjustment} onChange={(e) => upd({ monthly_adjustment: e.target.value })} placeholder="e.g. 0" />
              </Field>
              <p className="text-xs text-secondary"><NotYetApplied /></p>
            </SectionCard>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={saveMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {saveMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                {editingId ? 'Save changes' : 'Create shift type'}
              </button>
              <button
                type="button"
                onClick={closeForm}
                className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      <ConfirmDialog
        open={!!confirmDel}
        title="Delete shift type?"
        message={confirmDel ? <>Delete <span className="font-medium text-foreground">{confirmDel.name}</span>? This can&apos;t be undone.</> : undefined}
        confirmLabel="Delete"
        danger
        loading={deleteMutation.isPending}
        onConfirm={() => confirmDel && deleteMutation.mutate(confirmDel.id)}
        onCancel={() => setConfirmDel(null)}
      />
    </AppShell>
  );
}
