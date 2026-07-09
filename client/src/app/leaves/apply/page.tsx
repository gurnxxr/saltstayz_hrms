'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import LoadError from '@/components/ui/LoadError';
import api from '@/lib/api';
import { ArrowLeft } from 'lucide-react';

export default function ApplyLeavePage() {
  const router = useRouter();
  const [form, setForm] = useState({
    leave_type_id: '',
    start_date: '',
    end_date: '',
    reason: '',
  });

  const { data: leaveTypes = [], isError: typesError, refetch: refetchTypes } = useQuery({
    queryKey: ['leave-types'],
    queryFn: () => api.get('/leave/types').then(r => r.data),
  });

  const { data: balances = [], isError: balancesError, refetch: refetchBalances } = useQuery({
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
  const remaining = selectedBalance ? selectedBalance.total_days - selectedBalance.used_days : null;

  // The selected type's admin-configured rules, shown as a hint (server enforces them).
  const selectedType = leaveTypes.find((lt: any) => String(lt.id) === form.leave_type_id);
  const rules: string[] = [];
  if (selectedType) {
    const t = selectedType;
    if (t.min_days_per_request) rules.push(`Must be a continuous block of at least ${t.min_days_per_request} day(s)`);
    if (t.max_days_per_request) rules.push(`At most ${t.max_days_per_request} day(s) per request`);
    if (t.advance_notice_days) rules.push(`Apply at least ${t.advance_notice_days} day(s) in advance`);
    if (t.eligibility && t.eligibility !== 'any') rules.push(`${t.eligibility === 'female' ? 'Female' : 'Male'} employees only`);
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
        <button
          onClick={() => router.push('/leaves/my')}
          className="flex items-center gap-2 text-secondary hover:text-foreground text-sm transition-colors"
        >
          <ArrowLeft size={16} />
          Back to Leave
        </button>

        <div>
          <h1 className="text-2xl font-bold text-foreground">Apply for Leave</h1>
          <p className="text-secondary mt-1">Submit a new leave request to your manager</p>
        </div>

        {(typesError || balancesError) && (
          <LoadError message="Couldn't load leave types or balances." onRetry={() => { refetchTypes(); refetchBalances(); }} />
        )}

        <form
          onSubmit={(e) => { e.preventDefault(); applyMutation.mutate(form); }}
          className="bg-card rounded-xl border border-border p-6 space-y-5"
        >
          {/* Leave Type */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Leave Type *</label>
            <select
              required
              value={form.leave_type_id}
              onChange={(e) => setForm(p => ({ ...p, leave_type_id: e.target.value }))}
              className="w-full px-3 py-2.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
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
            {rules.length > 0 && (
              <div className="mt-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2">
                <p className="text-xs font-medium text-blue-800 mb-1">Rules for {selectedType.name}</p>
                <ul className="list-disc pl-4 space-y-0.5 text-xs text-blue-700">
                  {rules.map((r) => <li key={r}>{r}</li>)}
                </ul>
              </div>
            )}
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Start Date *</label>
              <input
                type="date"
                required
                value={form.start_date}
                onChange={(e) => setForm(p => ({ ...p, start_date: e.target.value }))}
                className="w-full px-3 py-2.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">End Date *</label>
              <input
                type="date"
                required
                value={form.end_date}
                min={form.start_date}
                onChange={(e) => setForm(p => ({ ...p, end_date: e.target.value }))}
                className="w-full px-3 py-2.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          {estimatedDays > 0 && (
            <div className={`flex flex-wrap items-center gap-x-2 px-3 py-2 rounded-lg text-sm ${insufficient ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
              <span className="font-medium">{estimatedDays} working day{estimatedDays > 1 ? 's' : ''}</span>
              {insufficient
                ? <span>exceeds your {remaining} remaining day{remaining !== 1 ? 's' : ''} — reduce the range or pick another leave type.</span>
                : <span className="text-blue-500">(excluding Sundays)</span>}
            </div>
          )}

          {/* Reason */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Reason *</label>
            <textarea
              required
              rows={3}
              value={form.reason}
              onChange={(e) => setForm(p => ({ ...p, reason: e.target.value }))}
              placeholder="Provide a reason for your leave request..."
              className="w-full px-3 py-2.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={applyMutation.isPending || insufficient}
              className="px-6 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {applyMutation.isPending ? 'Submitting...' : 'Submit Request'}
            </button>
            <button
              type="button"
              onClick={() => router.push('/leaves/my')}
              className="px-6 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
