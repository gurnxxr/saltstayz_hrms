'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import LoadError from '@/components/ui/LoadError';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { offDaysInWords } from '@/lib/weeklyOff';
import { useMyWeeklyOff } from '@/components/shifts/WeeklyOffCard';
import { Clock, CalendarClock, Loader2, Send, Moon, ArrowRight } from 'lucide-react';

const inputCls =
  'w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

const fmtDate = (d: string) =>
  d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const todayStr = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export default function MyShiftsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const hasProfile = !!user?.employeeId;

  // The RESOLVED off days — the shift's own pattern, then the leave template, then the Default
  // template, then the company work week. Shared with the dashboard card so the two cannot differ.
  const { data: weeklyOff } = useMyWeeklyOff();

  const [form, setForm] = useState({ date: todayStr(), target: '', reason: '' });

  // Its own key, NOT the dashboard card's 'my-shift'. React Query caches by key alone, so when
  // both used that name whichever screen loaded first filled the slot — land on the dashboard,
  // open this page, and it was handed a reply with no `current` in it and said "No shift
  // assigned yet" to someone who had one.
  const { data, isError, refetch } = useQuery({
    queryKey: ['my-shift-overview'],
    queryFn: () => api.get('/shifts/me/shift').then(r => r.data),
    enabled: hasProfile,
  });
  const { data: requests = [] } = useQuery({
    queryKey: ['my-change-requests'],
    queryFn: () => api.get('/shifts/me/change-requests').then(r => r.data),
    enabled: hasProfile,
  });

  const current = data?.current ?? null;
  const upcoming: any[] = data?.upcoming ?? [];
  const shiftTypes: any[] = data?.shift_types ?? [];
  const pending = requests.some((r: any) => r.status === 'pending');

  const apply = useMutation({
    mutationFn: () => api.post('/shifts/me/change-requests', {
      date: form.date,
      to_shift_type_id: Number(form.target),
      reason: form.reason,
    }),
    onSuccess: () => {
      toast.success('Change request submitted');
      setForm({ date: todayStr(), target: '', reason: '' });
      qc.invalidateQueries({ queryKey: ['my-change-requests'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not submit the request'),
  });

  const selected = shiftTypes.find((s: any) => String(s.id) === form.target);
  const canSubmit = !!form.date && !!form.target && !pending;

  if (!hasProfile) {
    return (
      <AppShell>
        <div className="space-y-6">
          <div className="bg-card rounded-xl border border-border p-10 text-center text-secondary">
            This account isn&apos;t linked to an employee record, so there is no shift to show.
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold text-foreground">My Shift</h1>
          <p className="text-secondary mt-1">Your working hours and off days, and how to ask for a change.</p>
        </div>

        {isError ? (
          <LoadError message="Couldn't load your shift." onRetry={() => refetch()} />
        ) : (
          <>
            {/* ── The shift you're on ── */}
            <div className="bg-card rounded-xl border border-border p-5">
              {current ? (
                <>
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <div className="flex items-center gap-2">
                        <Clock size={18} className="text-primary" />
                        <h2 className="text-lg font-semibold text-foreground">{current.name}</h2>
                        {current.ends_next_day && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-purple-100 text-purple-700">
                            <Moon size={11} /> ends next day
                          </span>
                        )}
                      </div>
                      <p className="text-2xl font-bold text-foreground mt-2 tabular-nums">
                        {current.start_time} – {current.end_time}
                      </p>
                    </div>
                    {current.effective_from && (
                      <div className="text-right">
                        <p className="text-xs text-secondary">On this shift since</p>
                        <p className="text-sm font-medium text-foreground">{fmtDate(current.effective_from)}</p>
                      </div>
                    )}
                  </div>
                  <div className="mt-4 pt-4 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-secondary">Off days</p>
                      {/*
                        NOT `current.weekly_off_days`. That is only the FIRST of four rungs the
                        engine walks (payableDays.service, `policyFor`), migration 020 shipped every
                        shift with an empty array, and an empty rung falls THROUGH — it never means
                        "works every day". Rendering it here printed "Follows the company work week"
                        to essentially the whole workforce, which is false for anyone whose rest days
                        come from a leave template. That is the normal case.

                        The resolved answer comes from the attendance calendar, the one self-scoped
                        surface that walks the whole ladder. When it can't be fetched, say so — do
                        NOT fall back to rung 1, which is how this went wrong the first time.
                      */}
                      {weeklyOff === undefined ? (
                        <p className="text-secondary">Loading…</p>
                      ) : weeklyOff === null ? (
                        <p className="text-secondary">Couldn&apos;t load your off days</p>
                      ) : (
                        <>
                          <p className="text-foreground first-letter:uppercase">
                            {offDaysInWords(weeklyOff.days, { empty: 'No weekly off is set for you' })}
                          </p>
                          {/* Which rung decided it. Branch on the engine's own enum, not on the
                              display name — a leave template can be renamed to anything. */}
                          <p className="text-xs text-secondary mt-0.5">
                            {weeklyOff.decidedByKind === 'shift'
                              ? `Set by this shift · ${current.name}`
                              : weeklyOff.decidedBy
                                ? `From ${weeklyOff.decidedBy} — not from this shift`
                                : 'Nothing sets a rest day for you — ask HR'}
                          </p>
                        </>
                      )}
                    </div>
                    {current.office_hour_time && (
                      <div>
                        <p className="text-xs text-secondary">Expected hours a day</p>
                        <p className="text-foreground">{current.office_hour_time}</p>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-center py-6">
                  <Clock className="w-8 h-8 text-secondary mx-auto mb-2" />
                  <p className="text-sm font-medium text-foreground">No shift assigned yet</p>
                  <p className="text-sm text-secondary mt-1">Ask HR to put you on a shift.</p>
                </div>
              )}
            </div>

            {/* ── Anything already lined up ── */}
            {upcoming.length > 0 && (
              <div className="bg-card rounded-xl border border-border p-5">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
                  <CalendarClock size={15} /> Coming up
                </h2>
                <ul className="space-y-2">
                  {upcoming.map((u: any, i: number) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <span className="text-secondary tabular-nums">{fmtDate(u.effective_from)}</span>
                      <ArrowRight size={13} className="text-secondary" />
                      <span className="font-medium text-foreground">{u.shift_name}</span>
                      <span className="text-xs text-secondary">{u.start_time}–{u.end_time}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* ── Ask to move shift ── */}
            <div className="bg-card rounded-xl border border-border p-5 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Request a different shift</h2>
                <p className="text-xs text-secondary mt-0.5">
                  Goes to your reporting manager or HR. If approved, you move onto the new shift from the date you pick.
                </p>
              </div>

              {pending && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  You already have a request waiting to be reviewed.
                </p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Move me to</label>
                  <select
                    className={inputCls}
                    value={form.target}
                    disabled={pending}
                    onChange={(e) => setForm(f => ({ ...f, target: e.target.value }))}
                  >
                    <option value="">Select a shift…</option>
                    {shiftTypes
                      .filter((s: any) => s.id !== current?.shift_type_id)
                      .map((s: any) => (
                        <option key={s.id} value={s.id}>{s.name} ({s.start_time}–{s.end_time})</option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">From</label>
                  <input
                    type="date"
                    className={inputCls}
                    value={form.date}
                    min={todayStr()}
                    disabled={pending}
                    onChange={(e) => setForm(f => ({ ...f, date: e.target.value }))}
                  />
                </div>
              </div>

              {selected && (
                <p className="text-xs text-secondary">
                  {selected.name} runs {selected.start_time}–{selected.end_time}
                  {selected.ends_next_day ? ' (ends the next day)' : ''}. Your off days do not change —
                  they come from your leave plan, not from the shift.
                </p>
              )}

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Reason</label>
                <textarea
                  rows={2}
                  className={`${inputCls} resize-none`}
                  value={form.reason}
                  disabled={pending}
                  placeholder="Optional"
                  onChange={(e) => setForm(f => ({ ...f, reason: e.target.value }))}
                />
              </div>

              <button
                onClick={() => apply.mutate()}
                disabled={!canSubmit || apply.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {apply.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                Submit request
              </button>
            </div>

            {/* ── History ── */}
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="px-5 py-3 border-b border-border">
                <h2 className="text-sm font-semibold text-foreground">My requests</h2>
              </div>
              {requests.length === 0 ? (
                <p className="p-6 text-sm text-secondary text-center">You haven&apos;t asked for a shift change yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-left text-secondary">
                      <th className="px-4 py-2.5 font-medium">From date</th>
                      <th className="px-4 py-2.5 font-medium">Change</th>
                      <th className="px-4 py-2.5 font-medium">Reason</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {requests.map((r: any) => (
                      <tr key={r.id}>
                        <td className="px-4 py-2.5 text-secondary tabular-nums">{fmtDate(r.date)}</td>
                        <td className="px-4 py-2.5 text-foreground">
                          {r.from_shift_name || '—'} → <span className="font-medium">{r.to_shift_name || '—'}</span>
                        </td>
                        <td className="px-4 py-2.5 text-secondary">{r.reason || '—'}</td>
                        <td className="px-4 py-2.5">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLE[r.status] || 'bg-muted text-secondary'}`}>
                            {r.status}
                          </span>
                          {r.review_note && <p className="text-xs text-secondary mt-1">{r.review_note}</p>}
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
