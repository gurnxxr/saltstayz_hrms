'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import Breadcrumb from '@/components/ui/Breadcrumb';
import LoadError from '@/components/ui/LoadError';
import api from '@/lib/api';
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning';
import { cutoffDateFor, fmtDeadline, localToday } from '@/lib/regularisation';
import { REG_TYPE_OPTIONS } from '@/components/attendance/RaiseRegularisationDialog';
import { SlidersHorizontal, Info, Save, Loader2, AlertTriangle } from 'lucide-react';

const inputCls = 'w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';

interface Settings {
  cutoff_days_after_month_end: number | null;
  monthly_request_limit: number;
  max_range_days: number;
  allowed_types: string[];
  /** The server's business date. Not a setting — see the controller for why it rides along. */
  today: string;
}

// The deadline is held as a string so the field can be genuinely EMPTY. Storing it as a number
// would collapse "no deadline" and "0 days" into each other at the first blur, and they mean
// opposite things: 0 is the strictest setting there is, null is no deadline at all.
interface Edit {
  cutoff: string;
  monthly_request_limit: number;
  max_range_days: number;
  allowed_types: string[];
}

const toEdit = (s: Settings): Edit => ({
  cutoff: s.cutoff_days_after_month_end == null ? '' : String(s.cutoff_days_after_month_end),
  monthly_request_limit: s.monthly_request_limit,
  max_range_days: s.max_range_days,
  allowed_types: [...s.allowed_types],
});

const same = (a: Edit, b: Edit) =>
  a.cutoff === b.cutoff &&
  a.monthly_request_limit === b.monthly_request_limit &&
  a.max_range_days === b.max_range_days &&
  a.allowed_types.length === b.allowed_types.length &&
  a.allowed_types.every((t) => b.allowed_types.includes(t));

