'use client';

import { Fragment, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import Breadcrumb from '@/components/ui/Breadcrumb';
import LoadError from '@/components/ui/LoadError';
import api from '@/lib/api';
import { Bell, Info, BarChart3, Loader2 } from 'lucide-react';

interface AudienceMeta { key: string; label: string; note: string; scoped: boolean }
interface EventRow {
  key: string;
  group: string;
  label: string;
  description: string;
  carriesEmployee: boolean;
  selectableAudiences: string[];
  enabled: string[];
}
interface Grid { audiences: AudienceMeta[]; events: EventRow[] }

interface ActivityRow { label: string; group: string; this_week: number; this_month: number; last_month: number }
interface Activity { week_starting: string; month: string; last_month: string; rows: ActivityRow[] }

const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
};

export default function NotificationSettingsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'who' | 'activity'>('who');
  const [saving, setSaving] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<Grid>({
    queryKey: ['notification-settings'],
    queryFn: () => api.get('/notifications/settings').then((r) => r.data),
  });

  const save = useMutation({
    mutationFn: ({ eventKey, audiences }: { eventKey: string; audiences: string[] }) =>
      api.put(`/notifications/settings/${eventKey}`, { audiences }).then((r) => r.data),
    onMutate: ({ eventKey }) => setSaving(eventKey),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notification-settings'] }),
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Could not save'),
    onSettled: () => setSaving(null),
  });

  function toggle(ev: EventRow, audience: string) {
    const next = ev.enabled.includes(audience)
      ? ev.enabled.filter((a) => a !== audience)
      : [...ev.enabled, audience];
    save.mutate({ eventKey: ev.key, audiences: next });
  }

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex items-center gap-2 text-secondary p-6">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading notification settings…
        </div>
      </AppShell>
    );
  }
  if (isError || !data) {
    return <AppShell><LoadError onRetry={() => refetch()} /></AppShell>;
  }

  const groups = [...new Set(data.events.map((e) => e.group))];

  return (
    <AppShell>
      <div className="space-y-6">
        <Breadcrumb items={[{ label: 'Admin', href: '/admin' }, { label: 'Notifications' }]} />

        <div className="flex items-start gap-3">
          <Bell className="w-6 h-6 text-primary mt-1" />
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Notifications</h1>
            <p className="text-sm text-secondary mt-1">
              Choose who is told when something happens. Being notified is not the same as approving —
              ticking Admin on leave requests means admin <em>hears</em> about them, not that admin has
              to approve them.
            </p>
          </div>
        </div>

        <div className="flex gap-1 border-b border-border">
          {([['who', 'Who gets told'], ['activity', 'Activity']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-secondary hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'who' ? (
          <>
            <div className="flex gap-3 p-4 rounded-lg bg-muted border border-border text-sm text-secondary">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p>
                  <strong className="text-foreground">The employee always hears about their own
                  request</strong> — that is not configurable here. These boxes decide who <em>else</em> knows.
                </p>
                <p>
                  <strong className="text-foreground">HR, Finance and Admin are company-wide.</strong>{' '}
                  Ticking one notifies every user with that role, at every property. Use Property manager
                  or Cluster HR to reach only the people responsible for that employee&apos;s property.
                </p>
                <p>
                  <strong className="text-foreground">No reporting manager?</strong> If an employee has
                  none on file, HR is notified in their place, so a request never lands nowhere.
                </p>
              </div>
            </div>

            <div className="bg-card border border-border rounded-lg overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left font-medium text-secondary px-4 py-3 w-[38%]">Event</th>
                    {data.audiences.map((a) => (
                      <th key={a.key} className="px-3 py-3 text-center align-bottom">
                        <div className="font-medium text-foreground">{a.label}</div>
                        <div className="text-[11px] font-normal text-secondary mt-1 leading-snug">
                          {a.note}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => (
                    <Fragment key={group}>
                      <tr className="bg-muted/50">
                        <td
                          colSpan={data.audiences.length + 1}
                          className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-secondary"
                        >
                          {group}
                        </td>
                      </tr>
                      {data.events.filter((e) => e.group === group).map((ev) => (
                        <tr key={ev.key} className="border-t border-border hover:bg-muted/30">
                          <td className="px-4 py-3">
                            <div className="text-foreground">{ev.label}</div>
                            <div className="text-xs text-secondary mt-0.5">{ev.description}</div>
                          </td>
                          {data.audiences.map((a) => {
                            const selectable = ev.selectableAudiences.includes(a.key);
                            return (
                              <td key={a.key} className="px-3 py-3 text-center">
                                <input
                                  type="checkbox"
                                  className="w-4 h-4 accent-primary disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer"
                                  checked={ev.enabled.includes(a.key)}
                                  disabled={!selectable || saving === ev.key}
                                  onChange={() => toggle(ev, a.key)}
                                  title={selectable
                                    ? `Notify ${a.label} when: ${ev.label}`
                                    : 'This event is not about a particular employee, so it cannot reach their property’s staff'}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-secondary">
              Changes save as you tick. Greyed-out boxes are events with no employee attached — a
              nightly job failure has no property, so it cannot reach a property manager.
            </p>
          </>
        ) : (
          <ActivityTab />
        )}
      </div>
    </AppShell>
  );
}

function ActivityTab() {
  const { data, isLoading, isError, refetch } = useQuery<Activity>({
    queryKey: ['notification-activity'],
    queryFn: () => api.get('/notifications/settings/activity').then((r) => r.data),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-secondary py-8">
        <Loader2 className="w-4 h-4 animate-spin" /> Counting…
      </div>
    );
  }
  if (isError || !data) return <LoadError onRetry={() => refetch()} />;

  const groups = [...new Set(data.rows.map((r) => r.group))];

  return (
    <div className="space-y-4">
      <div className="flex gap-3 p-4 rounded-lg bg-muted border border-border text-sm text-secondary">
        <BarChart3 className="w-4 h-4 shrink-0 mt-0.5" />
        <p>
          How much of each thing is happening — the question a notification bell cannot answer.
          Counted from the records themselves, so these figures do not change when you tick or untick
          a box on the other tab.
        </p>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left font-medium text-secondary px-4 py-3">Activity</th>
              <th className="text-right font-medium text-secondary px-4 py-3 w-32">
                This week
                <div className="text-[11px] font-normal">from {data.week_starting}</div>
              </th>
              <th className="text-right font-medium text-secondary px-4 py-3 w-36">
                This month
                <div className="text-[11px] font-normal">{monthLabel(data.month)}</div>
              </th>
              <th className="text-right font-medium text-secondary px-4 py-3 w-36">
                Last month
                <div className="text-[11px] font-normal">{monthLabel(data.last_month)}</div>
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <Fragment key={group}>
                <tr className="bg-muted/50">
                  <td colSpan={4} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-secondary">
                    {group}
                  </td>
                </tr>
                {data.rows.filter((r) => r.group === group).map((r) => (
                  <tr key={r.label} className="border-t border-border">
                    <td className="px-4 py-3 text-foreground">{r.label}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">{r.this_week}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">{r.this_month}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-secondary">{r.last_month}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
