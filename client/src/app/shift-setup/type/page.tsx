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
import { Plus, Clock, Pencil, Trash2, ArrowLeft, Save, Loader2, Info } from 'lucide-react';

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

const OVERTIME_SUGGESTIONS = ['Standard', 'Weekend', 'Holiday', 'Night'];

const inputCls =
  'w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';

interface ShiftTypeForm {
  name: string;
  start_time: string;
  end_time: string;
  holiday_region_id: string;
  roster_color: string;
  enable_auto_attendance: boolean;
  determine_checkin_checkout: string;
  working_hours_calculation: string;
  begin_checkin_before_mins: string;
  allow_checkout_after_mins: string;
  mark_auto_attendance_on_holidays: boolean;
  half_day_threshold: string;
  absent_threshold: string;
  process_attendance_after: string;
  last_sync_of_checkin: string;
  auto_update_last_sync: boolean;
  enable_late_entry_marking: boolean;
  late_entry_grace_period: string;
  enable_early_exit_marking: boolean;
  early_exit_grace_period: string;
  allow_overtime: boolean;
  overtime_type: string;
}

const todayStr = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const emptyForm = (): ShiftTypeForm => ({
  name: '',
  start_time: '',
  end_time: '',
  holiday_region_id: '',
  roster_color: 'Blue',
  enable_auto_attendance: false,
  determine_checkin_checkout: 'alternating',
  working_hours_calculation: 'first_last',
  begin_checkin_before_mins: '60',
  allow_checkout_after_mins: '60',
  mark_auto_attendance_on_holidays: false,
  half_day_threshold: '0',
  absent_threshold: '0',
  process_attendance_after: todayStr(),
  last_sync_of_checkin: '',
  auto_update_last_sync: false,
  enable_late_entry_marking: false,
  late_entry_grace_period: '0',
  enable_early_exit_marking: false,
  early_exit_grace_period: '0',
  allow_overtime: false,
  overtime_type: '',
});

function hydrate(row: any): ShiftTypeForm {
  return {
    name: row.name ?? '',
    start_time: (row.start_time ?? '').slice(0, 5),
    end_time: (row.end_time ?? '').slice(0, 5),
    holiday_region_id: row.holiday_region_id != null ? String(row.holiday_region_id) : '',
    roster_color: row.roster_color ?? 'Blue',
    enable_auto_attendance: !!row.enable_auto_attendance,
    determine_checkin_checkout: row.determine_checkin_checkout ?? 'alternating',
    working_hours_calculation: row.working_hours_calculation ?? 'first_last',
    begin_checkin_before_mins: String(row.begin_checkin_before_mins ?? 60),
    allow_checkout_after_mins: String(row.allow_checkout_after_mins ?? 60),
    mark_auto_attendance_on_holidays: !!row.mark_auto_attendance_on_holidays,
    half_day_threshold: String(row.half_day_threshold ?? 0),
    absent_threshold: String(row.absent_threshold ?? 0),
    process_attendance_after: (row.process_attendance_after ?? '').slice(0, 10) || todayStr(),
    last_sync_of_checkin: row.last_sync_of_checkin ? String(row.last_sync_of_checkin).replace(' ', 'T').slice(0, 16) : '',
    auto_update_last_sync: !!row.auto_update_last_sync,
    enable_late_entry_marking: !!row.enable_late_entry_marking,
    late_entry_grace_period: String(row.late_entry_grace_period ?? 0),
    enable_early_exit_marking: !!row.enable_early_exit_marking,
    early_exit_grace_period: String(row.early_exit_grace_period ?? 0),
    allow_overtime: !!row.allow_overtime,
    overtime_type: row.overtime_type ?? '',
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

function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-card rounded-xl border border-border p-5 space-y-4">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </div>
  );
}

