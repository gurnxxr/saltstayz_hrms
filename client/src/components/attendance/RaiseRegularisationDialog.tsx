'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import { cutoffDateFor, earliestOpenDate, fmtDeadline, localToday } from '@/lib/regularisation';
import { X, Loader2, CalendarClock } from 'lucide-react';

// What the employee says the day actually WAS (order shown in the form). The server maps these
// onto an attendance status and pays an approved request in full — so every option here has to
// describe a day the person worked. "Absent" is deliberately absent from this list: asking to be
// marked absent is not a correction, and it would have been a route to being paid for a day you
// declared you did not work. Keep this in step with REG_TYPES in regularisation.service.ts.
export const REG_TYPE_OPTIONS: [string, string][] = [
  ['np', 'No Punch'],
  ['mp', 'Miss Punch'],
  ['sp', 'Short Punch'],
  ['present', 'Present'],
];
// Labels for the list views. Includes retired types so historical requests still read correctly
// rather than showing a raw code.
export const TYPE_LABELS: Record<string, string> = {
  ...Object.fromEntries(REG_TYPE_OPTIONS),
  absent: 'Absent (no longer requestable)',
};

const inputCls = 'w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';

/**
 * The form for raising an attendance regularisation. Shared by the Regularisation page's
 * "Raise request" button (opened empty) and the attendance calendar's per-day "Regularise
 * this day" action (opened with `initialDate` prefilling both From and To).
 *
 * The date fields stay editable even when prefilled, so someone who realises several days need
 * fixing can widen the range from a single-day start. All validation lives on the server; the
 * `max={today}` guards only mirror the "no future date" rule for a nicer client experience.
 */
export default function RaiseRegularisationDialog({ initialDate, onClose }: { initialDate?: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    start_date: initialDate ?? '',
    end_date: initialDate ?? '',
    requested_status: '',
    reason: '',
  });

  // The deadline the server will judge this request by. Read-only for everyone; it is the policy
  // the employee is already subject to, so showing it beats letting them find out by refusal.
  const { data: settings } = useQuery({
    queryKey: ['regularisation-settings'],
    queryFn: () => api.get('/regularisation/settings').then(r => r.data).catch(() => null),
  });
  const cutoffDays: number | null = settings?.cutoff_days_after_month_end ?? null;
  // The server's own date, so the picker's bounds are the ones the request will be judged by.
  // Working it out here instead would put a second clock in play: `toISOString()` is the UTC day,
  // which on IST is still yesterday until 05:30, and the picker would go on offering a month the
  // server had already closed. Falling back to the browser's LOCAL date — not UTC — for the brief
  // moment before the settings land, and for the offline case the query swallows.
  const today = settings?.today ?? localToday();
  const minDate = settings ? earliestOpenDate(cutoffDays, today) : undefined;

  const raiseMutation = useMutation({
    mutationFn: () => api.post('/regularisation', {
      start_date: form.start_date,
      end_date: form.end_date,
      requested_status: form.requested_status,
      reason: form.reason,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-regularisations'] });
      toast.success('Regularisation submitted for approval');
      onClose();
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to submit'),
  });

  const canSubmit = form.start_date && form.end_date && form.requested_status
    && form.reason.trim() && form.end_date >= form.start_date;

  // Keep end ≥ start: when start moves past end (or end is unset), pull end along.
  const onStartChange = (v: string) => setForm(p => ({
    ...p, start_date: v, end_date: (!p.end_date || p.end_date < v) ? v : p.end_date,
  }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card rounded-xl border border-border shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-base font-semibold text-foreground">Raise a regularisation</h3>
          <button onClick={onClose} className="p-1 rounded-lg text-secondary hover:text-foreground hover:bg-muted transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Regularise as<span className="text-red-600"> *</span></label>
            <select className={inputCls} value={form.requested_status}
              onChange={(e) => setForm(p => ({ ...p, requested_status: e.target.value }))}>
              <option value="">Select a type…</option>
              {/* Only what HR currently offers. Until the settings load we show the full list
                  rather than an empty dropdown — the server rejects anything withdrawn anyway. */}
              {REG_TYPE_OPTIONS
                .filter(([val]) => !settings || settings.allowed_types?.includes(val))
                .map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
            </select>
          </div>
          {/* The deadline, above the dates, because it is what decides whether a date is pickable. */}
          {settings && (
            <div className="flex gap-2 rounded-lg bg-muted/50 border border-border px-3 py-2 text-xs text-secondary">
              <CalendarClock size={14} className="shrink-0 mt-0.5" />
              {cutoffDays == null ? (
                <p>Any month can be corrected while its payroll is still open.</p>
              ) : form.start_date ? (
                <p>
                  Corrections for <span className="text-foreground font-medium">{form.start_date.slice(0, 7)}</span> close on{' '}
                  <span className="text-foreground font-medium">{fmtDeadline(cutoffDateFor(form.start_date, cutoffDays))}</span>.
                </p>
              ) : (
                <p>
                  Corrections close{' '}
                  <span className="text-foreground font-medium">
                    {cutoffDays === 0 ? 'on the last day of the attendance month' : `${cutoffDays} day${cutoffDays === 1 ? '' : 's'} after the attendance month ends`}
                  </span>
                  {minDate && <> — the earliest date you can still correct is <span className="text-foreground font-medium">{fmtDeadline(minDate)}</span>.</>}
                </p>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">From<span className="text-red-600"> *</span></label>
              <input type="date" className={inputCls} value={form.start_date} min={minDate} max={today}
                onChange={(e) => onStartChange(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">To<span className="text-red-600"> *</span></label>
              <input type="date" className={inputCls} value={form.end_date} min={form.start_date || minDate} max={today}
                onChange={(e) => setForm(p => ({ ...p, end_date: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Reason<span className="text-red-600"> *</span></label>
            <textarea rows={2} className={`${inputCls} resize-none`} value={form.reason}
              onChange={(e) => setForm(p => ({ ...p, reason: e.target.value }))}
              placeholder="e.g. Forgot to punch; biometric was down" />
          </div>
          <p className="text-xs text-secondary">On approval, your attendance for each day in the range is set to the selected status. Locked payroll months can&apos;t be regularised.</p>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors">
            Cancel
          </button>
          <button onClick={() => raiseMutation.mutate()} disabled={!canSubmit || raiseMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {raiseMutation.isPending && <Loader2 size={14} className="animate-spin" />} Submit
          </button>
        </div>
      </div>
    </div>
  );
}
