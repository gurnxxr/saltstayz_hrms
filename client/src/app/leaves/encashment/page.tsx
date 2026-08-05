'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import Breadcrumb from '@/components/ui/Breadcrumb';
import LoadError from '@/components/ui/LoadError';
import EmptyState from '@/components/ui/EmptyState';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Modal from '@/components/ui/Modal';
import StatusPill from '@/components/ui/StatusPill';
import RejectDialog from '@/components/leaves/RejectDialog';
import { btnCls, inputCls, labelCls, table } from '@/components/ui/styles';
import { leaveStatusMeta, ENCASHMENT_STATUS_OPTIONS } from '@/lib/leaveStatus';
import { cn, formatINR } from '@/lib/utils';
import { Plus, Coins, Check, X, Loader2 } from 'lucide-react';

export default function LeaveEncashmentPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState<any | null>(null);
  const [rejecting, setRejecting] = useState<any | null>(null);

  const { data: rows = [], isError, isLoading, refetch } = useQuery({
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
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to reject'),
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <Breadcrumb className="mb-2" items={[{ label: 'Leaves', href: '/leaves/my' }, { label: 'Encashment' }]} />
            <h1 className="text-2xl font-bold text-foreground">Leave Encashment</h1>
            <p className="text-secondary mt-1">Encash unused leave — approving deducts the days from the balance; Finance pays the amount outside payroll</p>
          </div>
          <button onClick={() => setShowNew(true)} className={btnCls('primary')}>
            <Plus size={16} /> New Encashment
          </button>
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter encashments by status"
          className={cn(inputCls, 'w-auto')}
        >
          <option value="">All statuses</option>
          {ENCASHMENT_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {/* Error → loading → empty → content. This screen had no loading state at all, so
            "No encashments yet" was what an approver read while the list was still on its way. */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {isError ? (
            <LoadError message="Couldn't load encashments." onRetry={() => refetch()} />
          ) : isLoading ? (
            <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-secondary" /></div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Coins}
              title={statusFilter ? 'No encashments with that status' : 'No encashments yet'}
              body={statusFilter ? undefined : "Encash an employee's unused encashable leave (e.g. Earned Leave)."}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={table.head}>
                    <th className={table.th}>Employee</th>
                    <th className={table.th}>Leave Type</th>
                    <th className={cn(table.th, 'text-right')}>Days</th>
                    <th className={cn(table.th, 'text-right')}>Rate/day</th>
                    <th className={cn(table.th, 'text-right')}>Amount</th>
                    <th className={table.th}>Status</th>
                    <th className={table.th}>Note</th>
                    <th className={cn(table.th, 'text-right')}>Actions</th>
                  </tr>
                </thead>
                <tbody className={table.body}>
                  {rows.map((r: any) => (
                    <tr key={r.id} className={table.row}>
                      <td className={table.td}>
                        <p className="font-medium text-foreground">{r.first_name} {r.last_name}</p>
                        <p className="text-xs text-secondary">{r.employee_code} · {r.branch_name || '—'}</p>
                      </td>
                      <td className={cn(table.td, 'text-secondary')}>{r.leave_type}<span className="block text-xs">{r.period_name}</span></td>
                      <td className={cn(table.td, 'text-right text-foreground')}>{r.days}</td>
                      <td className={cn(table.td, 'text-right text-secondary')}>{formatINR(r.per_day_rate)}</td>
                      <td className={cn(table.td, 'text-right font-medium text-foreground')}>{formatINR(r.amount)}</td>
                      <td className={table.td}>
                        <StatusPill {...leaveStatusMeta(r.status)} />
                        {r.rejection_reason && <p className="text-xs text-red-600 mt-0.5 max-w-40 truncate" title={r.rejection_reason}>{r.rejection_reason}</p>}
                      </td>
                      <td className={cn(table.td, 'text-xs text-secondary max-w-48 truncate')} title={r.note || ''}>{r.note || '—'}</td>
                      <td className={table.td}>
                        {r.status === 'pending' && (
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => setConfirmApprove(r)} className={btnCls('success', 'sm')}>
                              <Check size={12} /> Approve
                            </button>
                            <button onClick={() => setRejecting(r)} className={btnCls('danger', 'sm')}>
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

      {/* Mounted only while open so its four queries do not fire on page load. */}
      {showNew && <NewEncashmentDialog onClose={() => setShowNew(false)} />}

      {/* Approving here DOES get a confirmation, where approving leave does not, and that is
          deliberate rather than an oversight: the rule is irreversible-or-money-moving gets a
          confirm, reversible queue actions do not. This one moves money out of the business at a
          rate frozen on the record and settled by Finance outside payroll. */}
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

      <RejectDialog
        open={!!rejecting}
        title="Reject encashment"
        subject={rejecting ? <>{rejecting.first_name} {rejecting.last_name} — {rejecting.days} day(s), {formatINR(rejecting.amount)}. The balance is untouched.</> : undefined}
        loading={rejectMutation.isPending}
        // Keeps this screen's existing behaviour. Leave rejections now require a reason because it
        // is the only thing the employee is told; the same argument applies here and this is worth
        // revisiting, but widening it was not part of the change that was agreed.
        requireReason={false}
        onCancel={() => setRejecting(null)}
        onConfirm={(reason) => rejectMutation.mutate({ id: rejecting.id, reason })}
      />
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
    <Modal
      open
      title="New Leave Encashment"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={btnCls('secondary')}>Cancel</button>
          <button onClick={() => createMutation.mutate()} disabled={!canSubmit || createMutation.isPending} className={btnCls('primary')}>
            {createMutation.isPending && <Loader2 size={14} className="animate-spin" />} Record Encashment
          </button>
        </>
      }
    >
      <div>
        <label className={labelCls}>Employee<span className="text-red-600"> *</span></label>
        <input className={cn(inputCls, 'mb-1.5')} placeholder="Search name or code…"
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
          <label className={labelCls}>Leave Type<span className="text-red-600"> *</span></label>
          <select className={inputCls} value={form.leave_type_id}
            onChange={(e) => setForm(p => ({ ...p, leave_type_id: e.target.value }))}>
            <option value="">Encashable types…</option>
            {encashableTypes.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Days<span className="text-red-600"> *</span></label>
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
        <label className={labelCls}>Note</label>
        <textarea rows={2} className={cn(inputCls, 'resize-none')} value={form.note}
          onChange={(e) => setForm(p => ({ ...p, note: e.target.value }))} placeholder="Optional context" />
      </div>
      <p className="text-xs text-secondary">The per-day rate is computed automatically as the employee&apos;s current <b>Basic ÷ 30</b> and frozen on the record.</p>
    </Modal>
  );
}
