'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import Breadcrumb from '@/components/ui/Breadcrumb';
import LoadError from '@/components/ui/LoadError';
import { btnCls, inputCls, labelCls } from '@/components/ui/styles';
import api from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';
import { Info, Loader2 } from 'lucide-react';

export default function ApplyLeavePage() {
  const router = useRouter();
  const [form, setForm] = useState({
    leave_type_id: '',
    start_date: '',
    end_date: '',
    reason: '',
  });

  const { data: leaveTypes = [], isError: typesError, isLoading: typesLoading, refetch: refetchTypes } = useQuery({
    queryKey: ['leave-types'],
    queryFn: () => api.get('/leave/types').then(r => r.data),
  });

  const { data: balances = [], isError: balancesError, isLoading: balancesLoading, refetch: refetchBalances } = useQuery({
    queryKey: ['leave-balances'],
    queryFn: () => api.get('/leave/balances').then(r => r.data),
  });

  const applyMutation = useMutation({
    mutationFn: (data: typeof form) =>
      api.post('/leave/apply', { ...data, leave_type_id: Number(data.leave_type_id) }),
    onSuccess: (res: any) => {
      toast.success('Leave request submitted');
      // Non-blocking policy notes (e.g. a document is required for a long request).
      (res?.data?.warnings || []).forEach((w: string) => toast(w));
      router.push('/leaves/my');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to apply'),
  });

  const selectedBalance = balances.find((b: any) => String(b.leave_type_id) === form.leave_type_id);
  const remaining = selectedBalance ? selectedBalance.available : null;

  // The selected type's admin-configured rules, shown as a hint (server enforces them).
  const selectedType = leaveTypes.find((lt: any) => String(lt.id) === form.leave_type_id);
  const rules: string[] = [];
  if (selectedType) {
    const t = selectedType;
    if (t.min_days_per_request) rules.push(`Must be a continuous block of at least ${t.min_days_per_request} day(s)`);
    if (t.max_days_per_request) rules.push(`At most ${t.max_days_per_request} day(s) per request`);
    if (t.advance_notice_days) rules.push(`Apply at least ${t.advance_notice_days} day(s) in advance`);
    if (t.eligibility && t.eligibility !== 'any') rules.push(`${t.eligibility === 'female' ? 'Female' : 'Male'} employees only`);
    if (Array.isArray(t.department_names) && t.department_names.length) rules.push(`Available to the ${t.department_names.join(', ')} department(s)`);
    if (t.after_probation_only) rules.push('Available only after probation ends');
    if (t.half_day_allowed === false) rules.push('Half-days not allowed');
    if (t.count_sandwich_days) rules.push('Holidays / weekly-offs in between also count as leave');
    if (t.document_required_after_days) rules.push(`A supporting document is needed beyond ${t.document_required_after_days} day(s)`);
    if (Array.isArray(t.cannot_club_with) && t.cannot_club_with.length) {
      const names = t.cannot_club_with.map((id: number) => leaveTypes.find((x: any) => x.id === id)?.name).filter(Boolean);
      if (names.length) rules.push(`Can't be combined with ${names.join(', ')}`);
    }
  }

  // Mirrors the server's calculateLeaveDays (excludes Sundays only), so the applicant
  // and approver always see the same number.
  let estimatedDays = 0;
  if (form.start_date && form.end_date && new Date(form.start_date) <= new Date(form.end_date)) {
    const start = new Date(form.start_date);
    const end = new Date(form.end_date);
    const current = new Date(start);
    while (current <= end) {
      if (current.getDay() !== 0) estimatedDays++;
      current.setDate(current.getDate() + 1);
    }
  }

  // Enforce balance client-side too (the server also rejects), so submit is blocked up front.
  const insufficient = remaining !== null && estimatedDays > 0 && estimatedDays > remaining;

  return (
    <AppShell>
      <div className="max-w-2xl space-y-6">
        <div>
          {/* Was a hand-rolled "← Back to Leave" button — the exact thing Breadcrumb was written to
              replace, and the reason this page's header looked unlike every other leaves screen. */}
          <Breadcrumb className="mb-2" items={[{ label: 'Leaves', href: '/leaves/my' }, { label: 'Apply' }]} />
          <h1 className="text-2xl font-bold text-foreground">Apply for Leave</h1>
          <p className="text-secondary mt-1">Submit a new leave request to your manager</p>
        </div>

        {/* The ladder, in one place. A failed fetch used to show the error AND the form beneath it,
            with an empty leave-type <select> that could not be submitted — so the page offered a
            broken form instead of saying it could not be used yet. */}
        {typesError || balancesError ? (
          <LoadError message="Couldn't load leave types or balances." onRetry={() => { refetchTypes(); refetchBalances(); }} />
        ) : typesLoading || balancesLoading ? (
          <div className="bg-card rounded-xl border border-border p-10 flex justify-center">
            <Loader2 className="animate-spin text-secondary" />
          </div>
        ) : (
        <form
          onSubmit={(e) => { e.preventDefault(); applyMutation.mutate(form); }}
          className="bg-card rounded-xl border border-border p-6 space-y-5"
        >
          {/* Leave Type */}
          <div>
            <label className={labelCls}>Leave Type *</label>
            <select
              required
              value={form.leave_type_id}
              onChange={(e) => setForm(p => ({ ...p, leave_type_id: e.target.value }))}
              className={inputCls}
            >
              <option value="">Select leave type</option>
              {leaveTypes.map((lt: any) => (
                <option key={lt.id} value={lt.id}>{lt.name} ({lt.default_days} days/year)</option>
              ))}
            </select>
            {remaining !== null && (
              <p className={`text-xs mt-1.5 ${remaining <= 0 ? 'text-red-600' : 'text-secondary'}`}>
                Balance: {remaining} day{remaining !== 1 ? 's' : ''} remaining
              </p>
            )}
            {/*
              An accruing type needs to explain itself. "Balance: 4 days" on a leave the handbook
              calls twelve is the first thing an employee queries with HR, and the answer — you
              earn a share each month, here is when the next one lands — belongs beside the number
              rather than in a conversation.
            */}
            {selectedBalance?.source === 'accrual' && (
              <p className="text-xs mt-1 text-secondary">
                Earned so far this year: {Number(selectedBalance.accrued ?? 0).toFixed(2)} day
                {Number(selectedBalance.accrued) === 1 ? '' : 's'} — this leave is earned month by
                month, not given all at once.
                {selectedBalance.next_credit_on && <> Next credit on {formatDate(selectedBalance.next_credit_on)}.</>}
              </p>
            )}
            {/* The house info panel (attendance/settings), not the blue one this page had grown —
                blue-50 is used as an information surface nowhere else in the module. */}
            {rules.length > 0 && (
              <div className="mt-2 flex gap-2 rounded-lg bg-muted/50 border border-border p-3">
                <Info size={14} className="text-secondary shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground mb-1">Rules for {selectedType.name}</p>
                  <ul className="list-disc pl-4 space-y-0.5 text-xs text-secondary">
                    {rules.map((r) => <li key={r}>{r}</li>)}
                  </ul>
                </div>
              </div>
            )}
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Start Date *</label>
              <input
                type="date"
                required
                value={form.start_date}
                onChange={(e) => setForm(p => ({ ...p, start_date: e.target.value }))}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>End Date *</label>
              <input
                type="date"
                required
                value={form.end_date}
                min={form.start_date}
                onChange={(e) => setForm(p => ({ ...p, end_date: e.target.value }))}
                className={inputCls}
              />
            </div>
          </div>

          {/* Red stays — it is a blocking condition and the submit button is disabled with it.
              The other half was blue for no reason; it is the neutral info surface now. */}
          {estimatedDays > 0 && (
            <div className={`flex flex-wrap items-center gap-x-2 px-3 py-2 rounded-lg border text-sm ${insufficient ? 'bg-red-50 border-red-200 text-red-700' : 'bg-muted/50 border-border text-foreground'}`}>
              <span className="font-medium">{estimatedDays} working day{estimatedDays > 1 ? 's' : ''}</span>
              {insufficient
                ? <span>exceeds your {remaining} remaining day{remaining !== 1 ? 's' : ''} — reduce the range or pick another leave type.</span>
                : <span className="text-secondary">(excluding Sundays)</span>}
            </div>
          )}

          {/* Reason */}
          <div>
            <label className={labelCls}>Reason *</label>
            <textarea
              required
              rows={3}
              value={form.reason}
              onChange={(e) => setForm(p => ({ ...p, reason: e.target.value }))}
              placeholder="Provide a reason for your leave request..."
              className={cn(inputCls, 'resize-none')}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={applyMutation.isPending || insufficient}
              className={btnCls('primary', 'lg')}
            >
              {applyMutation.isPending && <Loader2 size={14} className="animate-spin" />}
              {applyMutation.isPending ? 'Submitting…' : 'Submit Request'}
            </button>
            <button type="button" onClick={() => router.push('/leaves/my')} className={btnCls('secondary', 'lg')}>
              Cancel
            </button>
          </div>
        </form>
        )}
      </div>
    </AppShell>
  );
}
