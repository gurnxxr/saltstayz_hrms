'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import LoadError from '@/components/ui/LoadError';
import { Plus, Calendar, Clock, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

const STATUS_ICONS: Record<string, typeof Clock> = {
  pending: Clock,
  approved: CheckCircle,
  rejected: XCircle,
  cancelled: AlertCircle,
};

// Self-service: leave balances + apply button + my requests. (Holidays live on
// the Leaves page's own "Holidays" tab now.)
export default function LeaveTab() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');

  const { data: balances = [], isError: balancesError, refetch: refetchBalances } = useQuery({
    queryKey: ['leave-balances'],
    queryFn: () => api.get('/leave/balances').then(r => r.data),
  });

  const { data: leaves = [], isError: leavesError, refetch: refetchLeaves } = useQuery({
    queryKey: ['my-leaves', statusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      return api.get(`/leave/my?${params}`).then(r => r.data);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => api.put(`/leave/${id}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-leaves'] });
      queryClient.invalidateQueries({ queryKey: ['leave-balances'] });
      toast.success('Leave request cancelled');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to cancel'),
  });

  // Unpaid leave (Loss of Pay) is allocated 365 days to mean "no limit", not as an entitlement,
  // so a 365/365 tile beside the real balances is noise. Hidden here only — it is still applied
  // for from the Apply Leave button below.
  const paidBalances = (balances as any[]).filter((b: any) => b.is_paid);

  return (
    <div className="space-y-6">
      <div className="flex justify-end gap-3">
        <button
          onClick={() => router.push('/leaves/apply')}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus size={16} /> Apply Leave
        </button>
      </div>

      {/* Leave Balances */}
      {balancesError && <LoadError compact message="Couldn't load leave balances." onRetry={() => refetchBalances()} />}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {paidBalances.map((b: any) => {
          const consumed = b.allocated - b.available;
          const pct = b.allocated > 0 ? (consumed / b.allocated) * 100 : 0;
          return (
            <div key={b.leave_type_id} className="bg-card rounded-xl border border-border p-4">
              <p className="text-xs font-medium text-secondary truncate">{b.leave_type}</p>
              <div className="mt-2 flex items-end gap-1">
                <span className="text-2xl font-bold text-foreground">{b.available}</span>
                <span className="text-xs text-secondary mb-1">/ {b.allocated}</span>
              </div>
              <div className="mt-2 w-full h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-yellow-500' : 'bg-green-500'}`}
                  style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                />
              </div>
              <p className="text-xs text-secondary mt-1">
                {b.taken} taken{b.pending > 0 ? ` · ${b.pending} pending` : ''}
              </p>
            </div>
          );
        })}
      </div>

      {/* My Requests */}
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold text-foreground">My Requests</h2>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-border rounded-lg bg-background text-sm"
        >
          <option value="">All Status</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {leavesError ? (
          <LoadError message="Couldn't load your leave requests." onRetry={() => refetchLeaves()} />
        ) : leaves.length === 0 ? (
          <div className="p-8 text-center text-secondary">
            <Calendar size={32} className="mx-auto mb-2 opacity-40" />
            <p>No leave requests found.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {leaves.map((leave: any) => {
              const Icon = STATUS_ICONS[leave.status] || Clock;
              return (
                <div key={leave.id} className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${STATUS_COLORS[leave.status]}`}>
                      <Icon size={18} />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{leave.leave_type}</p>
                      <p className="text-sm text-secondary">
                        {new Date(leave.start_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        {leave.start_date !== leave.end_date && ` — ${new Date(leave.end_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                        {' '}&middot; {leave.days} day{leave.days > 1 ? 's' : ''}
                      </p>
                      {leave.reason && <p className="text-xs text-secondary mt-0.5 line-clamp-1">{leave.reason}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {leave.rejection_reason && (
                      <p className="text-xs text-red-600 max-w-48 truncate" title={leave.rejection_reason}>
                        {leave.rejection_reason}
                      </p>
                    )}
                    {leave.approved_by_name && leave.status !== 'pending' && (
                      <p className="text-xs text-secondary">by {leave.approved_by_name}</p>
                    )}
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[leave.status]}`}>
                      {leave.status}
                    </span>
                    {leave.status === 'pending' && (
                      <button
                        onClick={() => cancelMutation.mutate(leave.id)}
                        className="text-xs px-3 py-1 border border-red-200 text-red-600 rounded-lg hover:bg-red-50"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
