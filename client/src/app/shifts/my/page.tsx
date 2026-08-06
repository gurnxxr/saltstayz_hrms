'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import EmptyState from '@/components/ui/EmptyState';
import LoadError from '@/components/ui/LoadError';
import StatusPill, { type Tone } from '@/components/ui/StatusPill';
import { btnCls, inputCls, labelCls, table } from '@/components/ui/styles';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, formatDate, formatDateTime } from '@/lib/utils';
import { istToday, relativeDay } from '@/lib/holidays';
import { offDaysInWords } from '@/lib/weeklyOff';
import { useMyWeeklyOff } from '@/components/shifts/WeeklyOffCard';
import {
  Clock, CalendarClock, Loader2, Send, Moon, ArrowRight, UserX, GitPullRequestArrow,
} from 'lucide-react';

/**
 * The three states `employee_shift_change_requests.status` can hold, in English.
 *
 * Deliberately NOT `leaveStatusMeta` from lib/leaveStatus.ts, even though that file's header invites
 * this page to adopt it. The reasoned paragraph above that invitation sets the doctrine that
 * overrides it — one domain vocabulary per file, the shape lib/employeeStatus.ts established — and
 * that file owns `leave_requests.status`, a DIFFERENT column carrying a fourth state (`cancelled`)
 * this one cannot hold. Its exported `LeaveStatus` union would be wrong here.
 *
 * The tones are deliberately the same three, which is what actually closes the divergence that
 * header flagged: `warning` is yellow-100/700, and this page was the only place in the app painting
 * `pending` amber-100/700. If a third module ever wants this, extract lib/reviewStatus.ts and have
 * both read it — that edits the leaves module, which is why it is not this change.
 */
