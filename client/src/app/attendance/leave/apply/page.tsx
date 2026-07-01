'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
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

  const { data: leaveTypes = [] } = useQuery({
    queryKey: ['leave-types'],
    queryFn: () => api.get('/leave/types').then(r => r.data),
  });

  const { data: balances = [] } = useQuery({
    queryKey: ['leave-balances'],
    queryFn: () => api.get('/leave/balances').then(r => r.data),
  });

  const applyMutation = useMutation({
    mutationFn: (data: typeof form) =>
      api.post('/leave/apply', { ...data, leave_type_id: Number(data.leave_type_id) }),
    onSuccess: () => {
      toast.success('Leave request submitted');
      router.push('/attendance/leave');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to apply'),
  });

  const selectedBalance = balances.find((b: any) => String(b.leave_type_id) === form.leave_type_id);
  const remaining = selectedBalance ? selectedBalance.total_days - selectedBalance.used_days : null;

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

  return (
    <AppShell>
      <div className="max-w-2xl space-y-6">
        <button
          onClick={() => router.push('/attendance/leave')}
          className="flex items-center gap-2 text-secondary hover:text-foreground text-sm transition-colors"
        >
          <ArrowLeft size={16} />
          Back to Leave
        </button>

        <div>
          <h1 className="text-2xl font-bold text-foreground">Apply for Leave</h1>
          <p className="text-secondary mt-1">Submit a new leave request to your manager</p>
        </div>

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
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm">
              <span className="font-medium">{estimatedDays} working day{estimatedDays > 1 ? 's' : ''}</span>
              <span className="text-blue-500">(excluding Sundays)</span>
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
              disabled={applyMutation.isPending}
              className="px-6 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {applyMutation.isPending ? 'Submitting...' : 'Submit Request'}
            </button>
            <button
              type="button"
              onClick={() => router.push('/attendance/leave')}
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
