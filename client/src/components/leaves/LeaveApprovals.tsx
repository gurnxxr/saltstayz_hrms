'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import LoadError from '@/components/ui/LoadError';
import EmptyState from '@/components/ui/EmptyState';
import StatusPill from '@/components/ui/StatusPill';
import RejectDialog from '@/components/leaves/RejectDialog';
import { btnCls, inputCls } from '@/components/ui/styles';
import { leaveStatusMeta, LEAVE_STATUS_OPTIONS } from '@/lib/leaveStatus';
import { cn, formatDateRange } from '@/lib/utils';
import { Check, X, Clock, Loader2 } from 'lucide-react';

// Reporting managers see their own reports; HR/CHRO/Admin see all (server-scoped).
// Review-only: applying (incl. on behalf) lives on the Apply page.
export default function LeaveApprovals({ canFilterAll }: { canFilterAll: boolean }) {
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState<any | null>(null);
  const [branchFilter, setBranchFilter] = useState('');

  /*
   * One control where there were two.
   *
   * A Pending / All Requests pill bar used to sit here — a second tab strip nested inside the
   * page's tab strip, drawing a distinction the status <select> beside it already drew, because
   * "pending" IS a status. Two visually identical stacked bars left you unable to tell which one
   * you were steering, and its `Pending (3)` duplicated the count on the tab above it.
   *
   * Choosing anything other than Pending swaps the data source underneath: the queue endpoint is
   * manager-scoped and carries the approve/reject actions, /leave/all is org-wide and staff-only.
   */
  const [status, setStatus] = useState('pending');
  const viewingQueue = status === 'pending';

  const { data: pending = [], isError: pendingError, isLoading: pendingLoading, refetch: refetchPending } = useQuery({
    queryKey: ['leave-approvals'],
    queryFn: () => api.get('/leave/approvals').then(r => r.data),
  });

  const { data: allLeaves = [], isError: allError, isLoading: allLoading, refetch: refetchAll } = useQuery({
    queryKey: ['all-leaves', status, branchFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (branchFilter) params.set('branch_name', branchFilter);
      return api.get(`/leave/all?${params}`).then(r => r.data);
    },
    enabled: canFilterAll && !viewingQueue,
  });

  const { data: properties = [] } = useQuery({
    queryKey: ['properties'],
    queryFn: () => api.get('/admin/properties').then(r => r.data),
    enabled: canFilterAll && !viewingQueue,
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => api.put(`/leave/${id}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['all-leaves'] });
      // Says what changed, rather than just that something did — approving debits the balance and
      // marks the days on the attendance calendar.
      toast.success('Leave approved — days debited from the balance');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to approve'),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      api.put(`/leave/${id}/reject`, { rejection_reason: reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['all-leaves'] });
      toast.success('Leave rejected — the employee is told your reason');
      setRejecting(null);
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to reject'),
  });

  const rows = viewingQueue ? pending : allLeaves;
  const isError = viewingQueue ? pendingError : allError;
  const isLoading = viewingQueue ? pendingLoading : allLoading;
  const retry = viewingQueue ? refetchPending : refetchAll;

  const renderLeaveCard = (leave: any) => {
    // Every row in the queue is pending, so this covers both sources with one test.
    const showActions = leave.status === 'pending';
    // Only THIS row locks while its own approval is in flight — the rest of the queue stays live.
    const approving = approveMutation.isPending && approveMutation.variables === leave.id;
    return (
      <div key={leave.id} className="p-4 flex items-start justify-between gap-4">
        <div className="flex items-start gap-4 min-w-0">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
            {leave.first_name?.[0]}{leave.last_name?.[0]}
          </div>
          <div className="min-w-0">
            <p className="font-medium text-foreground">{leave.first_name} {leave.last_name}</p>
            <p className="text-xs text-secondary">{leave.employee_code} &middot; {leave.department_name || leave.dept_name || '—'} &middot; {leave.property_name || leave.branch_name || '—'}</p>
            <div className="mt-2 flex items-center gap-3 flex-wrap">
              <span className="text-sm font-medium text-foreground">{leave.leave_type}</span>
              {/* Shared with My Leave. These two screens used to disagree — this one omitted the
                  year on both ends while My Leave carried it on the end date, so the same request
                  read differently depending on which tab you were on. */}
              <span className="text-sm text-secondary">{formatDateRange(leave.start_date, leave.end_date)}</span>
              <StatusPill tone="neutral" label={`${leave.days} day${leave.days > 1 ? 's' : ''}`} />
            </div>
            {leave.reason && <p className="text-sm text-secondary mt-1">{leave.reason}</p>}
            {leave.rejection_reason && <p className="text-sm text-red-600 mt-1">Reason: {leave.rejection_reason}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!showActions && <StatusPill {...leaveStatusMeta(leave.status)} />}
          {showActions && (
            <>
              <button
                onClick={() => approveMutation.mutate(leave.id)}
                // Without this, the second click of a double-click fired a second PUT and the
                // server's "Only pending requests can be approved" landed as a red error toast on
                // top of an approval that had just succeeded.
                disabled={approving}
                className={btnCls('success', 'sm')}
              >
                {approving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Approve
              </button>
              <button onClick={() => setRejecting(leave)} className={btnCls('danger', 'sm')}>
                <X size={12} /> Reject
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Staff only. A reporting manager sees their queue and nothing to filter it by — /leave/all
          is org-wide, so it stays behind canFilterAll. */}
      {canFilterAll && (
        <div className="flex items-center gap-3 flex-wrap">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={cn(inputCls, 'w-auto')}>
            {/* Pending first and selected by default — it is the queue, and the reason to be here. */}
            {LEAVE_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
            <option value="">All statuses</option>
          </select>
          {!viewingQueue && (
            <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className={cn(inputCls, 'w-auto')}>
              <option value="">All properties</option>
              {properties.map((p: any) => (
                <option key={p.id} value={p.name}>{p.name}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* One ladder, in one order: a failure must never be able to render as "nothing here", and
          an in-flight request must never render as "nothing here" either — which is exactly what
          this screen used to do for the first few hundred milliseconds. */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {isError ? (
          <LoadError message="Couldn't load leave requests." onRetry={() => retry()} />
        ) : isLoading ? (
          <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-secondary" /></div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Clock}
            title={viewingQueue ? 'Nothing waiting for you' : 'No leave requests found'}
            body={viewingQueue
              ? 'Requests from the people who report to you appear here as soon as they apply.'
              : 'Try a different status or property.'}
          />
        ) : (
          <div className="divide-y divide-border">{rows.map(renderLeaveCard)}</div>
        )}
      </div>

      <RejectDialog
        open={!!rejecting}
        title="Reject leave request?"
        subject={rejecting ? (
          <>
            {rejecting.first_name} {rejecting.last_name} — {rejecting.days} day{rejecting.days > 1 ? 's' : ''} of{' '}
            {rejecting.leave_type}. Nothing is debited, and they are told the reason you give.
          </>
        ) : undefined}
        loading={rejectMutation.isPending}
        onCancel={() => setRejecting(null)}
        onConfirm={(reason) => rejectMutation.mutate({ id: rejecting.id, reason })}
      />
    </div>
  );
}
