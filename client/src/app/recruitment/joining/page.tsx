'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import Breadcrumb from '@/components/ui/Breadcrumb';
import LoadError from '@/components/ui/LoadError';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { ArrowRight, UserCheck, UserX, Loader2, ClipboardCheck, ChevronRight } from 'lucide-react';

// The three phases HR ops work in the joining queue (steps 9-11). Everything in the
// funnel before offer_accepted is handled on the pipeline; everything after transfer
// is a live employee. Labels come from GET /recruitment/stages (server is authoritative).
const PHASE_BADGE: Record<string, string> = {
  offer_accepted: 'bg-blue-100 text-blue-700',
  pre_joining: 'bg-amber-100 text-amber-700',
  joining: 'bg-green-100 text-green-700',
};

// Short labels for each checklist phase key.
const CHECKLIST_LABEL: Record<string, string> = {
  document_collection: 'Documents',
  pre_joining: 'Pre-joining',
  joining_day: 'Joining Day',
};

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export default function JoiningQueuePage() {
  const queryClient = useQueryClient();
  const [confirmNoShow, setConfirmNoShow] = useState<any | null>(null);

  const { data: stages } = useQuery({
    queryKey: ['recruitment-stages'],
    queryFn: () => api.get('/recruitment/stages').then(r => r.data),
  });
  const labels: Record<string, string> = stages?.labels ?? {};

  const { data: rows = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['joining-queue'],
    queryFn: () => api.get('/recruitment/joining-queue').then(r => r.data),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['joining-queue'] });
  };

  // PUT /recruitment/candidates/:id/stage — advances or drops the hire. The server
  // refuses stage:'joining' unless the pre_joining checklist is complete; surface it.
  const stageMutation = useMutation({
    mutationFn: ({ id, stage }: { id: number; stage: string }) =>
      api.put(`/recruitment/candidates/${id}/stage`, { stage }),
    onSuccess: (_res, vars) => {
      invalidate();
      toast.success(vars.stage === 'no_show' ? 'Marked as no-show' : 'Stage advanced');
      setConfirmNoShow(null);
    },
    onError: (err: any) => { toast.error(err.response?.data?.error || 'Failed to update stage'); setConfirmNoShow(null); },
  });

  const transferMutation = useMutation({
    mutationFn: (id: number) => api.post(`/recruitment/candidates/${id}/transfer`, {}),
    onSuccess: () => { invalidate(); toast.success('Transferred to reporting manager'); },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to transfer'),
  });

  const pendingId = stageMutation.isPending ? (stageMutation.variables as any)?.id
    : transferMutation.isPending ? transferMutation.variables
      : null;

  // The action button that advances each phase.
  const renderAdvance = (r: any) => {
    const busy = pendingId === r.id;
    if (r.stage === 'offer_accepted') {
      return (
        <button onClick={() => stageMutation.mutate({ id: r.id, stage: 'pre_joining' })} disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <ArrowRight size={13} />} Start Pre-joining
        </button>
      );
    }
    if (r.stage === 'pre_joining') {
      return (
        <button onClick={() => stageMutation.mutate({ id: r.id, stage: 'joining' })} disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <ArrowRight size={13} />} Joining Day
        </button>
      );
    }
    if (r.stage === 'joining') {
      return (
        <button onClick={() => transferMutation.mutate(r.id)} disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50 transition-colors">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <UserCheck size={13} />} Transfer to Manager
        </button>
      );
    }
    return null;
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <Breadcrumb className="mb-2" items={[{ label: 'Recruitment', href: '/recruitment' }, { label: 'Onboarding' }]} />
          <h1 className="text-2xl font-bold text-foreground">Onboarding</h1>
          <p className="text-secondary mt-1">
            Accepted hires being brought on board — document collection, pre-joining formalities, then joining day.
            Complete each phase&apos;s checklist to unlock the next, and finish by transferring the new joiner to their manager.
          </p>
        </div>

        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <ClipboardCheck size={15} className="text-primary" />
            <h2 className="text-sm font-semibold text-foreground">In-flight hires</h2>
            {rows.length > 0 && <span className="text-xs text-secondary">({rows.length})</span>}
          </div>

          {isError ? (
            <LoadError message="Couldn't load the joining queue." onRetry={() => refetch()} />
          ) : isLoading ? (
            <div className="p-8 text-center text-secondary">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-secondary">No accepted hires in progress. Offers accepted on the pipeline land here.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-secondary">
                    <th className="px-4 py-2.5 font-medium">Candidate</th>
                    <th className="px-4 py-2.5 font-medium">Property</th>
                    <th className="px-4 py-2.5 font-medium">Phase</th>
                    <th className="px-4 py-2.5 font-medium">Checklists</th>
                    <th className="px-4 py-2.5 font-medium">Joining date</th>
                    <th className="px-4 py-2.5 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r: any) => (
                    <tr key={r.id} className="hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <Link href={`/recruitment/candidates/${r.id}`} className="group inline-flex items-center gap-1">
                          <span className="min-w-0">
                            <span className="block font-medium text-foreground group-hover:text-primary transition-colors">{r.name}</span>
                            <span className="block text-xs text-secondary">{r.designation}{r.employee_code ? ` · ${r.employee_code}` : ''}</span>
                          </span>
                          <ChevronRight size={13} className="text-secondary/50 group-hover:text-primary transition-colors" />
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-secondary">{r.property_name}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PHASE_BADGE[r.stage] || 'bg-gray-100 text-gray-600'}`}>
                          {labels[r.stage] || r.stage}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {r.checklists?.length ? (
                          <div className="flex flex-wrap gap-1.5">
                            {r.checklists.map((c: any) => {
                              const done = c.status === 'complete' || (c.total > 0 && c.done >= c.total);
                              return (
                                <span key={c.key}
                                  className={`px-2 py-0.5 rounded-md text-xs font-medium ${done ? 'bg-green-100 text-green-700' : 'bg-muted text-secondary'}`}
                                  title={CHECKLIST_LABEL[c.key] || c.key}>
                                  {CHECKLIST_LABEL[c.key] || c.key} {c.done}/{c.total}
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-xs text-secondary">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-secondary">{fmtDate(r.date_of_joining)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {renderAdvance(r)}
                          <button onClick={() => setConfirmNoShow(r)} disabled={pendingId === r.id}
                            title="Mark as no-show"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-xs font-medium text-secondary hover:text-red-600 hover:border-red-200 hover:bg-red-50 disabled:opacity-50 transition-colors">
                            <UserX size={13} /> No Show
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmNoShow}
        title="Mark as no-show?"
        danger
        confirmLabel="Mark no-show"
        message={confirmNoShow ? <>This drops <span className="font-medium text-foreground">{confirmNoShow.name}</span> from the joining queue. Use it when an accepted hire never turns up. This cannot be undone from here.</> : undefined}
        loading={stageMutation.isPending}
        onConfirm={() => confirmNoShow && stageMutation.mutate({ id: confirmNoShow.id, stage: 'no_show' })}
        onCancel={() => setConfirmNoShow(null)}
      />
    </AppShell>
  );
}
