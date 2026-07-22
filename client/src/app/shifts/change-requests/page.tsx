'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import Breadcrumb from '@/components/ui/Breadcrumb';
import LoadError from '@/components/ui/LoadError';
import api from '@/lib/api';
import { ArrowRight, Check, X, Loader2, GitPullRequestArrow } from 'lucide-react';

const fmtDate = (d: string) => new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const STATUSES = ['pending', 'approved', 'rejected'] as const;

export default function ShiftChangeRequestsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('pending');

  const { data: rows = [], isError, refetch } = useQuery({
    queryKey: ['shift-change-requests', status],
    queryFn: () => api.get(`/shifts/change-requests?status=${status}`).then(r => r.data),
  });

  const decide = useMutation({
    mutationFn: ({ id, approve, note }: { id: number; approve: boolean; note?: string }) =>
      api.post(`/shifts/change-requests/${id}/decision`, { approve, note }),
    onSuccess: (_d, v) => {
      toast.success(v.approve ? 'Approved — the employee moves to the new shift' : 'Request rejected');
      qc.invalidateQueries({ queryKey: ['shift-change-requests'] });
      // The approval writes a dated assignment, so every view of the mapping is now stale.
      qc.invalidateQueries({ queryKey: ['shift-assignments'] });
      qc.invalidateQueries({ queryKey: ['my-shift'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not update the request'),
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <Breadcrumb className="mb-2" items={[{ label: 'Shift Management' }, { label: 'Change Requests' }]} />
          <h1 className="text-2xl font-bold text-foreground">Shift Change Requests</h1>
          <p className="text-secondary mt-1">Approve or decline shift changes your team has requested. Approving moves them onto the new shift from the date they asked for.</p>
        </div>

        <div className="flex gap-1 border-b border-border">
          {STATUSES.map((s) => (
            <button key={s} onClick={() => setStatus(s)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px capitalize transition-colors ${status === s ? 'border-primary text-primary' : 'border-transparent text-secondary hover:text-foreground'}`}>
              {s}
            </button>
          ))}
        </div>

        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {isError ? (
            <LoadError message="Couldn't load change requests." onRetry={() => refetch()} />
          ) : rows.length === 0 ? (
            <div className="py-14 text-center">
              <GitPullRequestArrow size={34} className="mx-auto text-secondary/30 mb-2" />
              <p className="text-sm text-secondary">No {status} requests.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-secondary">
                    <th className="px-6 py-2.5 text-xs font-semibold uppercase">Employee</th>
                    <th className="px-4 py-2.5 text-xs font-semibold uppercase">From date</th>
                    <th className="px-4 py-2.5 text-xs font-semibold uppercase">Change</th>
                    <th className="px-4 py-2.5 text-xs font-semibold uppercase">Reason</th>
                    {status === 'pending' && <th className="px-6 py-2.5 text-xs font-semibold uppercase text-right">Decision</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r: any) => (
                    <tr key={r.id} className="hover:bg-muted/20">
                      <td className="px-6 py-3">
                        <p className="font-medium text-foreground whitespace-nowrap">{r.first_name} {r.last_name}</p>
                        <p className="text-xs text-secondary">{r.employee_code} · {r.branch_name || '—'}</p>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-foreground">{fmtDate(r.date)}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 text-foreground">
                          <span className="text-secondary">{r.from_shift_name || 'No shift'}</span>
                          <ArrowRight size={13} className="text-primary shrink-0" />
                          <span className="font-medium">{r.to_shift_name || '—'}</span>
                          {r.to_start_time && (
                            <span className="text-xs text-secondary">
                              {String(r.to_start_time).slice(0, 5)}–{String(r.to_end_time).slice(0, 5)}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-secondary max-w-56 truncate" title={r.reason || ''}>{r.reason || '—'}</td>
                      {status === 'pending' && (
                        <td className="px-6 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => decide.mutate({ id: r.id, approve: true })} disabled={decide.isPending}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
                              <Check size={13} /> Approve
                            </button>
                            <button onClick={() => decide.mutate({ id: r.id, approve: false, note: (typeof window !== 'undefined' ? (window.prompt('Reason for declining (optional):') || undefined) : undefined) })} disabled={decide.isPending}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-red-600 hover:bg-red-50 disabled:opacity-50">
                              <X size={13} /> Decline
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
