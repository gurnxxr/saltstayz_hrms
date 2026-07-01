'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import { CalendarCheck, CalendarOff, Clock, Wallet, CalendarPlus, FileText, User, BarChart3, RefreshCw, Loader2 } from 'lucide-react';

const fmt = (t?: string) => (t ? t.slice(0, 5) : '');

export default function EmployeeDashboard() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [shiftModal, setShiftModal] = useState(false);
  const [requestedShift, setRequestedShift] = useState('');
  const [shiftReason, setShiftReason] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['my-overview'],
    queryFn: () => api.get('/analytics/me/overview').then(r => r.data).catch(() => null),
  });

  const { data: myShift } = useQuery({
    queryKey: ['my-shift'],
    queryFn: () => api.get('/shifts/me').then(r => r.data).catch(() => null),
  });
  const { data: shiftTypes = [] } = useQuery({
    queryKey: ['shift-types-for-request'],
    queryFn: () => api.get('/shifts/types').then(r => r.data).catch(() => []),
    enabled: shiftModal,
  });
  const { data: myShiftRequests = [] } = useQuery({
    queryKey: ['my-shift-requests'],
    queryFn: () => api.get('/shifts/me/change-requests').then(r => r.data).catch(() => []),
  });
  const pendingShiftReq = myShiftRequests.find((r: any) => r.status === 'pending');

  const requestShiftMutation = useMutation({
    mutationFn: () => api.post('/shifts/me/change-request', { shift_type_id: Number(requestedShift), reason: shiftReason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-shift-requests'] });
      toast.success('Shift-change request submitted');
      setShiftModal(false);
      setRequestedShift('');
      setShiftReason('');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to submit request'),
  });

  const att = data?.attendance ?? { present: 0, total: 0, present_pct: 0, avg_working_hours: 0, on_leave: 0, absent: 0, half_day: 0 };
  const leave = data?.leave ?? { balances: [], remaining: 0, used_days: 0, total_days: 0, pending_count: 0 };

  const monthLabel = data?.month
    ? new Date(`${data.month}-01`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    : 'This month';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">My Dashboard</h1>
        <p className="text-secondary mt-1">Your attendance and leave at a glance — {monthLabel}</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card icon={<CalendarCheck className="w-6 h-6" />} label="Attendance (this month)"
          value={isLoading ? '--' : `${att.present_pct}%`} sub={`${att.present}/${att.total} days present`}
          color="bg-green-50 text-green-600" />
        <Card icon={<Clock className="w-6 h-6" />} label="Avg working hours"
          value={isLoading ? '--' : (att.avg_working_hours || 0)} sub="per marked day"
          color="bg-blue-50 text-blue-600" />
        <Card icon={<Wallet className="w-6 h-6" />} label="Leave remaining"
          value={isLoading ? '--' : leave.remaining} sub={`${leave.used_days} used of ${leave.total_days}`}
          color="bg-amber-50 text-amber-600" />
        <Card icon={<CalendarOff className="w-6 h-6" />} label="Pending requests"
          value={isLoading ? '--' : leave.pending_count} sub="awaiting approval"
          color="bg-red-50 text-red-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Leave balances */}
        <div className="bg-card rounded-xl border border-border p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">My Leave Balance</h2>
          {leave.balances.length === 0 ? (
            <p className="text-sm text-secondary py-6 text-center">No leave balances configured.</p>
          ) : (
            <div className="space-y-4">
              {leave.balances.map((b: any) => {
                const pct = b.total_days > 0 ? Math.round((b.used_days / b.total_days) * 100) : 0;
                return (
                  <div key={b.leave_type}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-foreground font-medium">{b.leave_type}</span>
                      <span className="text-secondary">{b.remaining} left · {b.used_days}/{b.total_days} used</span>
                    </div>
                    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${pct >= 100 ? 'bg-red-500' : 'bg-primary'}`} style={{ width: `${Math.min(100, pct)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* This-month attendance breakdown */}
        <div className="bg-card rounded-xl border border-border p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">This Month</h2>
          <div className="grid grid-cols-2 gap-3">
            <Mini label="Present" value={att.present} color="text-green-600" />
            <Mini label="Absent" value={att.absent} color="text-red-600" />
            <Mini label="Half day" value={att.half_day} color="text-amber-600" />
            <Mini label="On leave" value={att.on_leave} color="text-blue-600" />
          </div>
        </div>
      </div>

      {/* My Shift */}
      <div className="bg-card rounded-xl border border-border p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-secondary">My Shift</p>
              {myShift ? (
                <p className="text-lg font-bold text-foreground">
                  {myShift.name} <span className="text-sm font-normal text-secondary">({fmt(myShift.start_time)}–{fmt(myShift.end_time)})</span>
                </p>
              ) : (
                <p className="text-lg font-bold text-foreground">No shift assigned</p>
              )}
              {pendingShiftReq && (
                <p className="text-xs text-amber-600 mt-0.5">Change to <b>{pendingShiftReq.requested_shift}</b> — pending approval</p>
              )}
            </div>
          </div>
          <button
            onClick={() => setShiftModal(true)}
            disabled={!!pendingShiftReq}
            title={pendingShiftReq ? 'You already have a pending request' : ''}
            className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            <RefreshCw size={15} /> Request change
          </button>
        </div>
      </div>

      {/* Quick actions */}
      <div className="bg-card rounded-xl border border-border p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Quick Actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Apply for Leave', href: '/attendance', icon: CalendarPlus },
            { label: 'My Attendance', href: '/attendance', icon: CalendarCheck },
            { label: 'My Performance', href: '/analytics', icon: BarChart3 },
            { label: 'My Payslips', href: '/payroll', icon: FileText },
            { label: 'My Profile', href: '/profile', icon: User },
          ].map(a => (
            <button key={a.label} onClick={() => router.push(a.href)}
              className="flex items-center gap-2 px-4 py-3 border border-border rounded-lg text-sm font-medium text-foreground hover:bg-muted transition-colors text-left">
              <a.icon size={16} className="text-secondary shrink-0" /> {a.label}
            </button>
          ))}
        </div>
      </div>

      {/* Request shift change modal */}
      {shiftModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShiftModal(false)}>
          <div className="bg-card rounded-xl border border-border w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <RefreshCw size={18} className="text-primary" /> Request Shift Change
            </h3>
            <p className="text-sm text-secondary mt-1">
              Current: <b>{myShift ? `${myShift.name} (${fmt(myShift.start_time)}–${fmt(myShift.end_time)})` : 'No shift assigned'}</b>. Your request goes to a manager for approval.
            </p>

            <label className="block text-sm font-medium text-foreground mt-4 mb-1">Requested shift</label>
            <select value={requestedShift} onChange={(e) => setRequestedShift(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
              <option value="">Select a shift…</option>
              {shiftTypes.filter((s: any) => s.is_active && s.id !== myShift?.shift_type_id).map((s: any) => (
                <option key={s.id} value={s.id}>{s.name} ({fmt(s.start_time)}–{fmt(s.end_time)})</option>
              ))}
            </select>

            <label className="block text-sm font-medium text-foreground mt-3 mb-1">Reason <span className="text-secondary font-normal">(optional)</span></label>
            <textarea value={shiftReason} onChange={(e) => setShiftReason(e.target.value)} rows={2}
              placeholder="Why do you need this change?"
              className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none" />

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShiftModal(false)} className="px-4 py-2 border border-border rounded-lg text-sm">Cancel</button>
              <button
                onClick={() => requestShiftMutation.mutate()}
                disabled={!requestedShift || requestShiftMutation.isPending}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {requestShiftMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Submit request
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-sm text-secondary truncate">{label}</p>
          <p className="text-2xl font-bold text-foreground mt-1">{value}</p>
          {sub && <p className="text-xs text-secondary mt-0.5">{sub}</p>}
        </div>
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${color}`}>{icon}</div>
      </div>
    </div>
  );
}

function Mini({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-border p-3 text-center">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-secondary mt-0.5">{label}</p>
    </div>
  );
}
