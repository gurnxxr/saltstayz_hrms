'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import Breadcrumb from '@/components/ui/Breadcrumb';
import LoadError from '@/components/ui/LoadError';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { formatINR } from '@/lib/utils';
import { Plus, Coins, Check, X, Loader2 } from 'lucide-react';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

const inputCls = 'w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';

export default function LeaveEncashmentPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState<any | null>(null);
  const [rejecting, setRejecting] = useState<any | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const { data: rows = [], isError, refetch } = useQuery({
    queryKey: ['leave-encashments', statusFilter],
    queryFn: () => api.get(`/leave/encashments${statusFilter ? `?status=${statusFilter}` : ''}`).then(r => r.data),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => api.put(`/leave/encashments/${id}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-encashments'] });
      toast.success('Encashment approved — days deducted from the balance');
      setConfirmApprove(null);
    },
    onError: (err: any) => { toast.error(err.response?.data?.error || 'Failed to approve'); setConfirmApprove(null); },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      api.put(`/leave/encashments/${id}/reject`, { rejection_reason: reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-encashments'] });
      toast.success('Encashment rejected');
      setRejecting(null);
      setRejectReason('');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to reject'),
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <Breadcrumb className="mb-2" items={[{ label: 'Leaves' }, { label: 'Encashment' }]} />
            <h1 className="text-2xl font-bold text-foreground">Leave Encashment</h1>
            <p className="text-secondary mt-1">Encash unused leave — approving deducts the days from the balance; Finance pays the amount outside payroll</p>
          </div>
          <button onClick={() => setShowNew(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
            <Plus size={16} /> New Encashment
          </button>
        </div>

        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-border rounded-lg bg-background text-sm">
          <option value="">All Status</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>

        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {isError ? (
            <LoadError message="Couldn't load encashments." onRetry={() => refetch()} />
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-secondary">
              <Coins size={32} className="mx-auto mb-2 opacity-40" />
              <p className="text-sm font-medium text-foreground">No encashments yet</p>
              <p className="text-sm mt-1">Encash an employee&apos;s unused encashable leave (e.g. Earned Leave).</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-secondary">
                    <th className="px-4 py-3 font-medium">Employee</th>
                    <th className="px-4 py-3 font-medium">Leave Type</th>
                    <th className="px-3 py-3 font-medium text-right">Days</th>
                    <th className="px-3 py-3 font-medium text-right">Rate/day</th>
                    <th className="px-3 py-3 font-medium text-right">Amount</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Note</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r: any) => (
                    <tr key={r.id} className="hover:bg-muted/20">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-foreground">{r.first_name} {r.last_name}</p>
                        <p className="text-xs text-secondary">{r.employee_code} · {r.branch_name || '—'}</p>
                      </td>
                      <td className="px-4 py-2.5 text-secondary">{r.leave_type}<span className="block text-xs">{r.period_name}</span></td>
                      <td className="px-3 py-2.5 text-right text-foreground">{r.days}</td>
                      <td className="px-3 py-2.5 text-right text-secondary">{formatINR(r.per_day_rate)}</td>
                      <td className="px-3 py-2.5 text-right font-medium text-foreground">{formatINR(r.amount)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[r.status] || 'bg-muted text-secondary'}`}>{r.status}</span>
                        {r.rejection_reason && <p className="text-xs text-red-600 mt-0.5 max-w-40 truncate" title={r.rejection_reason}>{r.rejection_reason}</p>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-secondary max-w-48 truncate" title={r.note || ''}>{r.note || '—'}</td>
                      <td className="px-4 py-2.5">
                        {r.status === 'pending' && (
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => setConfirmApprove(r)}
                              className="flex items-center gap-1 px-2.5 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 transition-colors">
                              <Check size={12} /> Approve
                            </button>
                            <button onClick={() => { setRejecting(r); setRejectReason(''); }}
                              className="flex items-center gap-1 px-2.5 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700 transition-colors">
                              <X size={12} /> Reject
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showNew && <NewEncashmentDialog onClose={() => setShowNew(false)} />}

      <ConfirmDialog
        open={!!confirmApprove}
        title="Approve encashment?"
        danger={false}
        confirmLabel="Approve"
        message={confirmApprove ? <>
          <span className="font-medium text-foreground">{confirmApprove.first_name} {confirmApprove.last_name}</span> — {confirmApprove.days} day(s) of {confirmApprove.leave_type} for <span className="font-medium text-foreground">{formatINR(confirmApprove.amount)}</span>. The days are deducted from the leave balance immediately; the payout is settled by Finance outside payroll.
        </> : undefined}
        loading={approveMutation.isPending}
        onConfirm={() => confirmApprove && approveMutation.mutate(confirmApprove.id)}
        onCancel={() => setConfirmApprove(null)}
      />

      {/* Reject with reason */}
      {rejecting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={() => setRejecting(null)} />
          <div className="relative bg-card rounded-xl border border-border shadow-xl w-full max-w-sm p-5 space-y-4">
            <h3 className="text-base font-semibold text-foreground">Reject encashment</h3>
            <p className="text-sm text-secondary">{rejecting.first_name} {rejecting.last_name} — {rejecting.days} day(s), {formatINR(rejecting.amount)}. The balance is untouched.</p>
            <textarea rows={2} className={`${inputCls} resize-none`} value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)} placeholder="Reason (optional)" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setRejecting(null)} className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors">Cancel</button>
              <button onClick={() => rejectMutation.mutate({ id: rejecting.id, reason: rejectReason })} disabled={rejectMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors">
                {rejectMutation.isPending && <Loader2 size={14} className="animate-spin" />} Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

// ─── New encashment: employee + encashable type + days ───

function NewEncashmentDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [form, setForm] = useState({ employee_id: '', leave_type_id: '', days: '', note: '' });

  const { data: periods = [] } = useQuery({
    queryKey: ['leave-periods'],
    queryFn: () => api.get('/leave/periods').then(r => r.data),
  });
  const currentPeriod = periods.find((p: any) => p.is_current);

  const { data: employees = [] } = useQuery({
    queryKey: ['leave-employees', currentPeriod?.id],
    queryFn: () => api.get(`/leave/entitlements?period_id=${currentPeriod.id}`).then(r => r.data),
    enabled: !!currentPeriod,
  });
  const { data: allTypes = [] } = useQuery({
    queryKey: ['leave-types-all'],
    queryFn: () => api.get('/leave/types/all').then(r => r.data),
  });
  const encashableTypes = useMemo(() => allTypes.filter((t: any) => t.is_encashable && t.is_active), [allTypes]);

  const filteredEmployees = useMemo(() => {
    const q = employeeSearch.toLowerCase();
    if (!q) return employees;
    return employees.filter((e: any) =>
      `${e.first_name} ${e.last_name}`.toLowerCase().includes(q) || e.employee_code?.toLowerCase().includes(q));
  }, [employees, employeeSearch]);

  // Balance hint for the chosen employee + type.
  const balance = useMemo(() => {
    if (!form.employee_id || !form.leave_type_id) return null;
    const emp = employees.find((e: any) => String(e.id) === form.employee_id);
    const ent = emp?.entitlements?.find((x: any) => String(x.leave_type_id) === form.leave_type_id);
    return ent ? ent.total_days - ent.used_days : null;
  }, [employees, form.employee_id, form.leave_type_id]);

  const createMutation = useMutation({
    mutationFn: () => api.post('/leave/encashments', {
      employee_id: Number(form.employee_id),
      leave_type_id: Number(form.leave_type_id),
      days: Number(form.days),
      note: form.note,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-encashments'] });
      toast.success('Encashment recorded (pending approval)');
      onClose();
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to create encashment'),
  });

  const canSubmit = form.employee_id && form.leave_type_id && Number(form.days) > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card rounded-xl border border-border shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-base font-semibold text-foreground">New Leave Encashment</h3>
          <button onClick={onClose} className="p-1 rounded-lg text-secondary hover:text-foreground hover:bg-muted transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Employee<span className="text-red-600"> *</span></label>
            <input className={`${inputCls} mb-1.5`} placeholder="Search name or code…"
              value={employeeSearch} onChange={(e) => setEmployeeSearch(e.target.value)} />
            <select className={inputCls} value={form.employee_id} size={5}
              onChange={(e) => setForm(p => ({ ...p, employee_id: e.target.value }))}>
              {filteredEmployees.map((e: any) => (
                <option key={e.id} value={e.id}>{e.first_name} {e.last_name} ({e.employee_code}) · {e.branch_name || '—'}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Leave Type<span className="text-red-600"> *</span></label>
              <select className={inputCls} value={form.leave_type_id}
                onChange={(e) => setForm(p => ({ ...p, leave_type_id: e.target.value }))}>
                <option value="">Encashable types…</option>
                {encashableTypes.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Days<span className="text-red-600"> *</span></label>
              <input type="number" step="0.5" min={0.5} className={inputCls} value={form.days}
                onChange={(e) => setForm(p => ({ ...p, days: e.target.value }))} />
            </div>
          </div>
          {balance !== null && (
            <p className={`text-xs ${Number(form.days) > balance ? 'text-red-600' : 'text-secondary'}`}>
              Balance: {balance} day(s) remaining{Number(form.days) > balance ? ' — not enough for this encashment' : ''}
            </p>
          )}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Note</label>
            <textarea rows={2} className={`${inputCls} resize-none`} value={form.note}
              onChange={(e) => setForm(p => ({ ...p, note: e.target.value }))} placeholder="Optional context" />
          </div>
          <p className="text-xs text-secondary">The per-day rate is computed automatically as the employee&apos;s current <b>Basic ÷ 30</b> and frozen on the record.</p>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors">Cancel</button>
          <button onClick={() => createMutation.mutate()} disabled={!canSubmit || createMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {createMutation.isPending && <Loader2 size={14} className="animate-spin" />} Record Encashment
          </button>
        </div>
      </div>
    </div>
  );
}
