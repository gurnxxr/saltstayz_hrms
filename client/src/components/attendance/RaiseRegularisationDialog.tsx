'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import { X, Loader2 } from 'lucide-react';

// Regularisation types the employee may pick (order shown in the form). "No Punch"
// is paid as a full-day LOP, like Absent — the server maps these to attendance status.
// Exported so the Regularisation page's list views label requests from the same source.
export const REG_TYPE_OPTIONS: [string, string][] = [
  ['np', 'No Punch'],
  ['mp', 'Miss Punch'],
  ['sp', 'Short Punch'],
  ['absent', 'Absent'],
  ['present', 'Present'],
];
export const TYPE_LABELS: Record<string, string> = Object.fromEntries(REG_TYPE_OPTIONS);

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
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    start_date: initialDate ?? '',
    end_date: initialDate ?? '',
    requested_status: '',
    reason: '',
  });

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
              {REG_TYPE_OPTIONS.map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">From<span className="text-red-600"> *</span></label>
              <input type="date" className={inputCls} value={form.start_date} max={today}
                onChange={(e) => onStartChange(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">To<span className="text-red-600"> *</span></label>
              <input type="date" className={inputCls} value={form.end_date} min={form.start_date || undefined} max={today}
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