const STATUS_META: Record<string, { label: string; tone: Tone }> = {
  pending:  { label: 'Pending',  tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger'  },
};
/** An unrecognised value keeps its own text rather than rendering an empty pill. */
const statusMeta = (s?: string | null): { label: string; tone: Tone } =>
  STATUS_META[s ?? ''] ?? { label: s || '—', tone: 'neutral' };

export default function MyShiftsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const hasProfile = !!user?.employeeId;

  // The RESOLVED off days — the shift's own pattern, then the leave template, then the Default
  // template, then the company work week. Shared with the dashboard card so the two cannot differ.
  const { data: weeklyOff } = useMyWeeklyOff();

  // IST, not the browser's local date. The server compares against
  // `new Date().toISOString().slice(0, 10)` (UTC) and refuses anything earlier; IST is UTC+5:30, so
  // this is never BEHIND the server's idea of today and can never offer a date it will reject.
  const [form, setForm] = useState({ date: istToday(), target: '', reason: '' });

  // Its own key, NOT the dashboard card's 'my-shift'. React Query caches by key alone, so when
  // both used that name whichever screen loaded first filled the slot — land on the dashboard,
  // open this page, and it was handed a reply with no `current` in it and said "No shift
  // assigned yet" to someone who had one.
  const {
    data: overview, isLoading: overviewLoading, isError: overviewError, refetch: refetchOverview,
  } = useQuery({
    queryKey: ['my-shift-overview'],
    queryFn: () => api.get('/shifts/me/shift').then(r => r.data),
    enabled: hasProfile,
  });

  // A SECOND query with its OWN ladder. It used to have neither `isLoading` nor `isError`, and the
  // list defaults to `[]`, so a request still in flight and a 500 both rendered "You haven't asked
  // for a shift change yet." — a fact, stated to someone who might have a dozen.
  const {
    data: requests = [], isLoading: requestsLoading, isError: requestsError, refetch: refetchRequests,
  } = useQuery({
    queryKey: ['my-change-requests'],
    queryFn: () => api.get('/shifts/me/change-requests').then(r => r.data),
    enabled: hasProfile,
  });

  const current = overview?.current ?? null;
  const upcoming: any[] = overview?.upcoming ?? [];
  const shiftTypes: any[] = overview?.shift_types ?? [];

  const pending = requests.some((r: any) => r.status === 'pending');
  // `pending` is false until the list lands, so the form used to be live during load: somebody with
  // an outstanding request saw enabled fields and no banner, submitted, and got the server's "You
  // already have a change request waiting to be reviewed." Lock it while we do not yet know.
  const formLocked = requestsLoading || pending;

  /**
   * The shift the SERVER will compare this request against.
   *
   * It resolves the shift for the REQUESTED DATE, not for today, then rejects a target equal to it.
   * This page filtered the picker by `current.shift_type_id` — today's shift — so anyone with an
   * assignment already listed under "Coming up" could pick that shift and be turned away with "You
   * are already on that shift from this date."
   *
   * `upcoming[]` carries no `shift_type_id`, but `shift_types.name` is UNIQUE (baseline migration)
   * and both sides read the same column, so the name maps back to an id exactly. `upcoming` is
   * already ascending by `effective_from`.
   *
   * KNOWN GAP: an assignment whose `effective_to` closes before the requested date would make the
   * server fall back to an earlier one, and `effective_to` is not on the wire. Closing that needs a
   * server change. Which is why the clashing option is DISABLED and named rather than removed — a
   * wrong prediction is then legible instead of an option that has silently gone missing.
   */
  const shiftOnDate = useMemo(() => {
    const lined = upcoming.filter((u: any) => String(u.effective_from).slice(0, 10) <= form.date).pop();
    if (lined) {
      const match = shiftTypes.find((s: any) => s.name === lined.shift_name);
      return { id: (match?.id as number | undefined) ?? null, name: lined.shift_name as string };
    }
    return current ? { id: current.shift_type_id as number, name: current.name as string } : null;
  }, [form.date, upcoming, shiftTypes, current]);

  const selected = shiftTypes.find((s: any) => String(s.id) === form.target) ?? null;
  const clash = !!form.target && shiftOnDate?.id != null && String(shiftOnDate.id) === form.target;
  const canSubmit = !!form.date && !!form.target && !clash && !formLocked;

  const apply = useMutation({
    mutationFn: () => api.post('/shifts/me/change-requests', {
      date: form.date,
      to_shift_type_id: Number(form.target),
      reason: form.reason,
    }),
    onSuccess: () => {
      toast.success('Change request submitted');
      // Clearing `target` also closes the window between this reset and the refetch landing:
      // `canSubmit` needs a target, so a second submit is impossible while `pending` catches up.
      setForm({ date: istToday(), target: '', reason: '' });
      qc.invalidateQueries({ queryKey: ['my-change-requests'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not submit the request'),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || apply.isPending) return;
    apply.mutate();
  }

  if (!hasProfile) {
    return (
      <AppShell>
        <div className="space-y-6 max-w-4xl">
          <PageHeader />
          <div className="bg-card rounded-xl border border-border">
            <EmptyState
              icon={UserX}
              title="No employee record linked to this account"
              body="Your sign-in isn't attached to an employee profile yet, so there is no shift to show. Ask HR to link it."
            />
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6 max-w-4xl">
        <PageHeader />

        {/* ── 1. The shift you're on, and what's lined up ─────────────────────────────────────
            There is no page-level error gate any more. The old one hid all four sections when the
            OVERVIEW query failed — including the requests table, which is fed by a different one. */}
        <div className="bg-card rounded-xl border border-border p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">Your shift</h2>

          {overviewError ? (
            <LoadError compact message="Couldn't load your shift." onRetry={() => refetchOverview()} />
          ) : overviewLoading ? (
            <ShiftCardSkeleton />
          ) : !current ? (
            <EmptyState
              compact
              icon={Clock}
              title="No shift assigned yet"
              body="Ask HR to put you on a shift — until then your working hours aren't set."
            />
          ) : (
            <>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-start gap-4 min-w-0">
                  <div className="shrink-0 w-11 h-11 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                    <Clock size={20} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-base font-semibold text-foreground">{current.name}</p>
                      {current.ends_next_day && (
                        <StatusPill tone="accent" size="sm" icon={Moon} label="Ends next day" />
                      )}
                    </div>
                    <p className="text-2xl font-bold text-foreground mt-1 tabular-nums">
                      {current.start_time} – {current.end_time}
                    </p>
                  </div>
                </div>
                {current.effective_from && (
                  <div className="sm:text-right">
                    <p className="text-xs text-secondary">On this shift since</p>
                    <p className="text-sm font-medium text-foreground tabular-nums">
                      {formatDate(current.effective_from)}
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-5 pt-5 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-secondary">Off days</p>
                  {/*
                    NOT `current.weekly_off_days`. That is only the FIRST of four rungs the engine
                    walks (payableDays.service, `policyFor`), migration 020 shipped every shift with
                    an empty array, and an empty rung falls THROUGH — it never means "works every
                    day". Rendering it here printed "Follows the company work week" to essentially
                    the whole workforce, which is false for anyone whose rest days come from a leave
                    template. That is the normal case.

                    The resolved answer comes from the attendance calendar, the one self-scoped
                    surface that walks the whole ladder. When it can't be fetched, say so — do NOT
                    fall back to rung 1, which is how this went wrong the first time.
                  */}
                  {weeklyOff === undefined ? (
                    <div className="h-4 w-44 bg-muted rounded mt-1.5 animate-pulse" />
                  ) : weeklyOff === null ? (
                    <p className="text-sm font-medium text-foreground">Couldn&apos;t load your off days</p>
                  ) : (
                    <>
                      {/* first-letter:uppercase, not capitalize: capitalize uppercases EVERY word,
                          so "every Sunday, plus the 2nd and 4th Saturday" becomes a headline. */}
                      <p className="text-sm font-medium text-foreground first-letter:uppercase">
                        {offDaysInWords(weeklyOff.days, { empty: 'No weekly off is set for you' })}
                      </p>
                      {/* Which rung decided it. Branch on the engine's own enum, not on the display
                          name — a leave template can be renamed to anything. */}
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
                {/* Unconditional, with the house missing-value glyph. It used to disappear when
                    null, so this grid was two columns for some people and one for others. */}
                <div>
                  <p className="text-xs text-secondary">Expected hours a day</p>
                  <p className="text-sm font-medium text-foreground tabular-nums">
                    {current.office_hour_time || '—'}
                  </p>
                </div>
              </div>

              {upcoming.length > 0 && (
                <div className="mt-5 pt-5 border-t border-border">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-secondary uppercase tracking-wide">
                    <CalendarClock size={13} /> Coming up
                  </p>
                  <ul className="mt-2 space-y-2">
                    {/* `effective_from` is the key, not the index: assignShift REPLACES rather than
                        stacks an entry with the same start date, so it is unique per employee. */}
                    {upcoming.map((u: any) => (
                      <li
                        key={u.effective_from}
                        className="flex items-center gap-x-2 gap-y-1 flex-wrap rounded-lg bg-muted/30 px-3 py-2"
                      >
                        <span className="text-sm font-medium text-foreground tabular-nums">
                          {formatDate(u.effective_from)}
                        </span>
                        <span className="text-xs text-secondary">{relativeDay(u.effective_from)}</span>
                        <ArrowRight size={14} className="text-primary shrink-0" />
                        <span className="text-sm font-medium text-foreground">{u.shift_name}</span>
                        <span className="text-xs text-secondary tabular-nums">
                          {u.start_time}–{u.end_time}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── 2. Ask to move shift ───────────────────────────────────────────────────────────── */}
        <div className="bg-card rounded-xl border border-border p-6">
          <h2 className="text-lg font-semibold text-foreground">Request a different shift</h2>
          <p className="text-sm text-secondary mt-1">
            Goes to your reporting manager or HR. If approved, you move onto the new shift from the
            date you pick.
          </p>

          {overviewError ? (
            <div className="mt-4">
              <LoadError
                compact
                message="Couldn't load the list of shifts."
                onRetry={() => refetchOverview()}
              />
            </div>
          ) : overviewLoading ? (
            <FormSkeleton />
          ) : (
            /* A real <form>, so Enter submits. There was no form element at all, and the button
               carried no `type`. */
            <form onSubmit={onSubmit} className="mt-4 space-y-4">
              {pending && (
                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  You already have a request waiting to be reviewed. You can send another once it has
                  been decided.
                </p>
              )}
              {requestsLoading && (
                <p className="text-sm text-secondary bg-muted/40 border border-border rounded-lg px-3 py-2">
                  Checking whether you already have a request open…
                </p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="shift-target" className={labelCls}>Move me to</label>
                  <select
                    id="shift-target"
                    className={inputCls}
                    value={form.target}
                    disabled={formLocked}
                    onChange={(e) => setForm(f => ({ ...f, target: e.target.value }))}
                  >
                    <option value="">Select a shift…</option>
                    {shiftTypes.map((s: any) => (
                      <option key={s.id} value={s.id} disabled={s.id === shiftOnDate?.id}>
                        {s.name} ({s.start_time}–{s.end_time})
                        {s.id === shiftOnDate?.id ? ' — you are already on this' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="shift-from" className={labelCls}>From</label>
                  <input
                    id="shift-from"
                    type="date"
                    className={inputCls}
                    value={form.date}
                    min={istToday()}
                    disabled={formLocked}
                    onChange={(e) => setForm(f => ({ ...f, date: e.target.value }))}
                  />
                  {shiftOnDate && (
                    <p className="text-xs text-secondary mt-1.5">
                      On that date you are on{' '}
                      <span className="font-medium text-foreground">{shiftOnDate.name}</span>.
                    </p>
                  )}
                </div>
              </div>

              {clash && (
                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  From {formatDate(form.date)} you are already on{' '}
                  <span className="font-medium">{shiftOnDate?.name}</span> — pick a different shift,
                  or change the date.
                </p>
              )}

              {selected && !clash && (
                <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1">
                  <p className="text-sm text-foreground">
                    <span className="font-medium">{selected.name}</span> runs{' '}
                    <span className="tabular-nums">{selected.start_time}–{selected.end_time}</span>
                    {selected.ends_next_day ? ' and ends the next day' : ''}.
                  </p>
                  {/*
                    This used to assert, unconditionally, that "your off days do not change — they
                    come from your leave plan, not from the shift". A shift's own pattern is rung 1
                    of the ladder and OVERRIDES the leave template, so that is false for any target
                    carrying one. An empty array is still not "no rest days" — it falls through, and
                    the resolved answer on the card above continues to hold. Two branches, both true.
                  */}
                  {selected.weekly_off_days?.length ? (
                    <p className="text-sm text-amber-800">
                      It sets its own rest days —{' '}
                      <span className="font-medium">
                        {offDaysInWords(selected.weekly_off_days, { empty: '' })}
                      </span>{' '}
                      — and those would replace your current off days from that date.
                    </p>
                  ) : (
                    <p className="text-sm text-secondary">
                      It sets no rest days of its own, so your off days stay as they are.
                    </p>
                  )}
                </div>
              )}

              <div>
                <label htmlFor="shift-reason" className={labelCls}>
                  Reason <span className="font-normal text-secondary">(optional)</span>
                </label>
                <textarea
                  id="shift-reason"
                  rows={2}
                  className={cn(inputCls, 'resize-none')}
                  value={form.reason}
                  disabled={formLocked}
                  placeholder="Anything that helps whoever reviews this"
                  onChange={(e) => setForm(f => ({ ...f, reason: e.target.value }))}
                />
              </div>

              <button type="submit" disabled={!canSubmit || apply.isPending} className={btnCls('primary', 'lg')}>
                {apply.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                Submit request
              </button>
            </form>
          )}
        </div>

        {/* ── 3. What you've asked for, and what happened to it ───────────────────────────────── */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {/* px-4, not p-6: aligns the heading's left edge with the first column's text. */}
          <div className="px-4 py-4 border-b border-border">
            <h2 className="text-lg font-semibold text-foreground">My requests</h2>
          </div>

          {requestsError ? (
            <LoadError message="Couldn't load your requests." onRetry={() => refetchRequests()} />
          ) : requestsLoading ? (
            <RequestsSkeleton />
          ) : requests.length === 0 ? (
            <EmptyState
              icon={GitPullRequestArrow}
              title="No shift change requests yet"
              body="Anything you ask for above shows up here, with when you asked and what was decided."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={table.head}>
                    <th className={table.th}>Asked on</th>
                    <th className={table.th}>Change</th>
                    <th className={table.th}>Effective from</th>
                    <th className={table.th}>Status</th>
                  </tr>
                </thead>
                <tbody className={table.body}>
                  {requests.map((r: any) => {
                    const meta = statusMeta(r.status);
                    // `updated_at` is NOT NULL DEFAULT now() at insert and is only bumped by
                    // decideChangeRequest, so on a pending row it EQUALS `created_at`. Printing it
                    // unconditionally would read "Decided today" on a request nobody has opened yet.
                    const decided = r.status !== 'pending';
                    return (
                      <tr key={r.id} className={table.row}>
                        <td
                          className={cn(table.td, 'align-top text-secondary tabular-nums whitespace-nowrap')}
                          title={formatDateTime(r.created_at)}
                        >
                          {formatDate(r.created_at)}
                        </td>
                        <td className={cn(table.td, 'align-top')}>
                          <span className="inline-flex items-center gap-1.5 text-foreground whitespace-nowrap">
                            <span className="text-secondary">{r.from_shift_name || 'No shift'}</span>
                            <ArrowRight size={13} className="text-primary shrink-0" />
                            <span className="font-medium">{r.to_shift_name || '—'}</span>
                          </span>
                          {r.reason && (
                            <p className="text-xs text-secondary mt-0.5 line-clamp-1 max-w-64" title={r.reason}>
                              Your reason: {r.reason}
                            </p>
                          )}
                        </td>
                        <td className={cn(table.td, 'align-top text-foreground tabular-nums whitespace-nowrap')}>
                          {formatDate(r.date)}
                        </td>
                        <td className={cn(table.td, 'align-top')}>
                          <StatusPill {...meta} />
                          {decided && (
                            <p
                              className="text-xs text-secondary mt-1 whitespace-nowrap"
                              title={formatDateTime(r.updated_at)}
                            >
                              Decided {formatDate(r.updated_at)}
                            </p>
                          )}
                          {/* Labelled, and inside the DECISION cell. It sat unlabelled under the
                              pill, directly after the employee's own reason column, so it read like
                              their own words echoed back at them. */}
                          {r.review_note && (
                            <p
                              className={cn(
                                'text-xs mt-0.5 max-w-64',
                                r.status === 'rejected' ? 'text-red-600' : 'text-secondary',
                              )}
                            >
                              Reviewer: {r.review_note}
                            </p>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function PageHeader() {
  return (
    <div>
      {/* "My Shifts", matching the sidebar entry in lib/constants.ts. The h1 said "My Shift". */}
      <h1 className="text-2xl font-bold text-foreground">My Shifts</h1>
      <p className="text-sm text-secondary mt-1">
        The shift you work, the days you don&apos;t, and how to ask for a change.
      </p>
    </div>
  );
}

// ─── Skeletons ────────────────────────────────────────────────────────────────────────────────
// One per card, shaped like the thing it stands in for, so nothing jumps when the data lands.

function ShiftCardSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="flex items-start gap-4">
        <div className="shrink-0 w-11 h-11 rounded-lg bg-muted" />
        <div className="flex-1">
          <div className="h-4 w-32 bg-muted rounded" />
          <div className="h-7 w-44 bg-muted rounded mt-2" />
        </div>
      </div>
      <div className="mt-5 pt-5 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <div className="h-3 w-16 bg-muted rounded" />
          <div className="h-4 w-48 bg-muted rounded mt-1.5" />
          <div className="h-3 w-36 bg-muted rounded mt-1.5" />
        </div>
        <div>
          <div className="h-3 w-28 bg-muted rounded" />
          <div className="h-4 w-14 bg-muted rounded mt-1.5" />
        </div>
      </div>
    </div>
  );
}

function FormSkeleton() {
  // 38px is inputCls at rest (py-2 + text-sm + border); 58px is rows={2}; 40px is btnCls size lg.
  return (
    <div className="mt-4 space-y-4 animate-pulse">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <div className="h-3.5 w-20 bg-muted rounded mb-1.5" />
          <div className="h-[38px] bg-muted rounded-lg" />
        </div>
        <div>
          <div className="h-3.5 w-10 bg-muted rounded mb-1.5" />
          <div className="h-[38px] bg-muted rounded-lg" />
        </div>
      </div>
      <div>
        <div className="h-3.5 w-16 bg-muted rounded mb-1.5" />
        <div className="h-[58px] bg-muted rounded-lg" />
      </div>
      <div className="h-10 w-36 bg-muted rounded-lg" />
    </div>
  );
}

function RequestsSkeleton() {
  return (
    <div className="animate-pulse divide-y divide-border">
      {/* The header row the real table draws: table.th is px-4 py-3 on text-xs. */}
      <div className="h-10 bg-muted/40" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="px-4 py-3.5 flex items-center gap-4">
          <div className="h-4 w-20 bg-muted rounded" />
          <div className="h-4 w-40 bg-muted rounded" />
          <div className="h-4 w-20 bg-muted rounded" />
          <div className="h-5 w-16 bg-muted rounded-full ml-auto" />
        </div>
      ))}
    </div>
  );
}