export default function ShiftTypePage() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'list' | 'form'>('list');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ShiftTypeForm>(emptyForm());
  const [dirty, setDirty] = useState(false);
  const [otError, setOtError] = useState(false);
  const [confirmDel, setConfirmDel] = useState<any | null>(null);

  useUnsavedChangesWarning(mode === 'form' && dirty);

  // Shared key with the Roster (both read /shifts/types) so a create/edit/delete
  // here refreshes the roster's shift dropdown too.
  const { data: shiftTypes = [], isError, refetch } = useQuery({
    queryKey: ['shift-types'],
    queryFn: () => api.get('/shifts/types').then((r) => r.data),
  });

  const { data: holidayLists = [] } = useQuery({
    queryKey: ['shift-holiday-lists'],
    queryFn: () => api.get('/shifts/types/holiday-lists').then((r) => r.data),
  });

  const upd = (patch: Partial<ShiftTypeForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };

  const openNew = () => {
    setForm(emptyForm());
    setEditingId(null);
    setDirty(false);
    setOtError(false);
    setMode('form');
  };
  const openEdit = (row: any) => {
    setForm(hydrate(row));
    setEditingId(row.id);
    setDirty(false);
    setOtError(false);
    setMode('form');
  };
  const closeForm = () => {
    setMode('list');
    setEditingId(null);
    setDirty(false);
    setOtError(false);
  };

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

  const toggleAuto = (v: boolean) =>
    upd({ enable_auto_attendance: v, ...(v && !form.process_attendance_after ? { process_attendance_after: todayStr() } : {}) });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.start_time || !form.end_time) {
      toast.error('Name, start time and end time are required');
      return;
    }
    if (form.allow_overtime && !form.overtime_type.trim()) {
      setOtError(true);
      toast.error('Overtime Type is required when overtime is allowed');
      return;
    }
    const num = (s: string) => (Number.isFinite(Number(s)) ? Number(s) : 0);
    const payload = {
      name: form.name.trim(),
      start_time: form.start_time,
      end_time: form.end_time,
      holiday_region_id: form.holiday_region_id || null,
      roster_color: form.roster_color,
      enable_auto_attendance: form.enable_auto_attendance,
      determine_checkin_checkout: form.determine_checkin_checkout,
      working_hours_calculation: form.working_hours_calculation,
      begin_checkin_before_mins: num(form.begin_checkin_before_mins),
      allow_checkout_after_mins: num(form.allow_checkout_after_mins),
      mark_auto_attendance_on_holidays: form.mark_auto_attendance_on_holidays,
      half_day_threshold: num(form.half_day_threshold),
      absent_threshold: num(form.absent_threshold),
      process_attendance_after: form.enable_auto_attendance ? form.process_attendance_after || null : null,
      last_sync_of_checkin: form.last_sync_of_checkin ? form.last_sync_of_checkin.replace('T', ' ') : null,
      auto_update_last_sync: form.auto_update_last_sync,
      enable_late_entry_marking: form.enable_late_entry_marking,
      late_entry_grace_period: num(form.late_entry_grace_period),
      enable_early_exit_marking: form.enable_early_exit_marking,
      early_exit_grace_period: num(form.early_exit_grace_period),
      allow_overtime: form.allow_overtime,
      overtime_type: form.allow_overtime ? form.overtime_type.trim() : null,
    };
    saveMutation.mutate(payload);
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
                <p className="text-secondary mt-1">Named work shifts with timing, attendance automation, and overtime rules.</p>
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
                        <th className="px-4 py-3 font-medium">Colour</th>
                        <th className="px-4 py-3 font-medium">Auto Attendance</th>
                        <th className="px-4 py-3 font-medium">Overtime</th>
                        <th className="px-4 py-3 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {shiftTypes.map((s: any) => (
                        <tr key={s.id} className="hover:bg-muted/30">
                          <td className="px-4 py-3 font-medium text-foreground">{s.name}</td>
                          <td className="px-4 py-3 text-secondary">
                            {(s.start_time ?? '').slice(0, 5)} – {(s.end_time ?? '').slice(0, 5)}
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: colorHex(s.roster_color) }} />
                              <span className="text-secondary">{s.roster_color || 'Blue'}</span>
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {s.enable_auto_attendance ? (
                              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">On</span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-secondary">Off</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-secondary">
                            {s.allow_overtime ? s.overtime_type || 'Yes' : '—'}
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
                className="p-2 rounded-lg text-secondary hover:text-foreground hover:bg-muted transition-colors"
                title="Back"
              >
                <ArrowLeft size={18} />
              </button>
              <h1 className="text-2xl font-bold text-foreground">{editingId ? 'Edit Shift Type' : 'New Shift Type'}</h1>
            </div>

            {/* Main */}
            <SectionCard title="Shift">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field label="Name" required>
                  <input className={inputCls} value={form.name} onChange={(e) => upd({ name: e.target.value })} placeholder="e.g. Morning" />
                </Field>
                <Field label="Start Time" required>
                  <input type="time" className={inputCls} value={form.start_time} onChange={(e) => upd({ start_time: e.target.value })} />
                </Field>
                <Field label="End Time" required>
                  <input type="time" className={inputCls} value={form.end_time} onChange={(e) => upd({ end_time: e.target.value })} />
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Holiday List" help="Region whose holidays this shift observes.">
                  <select className={inputCls} value={form.holiday_region_id} onChange={(e) => upd({ holiday_region_id: e.target.value })}>
                    <option value="">— None —</option>
                    {holidayLists.map((h: any) => (
                      <option key={h.id} value={h.id}>{h.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Roster Color">
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-9 rounded-lg border border-border shrink-0" style={{ backgroundColor: colorHex(form.roster_color) }} />
                    <select className={inputCls} value={form.roster_color} onChange={(e) => upd({ roster_color: e.target.value })}>
                      {ROSTER_COLORS.map((c) => (
                        <option key={c.name} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                </Field>
              </div>
              <CheckboxField
                checked={form.enable_auto_attendance}
                onChange={toggleAuto}
                label="Enable Auto Attendance"
                help="Attendance is marked automatically based on Employee Check-in for employees assigned to this shift."
              />
            </SectionCard>

            {/* Auto Attendance Settings */}
            {form.enable_auto_attendance && (
              <SectionCard title="Auto Attendance Settings">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Determine Check-in and Check-out">
                    <select className={inputCls} value={form.determine_checkin_checkout} onChange={(e) => upd({ determine_checkin_checkout: e.target.value })}>
                      <option value="alternating">Alternating entries as IN and OUT during the same shift</option>
                      <option value="log_type">Strictly based on Log Type in Employee Checkin</option>
                    </select>
                  </Field>
                  <Field label="Working Hours Calculation Based On">
                    <select className={inputCls} value={form.working_hours_calculation} onChange={(e) => upd({ working_hours_calculation: e.target.value })}>
                      <option value="first_last">First Check-in and Last Check-out</option>
                      <option value="every_valid">Every Valid Check-in and Check-out</option>
                    </select>
                  </Field>
                  <Field label="Begin check-in before shift start time (in minutes)" help="The time before the shift start time during which check-in is considered for attendance.">
                    <input type="number" min={0} className={inputCls} value={form.begin_checkin_before_mins} onChange={(e) => upd({ begin_checkin_before_mins: e.target.value })} />
                  </Field>
                  <Field label="Allow check-out after shift end time (in minutes)" help="The time after the shift end time during which check-out is considered for attendance.">
                    <input type="number" min={0} className={inputCls} value={form.allow_checkout_after_mins} onChange={(e) => upd({ allow_checkout_after_mins: e.target.value })} />
                  </Field>
                  <Field label="Working Hours Threshold for Half Day" help="Working hours below which Half Day is marked. Zero disables.">
                    <input type="number" min={0} step="0.5" className={inputCls} value={form.half_day_threshold} onChange={(e) => upd({ half_day_threshold: e.target.value })} />
                  </Field>
                  <Field label="Working Hours Threshold for Absent" help="Working hours below which Absent is marked. Zero disables.">
                    <input type="number" min={0} step="0.5" className={inputCls} value={form.absent_threshold} onChange={(e) => upd({ absent_threshold: e.target.value })} />
                  </Field>
                  <Field label="Process Attendance After" required help="Attendance is automatically marked only for dates after this day.">
                    <input type="date" className={inputCls} value={form.process_attendance_after} onChange={(e) => upd({ process_attendance_after: e.target.value })} />
                  </Field>
                  <Field label="Last Sync of Checkin (Asia/Kolkata)" help="Last known check-in that was processed. Changing this affects which check-ins are re-processed — edit with care.">
                    <input type="datetime-local" className={inputCls} value={form.last_sync_of_checkin} onChange={(e) => upd({ last_sync_of_checkin: e.target.value })} />
                  </Field>
                </div>
                <CheckboxField
                  checked={form.mark_auto_attendance_on_holidays}
                  onChange={(v) => upd({ mark_auto_attendance_on_holidays: v })}
                  label="Mark Auto Attendance on Holidays"
                />
                <CheckboxField
                  checked={form.auto_update_last_sync}
                  onChange={(v) => upd({ auto_update_last_sync: v })}
                  label="Automatically update Last Sync of Checkin"
                  help="Recommended when a single biometric device or mobile app feeds check-ins."
                />

                {/* Late Entry & Early Exit */}
                <div className="pt-2 border-t border-border space-y-4">
                  <h3 className="text-sm font-semibold text-foreground">Late Entry & Early Exit Settings for Auto Attendance</h3>
                  <CheckboxField
                    checked={form.enable_late_entry_marking}
                    onChange={(v) => upd({ enable_late_entry_marking: v })}
                    label="Enable Late Entry Marking"
                  />
                  {form.enable_late_entry_marking && (
                    <Field label="Late Entry Grace Period (in minutes)" help="Check-ins after the shift start plus this grace period are marked as a late entry.">
                      <input type="number" min={0} className={inputCls} value={form.late_entry_grace_period} onChange={(e) => upd({ late_entry_grace_period: e.target.value })} />
                    </Field>
                  )}
                  <CheckboxField
                    checked={form.enable_early_exit_marking}
                    onChange={(v) => upd({ enable_early_exit_marking: v })}
                    label="Enable Early Exit Marking"
                  />
                  {form.enable_early_exit_marking && (
                    <Field label="Early Exit Grace Period (in minutes)" help="Check-outs before the shift end minus this grace period are marked as an early exit.">
                      <input type="number" min={0} className={inputCls} value={form.early_exit_grace_period} onChange={(e) => upd({ early_exit_grace_period: e.target.value })} />
                    </Field>
                  )}
                </div>
              </SectionCard>
            )}

            {/* Overtime */}
            <SectionCard title="Overtime">
              <CheckboxField checked={form.allow_overtime} onChange={(v) => { upd({ allow_overtime: v }); if (!v) setOtError(false); }} label="Allow Overtime" />
              {form.allow_overtime && (
                <Field label="Overtime Type" required>
                  <input
                    className={`${inputCls} ${otError ? 'border-red-500 ring-1 ring-red-500' : ''}`}
                    value={form.overtime_type}
                    onChange={(e) => { upd({ overtime_type: e.target.value }); if (e.target.value.trim()) setOtError(false); }}
                    list="overtime-type-suggestions"
                    placeholder="e.g. Standard"
                  />
                  <datalist id="overtime-type-suggestions">
                    {OVERTIME_SUGGESTIONS.map((o) => <option key={o} value={o} />)}
                  </datalist>
                </Field>
              )}
            </SectionCard>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={saveMutation.isPending}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {saveMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {editingId ? 'Save Changes' : 'Create Shift Type'}
              </button>
              <button
                type="button"
                onClick={closeForm}
                className="px-5 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <span className="flex items-center gap-1.5 text-xs text-secondary ml-auto">
                <Info size={13} /> Fields marked <span className="text-red-600">*</span> are required.
              </span>
            </div>
          </form>
        )}
      </div>

      <ConfirmDialog
        open={!!confirmDel}
        title="Delete shift type?"
        message={confirmDel ? <>This permanently removes <span className="font-medium text-foreground">{confirmDel.name}</span>. Shift types in use by the roster or assignments can't be deleted.</> : undefined}
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
        onConfirm={() => confirmDel && deleteMutation.mutate(confirmDel.id)}
        onCancel={() => setConfirmDel(null)}
      />
    </AppShell>
  );
}
