'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import LoadError from '@/components/ui/LoadError';
import RaiseRegularisationDialog, { TYPE_LABELS } from '@/components/attendance/RaiseRegularisationDialog';
import { Check, X, Clock, ClipboardCheck, Plus, History } from 'lucide-react';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtRange = (start: string, end?: string | null) =>
  end && end !== start ? `${fmtDate(start)} – ${fmtDate(end)}` : fmtDate(start);
const prettyStatus = (s?: string | null) => (s ? s.replace('_', ' ') : '—');
const typeLabel = (t?: string | null) => (t ? (TYPE_LABELS[t] || prettyStatus(t)) : '—');

export default function RegularisationPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isStaff = ['admin', 'chro', 'hr'].includes(user?.roleName || '');
  const [viewMode, setViewMode] = useState<'mine' | 'approvals' | 'log'>('mine');
  const [showRaise, setShowRaise] = useState(false);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectComment, setRejectComment] = useState('');

  const { data: mine = [], isError: mineError, refetch: refetchMine } = useQuery({
    queryKey: ['my-regularisations'],
    queryFn: () => api.get('/regularisation/me').then(r => r.data),
  });

  const { data: pending = [], isError: pendingError, refetch: refetchPending } = useQuery({
    queryKey: ['regularisation-approvals'],
    queryFn: () => api.get('/regularisation/pending').then(r => r.data),
  });

  const { data: log = [], isError: logError, refetch: refetchLog } = useQuery({
    queryKey: ['regularisation-log'],
    queryFn: () => api.get('/regularisation/log').then(r => r.data),
  });

  // Approvals + Log are for reporting managers / HR. A manager with something to
  // review has pending > 0; anyone with decided history has log > 0; HR always sees them.
  const canReview = isStaff || pending.length > 0 || log.length > 0;

  const approveMutation = useMutation({
    mutationFn: (id: number) => api.post(`/regularisation/${id}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regularisation-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['regularisation-log'] });
      queryClient.invalidateQueries({ queryKey: ['my-regularisations'] });
      toast.success('Regularisation approved — attendance corrected');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to approve'),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, comment }: { id: number; comment: string }) =>
      api.post(`/regularisation/${id}/reject`, { reviewer_comment: comment }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regularisation-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['regularisation-log'] });
      toast.success('Regularisation rejected');
      setRejectingId(null);
      setRejectComment('');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to reject'),
  });

  const tabCls = (active: boolean) =>
    `px-4 py-2 rounded-md text-sm font-medium transition-colors ${active ? 'bg-card text-foreground shadow-sm' : 'text-secondary hover:text-foreground'}`;

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Attendance Regularisation</h1>
            <p className="text-secondary mt-1">Request a correction for wrongly-recorded days — your reporting manager approves it.</p>
          </div>
          <button
            onClick={() => setShowRaise(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus size={16} /> Raise request
          </button>
        </div>

        {/* View toggle */}
        <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit">
          <button onClick={() => setViewMode('mine')} className={tabCls(viewMode === 'mine')}>
            My Requests
          </button>
          {canReview && (
            <button onClick={() => setViewMode('approvals')} className={tabCls(viewMode === 'approvals')}>
              Approvals ({pending.length})
            </button>
          )}
          {canReview && (
            <button onClick={() => setViewMode('log')} className={tabCls(viewMode === 'log')}>
              Log
            </button>
          )}
        </div>

        {/* My requests */}
        {viewMode === 'mine' && (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            {mineError ? (
              <LoadError message="Couldn't load your requests." onRetry={() => refetchMine()} />
            ) : mine.length === 0 ? (
              <div className="p-8 text-center text-secondary">
                <ClipboardCheck size={32} className="mx-auto mb-2 opacity-40" />
                <p>No regularisation requests yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {mine.map((r: any) => (
                  <div key={r.id} className="p-4 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{fmtRange(r.date, r.end_date)}</p>
                      <p className="text-sm text-secondary mt-0.5">Requested: {typeLabel(r.requested_status)}</p>
                      {r.reason && <p className="text-sm text-secondary mt-1">{r.reason}</p>}
                      {r.status === 'approved' && (
                        <p className="text-sm text-green-600 mt-1">Applied as: {prettyStatus(r.applied_status)}
                          {r.approved_by_name ? ` · by ${r.approved_by_name}` : ''}</p>
                      )}
                      {r.status === 'rejected' && r.reviewer_comment && (
                        <p className="text-sm text-red-600 mt-1">Reason: {r.reviewer_comment}</p>
                      )}
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium shrink-0 ${STATUS_COLORS[r.status] || 'bg-gray-100 text-gray-500'}`}>
                      {r.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Approvals (reporting manager / HR) */}
        {viewMode === 'approvals' && canReview && (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            {pendingError ? (
              <LoadError message="Couldn't load pending requests." onRetry={() => refetchPending()} />
            ) : pending.length === 0 ? (
              <div className="p-8 text-center text-secondary">
                <Clock size={32} className="mx-auto mb-2 opacity-40" />
                <p>No pending regularisations to review.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {pending.map((r: any) => (
                  <div key={r.id} className="p-4 flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                        {r.first_name?.[0]}{r.last_name?.[0]}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">{r.first_name} {r.last_name}</p>
                        <p className="text-xs text-secondary">{r.employee_code} · {r.dept_name || '—'} · {r.branch_name || '—'}</p>
                        <div className="mt-2 flex items-center gap-3 flex-wrap">
                          <span className="text-sm font-medium text-foreground">{fmtRange(r.date, r.end_date)}</span>
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">{typeLabel(r.requested_status)}</span>
                        </div>
                        {r.reason && <p className="text-sm text-secondary mt-1">{r.reason}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {rejectingId === r.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            value={rejectComment}
                            onChange={(e) => setRejectComment(e.target.value)}
                            placeholder="Reason (required)"
                            className="px-2 py-1.5 border border-border rounded-lg text-xs w-44 focus:outline-none focus:ring-1 focus:ring-primary/50"
                          />
                          <button
                            onClick={() => rejectComment.trim()
                              ? rejectMutation.mutate({ id: r.id, comment: rejectComment })
                              : toast.error('A reason is required to reject')}
                            className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium"
                          >
                            Confirm
                          </button>
                          <button onClick={() => { setRejectingId(null); setRejectComment(''); }} className="text-xs text-secondary">
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => approveMutation.mutate(r.id)}
                            disabled={approveMutation.isPending}
                            className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50"
                          >
                            <Check size={12} /> Approve
                          </button>
                          <button
                            onClick={() => { setRejectingId(r.id); setRejectComment(''); }}
                            className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700"
                          >
                            <X size={12} /> Reject
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Log (history of decided requests) */}
        {viewMode === 'log' && canReview && (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            {logError ? (
              <LoadError message="Couldn't load the regularisation log." onRetry={() => refetchLog()} />
            ) : log.length === 0 ? (
              <div className="p-8 text-center text-secondary">
                <History size={32} className="mx-auto mb-2 opacity-40" />
                <p>No regularisations decided yet.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-secondary">
                      <th className="px-4 py-3 font-medium">Employee</th>
                      <th className="px-4 py-3 font-medium">Dates</th>
                      <th className="px-4 py-3 font-medium">Requested</th>
                      <th className="px-4 py-3 font-medium">Outcome</th>
                      <th className="px-4 py-3 font-medium">Decided by</th>
                      <th className="px-4 py-3 font-medium">On</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {log.map((r: any) => (
                      <tr key={r.id} className="hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <p className="font-medium text-foreground">{r.first_name} {r.last_name}</p>
                          <p className="text-xs text-secondary">{r.employee_code}{r.branch_name ? ` · ${r.branch_name}` : ''}</p>
                        </td>
                        <td className="px-4 py-3 text-secondary whitespace-nowrap">{fmtRange(r.date, r.end_date)}</td>
                        <td className="px-4 py-3 text-secondary">{typeLabel(r.requested_status)}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[r.status] || 'bg-gray-100 text-gray-500'}`}>
                            {r.status === 'approved' ? `Applied: ${prettyStatus(r.applied_status)}` : 'Rejected'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-secondary">{r.approved_by_name || '—'}</td>
                        <td className="px-4 py-3 text-secondary whitespace-nowrap">{r.decided_at ? fmtDate(r.decided_at) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {showRaise && <RaiseRegularisationDialog onClose={() => setShowRaise(false)} />}
    </AppShell>
  );
}
