'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import Breadcrumb from '@/components/ui/Breadcrumb';
import LoadError from '@/components/ui/LoadError';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Clock, CalendarClock, ArrowRight, Loader2, Send } from 'lucide-react';

const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

export default function MyShiftsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const hasProfile = !!user?.employeeId;

  const [form, setForm] = useState({ date: '', target: '', reason: '' });

  const { data: roster, isError, refetch } = useQuery({
    queryKey: ['my-roster'],
    queryFn: () => api.get('/shifts/me/roster').then(r => r.data),
    enabled: hasProfile,
  });
  const { data: requests = [] } = useQuery({
    queryKey: ['my-change-requests'],
    queryFn: () => api.get('/shifts/me/change-requests').then(r => r.data),
    enabled: hasProfile,
  });

  const upcoming: any[] = roster?.upcoming ?? [];
  const shiftTypes: any[] = roster?.shift_types ?? [];

  const apply = useMutation({
    mutationFn: () => {
      const to_day_type = form.target === 'off' ? 'weekly_off' : 'working';
      const to_shift_type_id = form.target === 'off' ? undefined : Number(form.target);
      return api.post('/shifts/me/change-requests', { date: form.date, to_day_type, to_shift_type_id, reason: form.reason });
    },
    onSuccess: () => {
      toast.success('Change request submitted');
      setForm({ date: '', target: '', reason: '' });
      qc.invalidateQueries({ queryKey: ['my-change-requests'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not submit the request'),
  });

  const canSubmit = form.date && form.target;
  const selectedDay = useMemo(() => upcoming.find((u) => u.date === form.date), [upcoming, form.date]);

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <Breadcrumb className="mb-2" items={[{ label: 'My Shifts' }]} />
          <h1 className="text-2xl font-bold text-foreground">My Shifts</h1>
          <p className="text-secondary mt-1">Your upcoming shifts, and requests to change them</p>
        </div>

        {!hasProfile ? (
          <div className="bg-card rounded-xl border border-border p-8 text-center">
            <Clock size={32} className="mx-auto text-secondary/30 mb-2" />
            <p className="text-sm font-medium text-foreground">No shifts on this account</p>
            <p className="text-sm text-secondary mt-1">Your login isn&apos;t linked to an employee profile.</p>
          </div>
        ) : (
          <>
            {/* Upcoming shifts */}
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="px-6 py-4 border-b border-border">
                <h2 className="text-sm font-semibold text-foreground flex items-center gap-2"><CalendarClock size={16} className="text-primary" /> Upcoming Shifts</h2>
                <p className="text-xs text-secondary mt-0.5">Published by your manager. Only published shifts affect attendance and pay.</p>
              </div>
              {isError ? (
                <LoadError message="Couldn't load your shifts." onRetry={() => refetch()} />
              ) : upcoming.length === 0 ? (
                <div className="py-12 text-center">
                  <CalendarClock size={34} className="mx-auto text-secondary/30 mb-2" />
                  <p className="text-sm text-secondary">No upcoming published shifts.</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-left text-secondary">
                      <th className="px-6 py-2.5 text-xs font-semibold uppercase">Date</th>
                      <th className="px-4 py-2.5 text-xs font-semibold uppercase">Shift</th>
                      <th className="px-4 py-2.5 text-xs font-semibold uppercase">Timing</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {upcoming.map((u) => (
                      <tr key={u.date} className="hover:bg-muted/20">
                        <td className="px-6 py-3 font-medium text-foreground">{fmtDate(u.date)}</td>
                        <td className="px-4 py-3">
                          {u.day_type === 'weekly_off'
                            ? <span className="text-secondary italic">Weekly Off</span>
                            : <span className="text-foreground">{u.shift_name || 'Shift'}</span>}
                        </td>
                        <td className="px-4 py-3 text-secondary">
                          {u.day_type === 'weekly_off' || !u.start_time ? '—' : `${u.start_time}–${u.end_time}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Request a change */}
            <div className="bg-card rounded-xl border border-border p-6">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-1"><Send size={15} className="text-primary" /> Request a Shift Change</h2>
              <p className="text-xs text-secondary mb-4">Ask your reporting manager to change one of your upcoming shifts.</p>
              {upcoming.length === 0 ? (
                <p className="text-sm text-secondary">You have no upcoming shifts to request a change for.</p>
              ) : (
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="block text-xs font-medium text-secondary mb-1">Day</label>
                    <select value={form.date} onChange={(e) => setForm(p => ({ ...p, date: e.target.value }))}
                      className="px-3 py-2.5 border border-border rounded-lg bg-background text-sm min-w-[190px] focus:outline-none focus:ring-2 focus:ring-primary/50">
                      <option value="">Select a day…</option>
                      {upcoming.map((u) => (
                        <option key={u.date} value={u.date}>{fmtDate(u.date)} — {u.day_type === 'weekly_off' ? 'Weekly Off' : (u.shift_name || 'Shift')}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-secondary mb-1">Change to</label>
                    <select value={form.target} onChange={(e) => setForm(p => ({ ...p, target: e.target.value }))}
                      className="px-3 py-2.5 border border-border rounded-lg bg-background text-sm min-w-[220px] focus:outline-none focus:ring-2 focus:ring-primary/50">
                      <option value="">Select…</option>
                      <option value="off">Weekly Off</option>
                      {shiftTypes.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}{s.start_time ? ` (${s.start_time}–${s.end_time})` : ''}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1 min-w-[200px]">
                    <label className="block text-xs font-medium text-secondary mb-1">Reason</label>
                    <input value={form.reason} onChange={(e) => setForm(p => ({ ...p, reason: e.target.value }))}
                      placeholder="Optional context for your manager"
                      className="w-full px-3 py-2.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                  </div>
                  <button onClick={() => apply.mutate()} disabled={!canSubmit || apply.isPending}
                    className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                    {apply.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                    Submit
                  </button>
                </div>
              )}
              {selectedDay && (
                <p className="text-xs text-secondary mt-3">
                  Currently rostered: <span className="font-medium text-foreground">{selectedDay.day_type === 'weekly_off' ? 'Weekly Off' : (selectedDay.shift_name || 'Shift')}</span>
                </p>
              )}
            </div>

            {/* My requests */}
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="px-6 py-4 border-b border-border">
                <h2 className="text-sm font-semibold text-foreground">My Requests</h2>
              </div>
              {requests.length === 0 ? (
                <div className="py-12 text-center">
                  <Send size={30} className="mx-auto text-secondary/30 mb-2" />
                  <p className="text-sm text-secondary">No change requests yet.</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-left text-secondary">
                      <th className="px-6 py-2.5 text-xs font-semibold uppercase">Day</th>
                      <th className="px-4 py-2.5 text-xs font-semibold uppercase">Change</th>
                      <th className="px-4 py-2.5 text-xs font-semibold uppercase">Reason</th>
                      <th className="px-6 py-2.5 text-xs font-semibold uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {requests.map((r: any) => (
                      <tr key={r.id} className="hover:bg-muted/20">
                        <td className="px-6 py-3 font-medium text-foreground whitespace-nowrap">{fmtDate(String(r.date).slice(0, 10))}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5 text-foreground">
                            <span className="text-secondary">{r.from_day_type === 'weekly_off' ? 'Weekly Off' : (r.from_shift_name || 'Shift')}</span>
                            <ArrowRight size={13} className="text-primary shrink-0" />
                            <span className="font-medium">{r.to_day_type === 'weekly_off' ? 'Weekly Off' : (r.to_shift_name || 'Shift')}</span>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-secondary max-w-48 truncate" title={r.reason || ''}>{r.reason || '—'}{r.status === 'rejected' && r.review_note ? ` · ${r.review_note}` : ''}</td>
                        <td className="px-6 py-3">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLE[r.status] || 'bg-muted text-secondary'}`}>{r.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