export default function RegularisationSettingsPage() {
  const qc = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery<Settings>({
    queryKey: ['regularisation-settings'],
    queryFn: () => api.get('/regularisation/settings').then((r) => r.data),
  });

  // The server's own date, so the "corrections for August close on …" preview names the day the
  // server would actually enforce. Computing it here from `toISOString()` would be the UTC day,
  // which on IST is still yesterday until 05:30 — and on the 1st of a month that previews the
  // WRONG MONTH's deadline to the admin setting the policy.
  const today = data?.today ?? localToday();

  const [edit, setEdit] = useState<Edit | null>(null);
  const [base, setBase] = useState<Edit | null>(null);

  useEffect(() => {
    if (!data) return;
    setEdit(toEdit(data));
    setBase(toEdit(data));
  }, [data]);

  const dirty = !!edit && !!base && !same(edit, base);
  useUnsavedChangesWarning(dirty);

  const save = useMutation({
    mutationFn: () => api.put('/regularisation/settings', {
      // '' is sent through as null on purpose — the service reads the KEY being present as
      // "the admin set this", so an empty field is how the deadline gets switched off.
      cutoff_days_after_month_end: edit!.cutoff === '' ? null : Number(edit!.cutoff),
      monthly_request_limit: edit!.monthly_request_limit,
      max_range_days: edit!.max_range_days,
      allowed_types: edit!.allowed_types,
    }).then((r) => r.data),
    onSuccess: () => {
      toast.success('Regularisation settings saved');
      qc.invalidateQueries({ queryKey: ['regularisation-settings'] });
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to save'),
  });

  const set = (patch: Partial<Edit>) => setEdit((p) => (p ? { ...p, ...patch } : p));

  const toggleType = (code: string) => {
    if (!edit) return;
    const on = edit.allowed_types.includes(code);
    // Refuse to empty the list here rather than letting the server bounce it: with no types on
    // offer the request form has nothing to select and regularisation is switched off by accident.
    if (on && edit.allowed_types.length === 1) {
      toast.error('At least one type must stay available, otherwise nobody can raise a correction.');
      return;
    }
    set({ allowed_types: on ? edit.allowed_types.filter((t) => t !== code) : [...edit.allowed_types, code] });
  };

  // Worked example against the CURRENT month, so the admin sees what the number they typed
  // actually means before they save it rather than discovering it from a refused request.
  const cutoffNum = edit && edit.cutoff !== '' ? Number(edit.cutoff) : null;
  const preview = cutoffNum != null && Number.isInteger(cutoffNum) && cutoffNum >= 0 && cutoffNum <= 31
    ? fmtDeadline(cutoffDateFor(today, cutoffNum))
    : null;
  const thisMonth = new Date(`${today}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <AppShell>
      <div className="space-y-6 max-w-3xl">
        <div>
          <Breadcrumb className="mb-2" items={[{ label: 'Attendance' }, { label: 'Regularisation Settings' }]} />
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <SlidersHorizontal size={22} /> Regularisation Settings
          </h1>
          <p className="text-secondary mt-1">
            The rules every attendance correction is judged by, org-wide.
          </p>
        </div>

        {isError ? (
          <LoadError message="Couldn't load regularisation settings." onRetry={() => refetch()} />
        ) : isLoading || !edit ? (
          <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-secondary" /></div>
        ) : (
          <>
            {/* Deadline */}
            <div className="bg-card rounded-xl border border-border p-6 space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Correction deadline</h2>
                <p className="text-sm text-secondary mt-1">
                  How long after an attendance month ends employees may still ask for it to be corrected.
                </p>
              </div>

              <div className="flex items-end gap-3 flex-wrap">
                <div className="w-56">
                  <label className="block text-sm font-medium text-foreground mb-1">Days after month end</label>
                  <input
                    type="number" min={0} max={31} className={inputCls}
                    value={edit.cutoff}
                    placeholder="No deadline"
                    onChange={(e) => set({ cutoff: e.target.value })}
                  />
                </div>
                {edit.cutoff !== '' && (
                  <button
                    onClick={() => set({ cutoff: '' })}
                    className="px-3 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
                  >
                    Remove deadline
                  </button>
                )}
              </div>

              <div className="rounded-lg bg-muted/50 border border-border p-3 text-sm text-secondary flex gap-2">
                <Info size={15} className="shrink-0 mt-0.5" />
                {edit.cutoff === '' ? (
                  <p>
                    <span className="text-foreground font-medium">No deadline.</span> Any month can be corrected for
                    as long as its payroll has not been locked — which for an unlocked month means indefinitely.
                  </p>
                ) : preview ? (
                  <p>
                    Corrections for <span className="text-foreground font-medium">{thisMonth}</span> close on{' '}
                    <span className="text-foreground font-medium">{preview}</span>.
                    {cutoffNum === 0 && ' A deadline of 0 means the month must be corrected before it ends.'}
                  </p>
                ) : (
                  <p>Enter a whole number of days between 0 and 31, or leave it blank for no deadline.</p>
                )}
              </div>

              <p className="text-xs text-secondary">
                Checked when a request is <span className="text-foreground font-medium">raised</span>, never when it is
                approved — so a request filed in time still goes through even if its approver takes a week to look at it.
              </p>
            </div>

            {/* Limits */}
            <div className="bg-card rounded-xl border border-border p-6 space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Limits</h2>
                <p className="text-sm text-secondary mt-1">How much one employee may correct.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Requests per month</label>
                  <input
                    type="number" min={1} max={31} className={inputCls}
                    value={edit.monthly_request_limit}
                    onChange={(e) => set({ monthly_request_limit: Number(e.target.value) })}
                  />
                  <p className="text-xs text-secondary mt-1">
                    Counts pending and approved requests touching an attendance month. A request can cover
                    a range, so this caps requests rather than days.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Longest range (days)</label>
                  <input
                    type="number" min={1} max={31} className={inputCls}
                    value={edit.max_range_days}
                    onChange={(e) => set({ max_range_days: Number(e.target.value) })}
                  />
                  <p className="text-xs text-secondary mt-1">
                    How many days one request may cover. Capped at 31 so a request can never span more
                    than two months.
                  </p>
                </div>
              </div>
            </div>

            {/* Types */}
            <div className="bg-card rounded-xl border border-border p-6 space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground">What an employee may ask for</h2>
                <p className="text-sm text-secondary mt-1">
                  The options offered on the request form. Turning one off does not affect requests already raised.
                </p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {REG_TYPE_OPTIONS.map(([code, label]) => {
                  const on = edit.allowed_types.includes(code);
                  return (
                    <button
                      key={code}
                      onClick={() => toggleType(code)}
                      className={`px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors text-left ${
                        on ? 'border-primary bg-primary/5 text-foreground' : 'border-border text-secondary hover:bg-muted'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900 flex gap-2">
                <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                <p>
                  <span className="font-medium">&quot;Absent&quot; is not offered and cannot be added.</span> An approved
                  regularisation is paid in full, so allowing it would let someone be paid for a day they
                  themselves said they did not work.
                </p>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => save.mutate()}
                disabled={!dirty || save.isPending}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {save.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                Save settings
              </button>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
