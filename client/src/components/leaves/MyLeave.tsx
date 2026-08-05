'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import LoadError from '@/components/ui/LoadError';
import EmptyState from '@/components/ui/EmptyState';
import StatusPill, { TONE_CLS } from '@/components/ui/StatusPill';
import { btnCls, inputCls } from '@/components/ui/styles';
import { leaveStatusMeta, LEAVE_STATUS_OPTIONS } from '@/lib/leaveStatus';
import { cn, formatDateRange } from '@/lib/utils';
import { Plus, Calendar, Clock, CheckCircle, XCircle, AlertCircle, Loader2 } from 'lucide-react';

const STATUS_ICONS: Record<string, typeof Clock> = {
  pending: Clock,
  approved: CheckCircle,
  rejected: XCircle,
  cancelled: AlertCircle,
};

// Self-service: leave balances + my requests. (Holidays live on the Leaves page's own "Holidays"
// tab, and the Apply button now lives in that page's header so it is present on every tab.)
//
// Was components/attendance/LeaveTab.tsx — a leave screen filed under attendance, named for the
// fact that it happens to be rendered in a tab rather than for what it shows. Its neighbours are
// LeaveApprovals and MyHolidays.
export default function MyLeave() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');

  const { data: balances = [], isError: balancesError, refetch: refetchBalances } = useQuery({
    queryKey: ['leave-balances'],
    queryFn: () => api.get('/leave/balances').then(r => r.data),
  });

  const { data: leaves = [], isError: leavesError, isLoading: leavesLoading, refetch: refetchLeaves } = useQuery({
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
      toast.success('Leave request cancelled — the days are back on your balance');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to cancel'),
  });

  // Unpaid leave (Loss of Pay) is allocated 365 days to mean "no limit", not as an entitlement,
  // so a 365/365 tile beside the real balances is noise. Hidden here only — it is still applied
  // for from the Apply Leave button in the page header.
  const paidBalances = (balances as any[]).filter((b: any) => b.is_paid);

  return (
    <div className="space-y-6">
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
          aria-label="Filter requests by status"
          className={cn(inputCls, 'w-auto')}
        >
          <option value="">All statuses</option>
          {LEAVE_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* One ladder, one order. This screen used to render the empty state while the request was
          still in flight, so "No leave requests found." was what somebody read as a FACT for the
          first few hundred milliseconds after opening their own leave page. */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {leavesError ? (
          <LoadError message="Couldn't load your leave requests." onRetry={() => refetchLeaves()} />
        ) : leavesLoading ? (
          <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-secondary" /></div>
        ) : leaves.length === 0 ? (
          <EmptyState
            icon={Calendar}
            title={statusFilter ? 'No requests with that status' : 'No leave requests yet'}
            body={statusFilter ? undefined : 'Anything you apply for shows up here, with where it has got to.'}
            action={statusFilter ? undefined : (
              <Link href="/leaves/apply" className={btnCls('primary')}>
                <Plus size={16} /> Apply for leave
              </Link>
            )}
          />
        ) : (
          <div className="divide-y divide-border">
            {leaves.map((leave: any) => {
              const Icon = STATUS_ICONS[leave.status] || Clock;
              const meta = leaveStatusMeta(leave.status);
              return (
                <div key={leave.id} className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {/* The same status colour as the pill, on a tile rather than a pill. That is
                        why TONE_CLS is exported: one source of truth, two shapes. */}
                    <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center shrink-0', TONE_CLS[meta.tone])}>
                      <Icon size={18} />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{leave.leave_type}</p>
                      <p className="text-sm text-secondary">
                        {/* Shared with Approvals, which is the point — this screen put the year on
                            the end date and that one omitted it entirely. */}
                        {formatDateRange(leave.start_date, leave.end_date)}
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
                    <StatusPill {...meta} />
                    {leave.status === 'pending' && (
                      <button
                        onClick={() => cancelMutation.mutate(leave.id)}
                        // Same guard as Approve on the other screen: a second click used to fire a
                        // second PUT and paint the server's rejection over a successful cancel.
                        disabled={cancelMutation.isPending && cancelMutation.variables === leave.id}
                        className={btnCls('dangerOutline', 'sm')}
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
