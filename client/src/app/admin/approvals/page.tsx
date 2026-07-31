'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import LoadError from '@/components/ui/LoadError';
import Breadcrumb from '@/components/ui/Breadcrumb';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useAuth } from '@/lib/auth';
import { formatINR } from '@/lib/utils';
import { ShieldCheck, Check, X, AlertTriangle, IndianRupee, Users, Wallet, Info } from 'lucide-react';

// The three ways a hire can breach the sanctioned cap — labelled for the reviewer.
const BLOCK_LABEL: Record<string, { label: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  over_budget: { label: 'Over free budget', icon: Wallet },
  over_band: { label: 'Over role maximum', icon: IndianRupee },
  over_headcount: { label: 'Over sanctioned headcount', icon: Users },
};

export default function ApprovalsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  const [confirm, setConfirm] = useState<{ row: any; action: 'approve' | 'reject' } | null>(null);
  const [note, setNote] = useState('');

  const { data: rows = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['approvals', tab],
    queryFn: () => api.get(`/manpower/exceptions${tab === 'pending' ? '?status=pending' : ''}`).then(r => r.data),
  });

  const review = useMutation({
    mutationFn: ({ id, action, admin_note }: any) => api.put(`/manpower/exceptions/${id}/${action}`, { admin_note }),
    onSuccess: (_d, v: any) => {
      toast.success(v.action === 'approve' ? 'Request approved' : 'Request rejected');
      setConfirm(null); setNote('');
      qc.invalidateQueries({ queryKey: ['approvals'] });
      qc.invalidateQueries({ queryKey: ['budget-control'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const pending = rows.filter((r: any) => r.status === 'pending');

  return (
    <AppShell>
      <div className="space-y-6">
        <Breadcrumb items={[{ label: 'Admin', href: '/admin' }, { label: 'Hiring Approvals' }]} />
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><ShieldCheck className="text-primary" size={20} /></div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Hiring Approvals</h1>
            <p className="text-secondary text-sm">Over-limit hires are blocked until an Admin approves them here. You can&apos;t approve a request you raised — a different Admin must.</p>
          </div>
        </div>

        <div className="flex gap-1 border-b border-border">
          {(['pending', 'all'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t ? 'border-primary text-primary' : 'border-transparent text-secondary hover:text-foreground'}`}>
              {t === 'pending' ? `Pending${tab === 'pending' && pending.length ? ` (${pending.length})` : ''}` : 'All requests'}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="text-center text-secondary text-sm py-12">Loading…</div>
        ) : isError ? (
          <LoadError message="Couldn't load approval requests." onRetry={() => refetch()} />
        ) : rows.length === 0 ? (
          <div className="bg-card rounded-xl border border-border p-10 text-center">
            <ShieldCheck className="mx-auto text-secondary/40 mb-3" size={32} />
            <p className="text-sm text-secondary">{tab === 'pending' ? 'No hiring approvals waiting. Every hire is within its sanctioned limit.' : 'No approval requests have been raised.'}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((r: any) => {
              const block = BLOCK_LABEL[r.exception_type] || { label: r.exception_type, icon: AlertTriangle };
              const BlockIcon = block.icon;
              const ctc = Number(r.requested_ctc) || 0;
              const variance = Number(r.variance_amount) || 0;
              const isMine = r.requested_by != null && r.requested_by === user?.userId;
              const isPending = r.status === 'pending';
              return (
                <div key={r.id} className="bg-card rounded-xl border border-border p-4">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-foreground">{r.candidate_name}</h3>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[11px] font-semibold">
                          <BlockIcon size={11} /> {block.label}
                        </span>
                        {!isPending && (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${r.status === 'approved' ? 'bg-green-100 text-green-700' : r.status === 'consumed' ? 'bg-blue-100 text-blue-700' : 'bg-muted text-secondary'}`}>
                            {r.status}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-secondary mt-0.5">{r.job_title} · {r.property_name}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-foreground tabular-nums">{formatINR(ctc)}<span className="text-xs font-normal text-secondary">/mo</span></div>
                      {variance > 0 && <div className="text-[11px] text-red-600 font-medium">+{formatINR(variance)} over the limit</div>}
                    </div>
                  </div>

                  {/* The frozen snapshot the request was raised against. */}
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <Snap label="Role maximum" value={formatINR(Number(r.band_max) || 0)} />
                    <Snap label="Free budget then" value={formatINR(Number(r.remaining_budget) || 0)} />
                    <Snap label="Headcount" value={`${r.non_left_headcount ?? 0} / ${r.sanctioned_headcount ?? 0}`} />
                    <Snap label="Requested by" value={r.requested_by_email || '—'} />
                  </div>

                  {r.request_reason && (
                    <div className="mt-2 flex items-start gap-1.5 text-xs text-secondary bg-muted/40 rounded-lg px-3 py-2">
                      <Info size={13} className="shrink-0 mt-0.5" /> <span>{r.request_reason}</span>
                    </div>
                  )}

                  {r.admin_note && !isPending && (
                    <p className="mt-2 text-xs text-secondary"><b>Reviewer note:</b> {r.admin_note}{r.reviewed_by_email ? ` — ${r.reviewed_by_email}` : ''}</p>
                  )}

                  {isPending && (
                    <div className="mt-3 flex items-center gap-2">
                      {isMine ? (
                        <span className="text-xs text-amber-600 inline-flex items-center gap-1"><AlertTriangle size={13} /> You raised this — a different Admin must review it.</span>
                      ) : (
                        <>
                          <button onClick={() => { setNote(''); setConfirm({ row: r, action: 'approve' }); }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700">
                            <Check size={13} /> Approve
                          </button>
                          <button onClick={() => { setNote(''); setConfirm({ row: r, action: 'reject' }); }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-xs font-medium text-foreground hover:bg-muted">
                            <X size={13} /> Reject
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!confirm}
        danger={confirm?.action === 'reject'}
        title={confirm?.action === 'approve' ? 'Approve this over-limit hire?' : 'Reject this request?'}
        confirmLabel={confirm?.action === 'approve' ? 'Approve' : 'Reject'}
        cancelLabel="Cancel"
        loading={review.isPending}
        message={confirm && (
          <div className="space-y-2 text-left">
            <p>
              {confirm.action === 'approve'
                ? <><b>{confirm.row.candidate_name}</b> at <b>{formatINR(Number(confirm.row.requested_ctc) || 0)}/mo</b> is over the sanctioned limit. Approving lets the offer for this candidate proceed at this pay.</>
                : <>Reject the over-limit request for <b>{confirm.row.candidate_name}</b>. The blocked offer stays blocked.</>}
            </p>
            <label className="block">
              <span className="block text-xs text-secondary mb-1">Note {confirm.action === 'approve' ? '(optional)' : '(optional)'}</span>
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm"
                placeholder={confirm.action === 'approve' ? 'e.g. Business-critical role, signed off by CHRO' : 'e.g. Bring the offer within the role maximum'} />
            </label>
          </div>
        )}
        onCancel={() => { setConfirm(null); setNote(''); }}
        onConfirm={() => confirm && review.mutate({ id: confirm.row.id, action: confirm.action, admin_note: note.trim() || undefined })}
      />
    </AppShell>
  );
}

function Snap({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/40 rounded-lg px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-secondary">{label}</div>
      <div className="text-foreground font-medium truncate" title={value}>{value}</div>
    </div>
  );
}
