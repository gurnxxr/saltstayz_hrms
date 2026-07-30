'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/utils';
import { istToday, relativeDay, rosterHint, dayOf } from '@/lib/holidays';
import type { MyHolidaysResponse, HolidayRow } from '@/lib/types';
import { ArrowRight, CalendarOff, CalendarDays } from 'lucide-react';

/**
 * The next few holidays, for the dashboard. Used on both the employee and the org dashboard —
 * HR and admins take the same holidays as everyone else.
 *
 * Failures are swallowed (`.catch(() => null)`), matching the dashboard's bargain that a broken
 * self-service endpoint hides its own card rather than taking the page down with it. The full
 * list at /leaves/my?tab=holidays has a real error state with a retry.
 */
export default function UpcomingHolidaysCard() {
  const { user } = useAuth();
  // Not every login is linked to an employee record. The server answers 400 for those, so don't
  // ask at all — no request, no card.
  const hasEmployee = user?.employeeId != null;

  const today = istToday();
  const year = Number(today.slice(0, 4));

  const { data, isLoading } = useQuery<MyHolidaysResponse | null>({
    // Keep the ['my-holidays', …] prefix: the admin holidays screen invalidates ['my-holidays']
    // and react-query matches by prefix, so admin edits refresh this card for free.
    queryKey: ['my-holidays', year],
    queryFn: () => api.get(`/leave/holidays/me?year=${year}`).then(r => r.data).catch(() => null),
    enabled: hasEmployee,
  });

  const leftThisYear = (data?.holidays ?? []).filter(h => h.date >= today);

  // In late December the next holiday is in January. Only pay for the extra request once this
  // year is genuinely used up.
  const { data: nextYear } = useQuery<MyHolidaysResponse | null>({
    queryKey: ['my-holidays', year + 1],
    queryFn: () => api.get(`/leave/holidays/me?year=${year + 1}`).then(r => r.data).catch(() => null),
    enabled: hasEmployee && !!data && leftThisYear.length === 0,
  });

  if (!hasEmployee) return null;

  if (isLoading) {
    return (
      <div className="bg-card rounded-xl border border-border p-6 animate-pulse">
        <div className="h-5 w-28 bg-muted rounded" />
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="h-[86px] bg-muted rounded-lg" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="h-[86px] bg-muted rounded-lg" />
            <div className="h-[86px] bg-muted rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  const upcoming = (leftThisYear.length
    ? leftThisYear
    : (nextYear?.holidays ?? []).filter(h => h.date >= today)
  ).slice(0, 3);

  const [hero, ...rest] = upcoming;
  const total = data?.counts.total ?? 0;

  return (
    <div className="bg-card rounded-xl border border-border p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-lg font-semibold text-foreground">Holidays</h2>
        <Link
          href="/leaves/my?tab=holidays"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline shrink-0"
        >
          {total > 0 ? `See all ${total}` : 'See all'} <ArrowRight size={14} />
        </Link>
      </div>

      {!hero ? (
        <div className="flex items-center gap-3 py-2">
          <CalendarOff size={20} className="text-secondary shrink-0" />
          <p className="text-sm text-secondary">
            No holidays left this year. Your {year + 1} calendar appears here once HR publishes it.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <HeroHoliday holiday={hero} today={today} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {rest.map(h => <NextHoliday key={h.id} holiday={h} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function HeroHoliday({ holiday, today }: { holiday: HolidayRow; today: string }) {
  const hint = rosterHint(holiday);
  return (
    <div className="flex items-start gap-4 rounded-lg border border-primary/25 bg-primary/5 p-4">
      <div className="shrink-0 w-14 rounded-lg bg-primary text-white text-center py-1.5">
        <span className="block text-xl font-bold leading-none">{dayOf(holiday.date)}</span>
        <span className="block text-[10px] font-semibold uppercase tracking-wide mt-1">
          {formatDate(holiday.date, { day: undefined, month: 'short', year: undefined })}
        </span>
      </div>
      <div className="min-w-0">
        <p className="text-base font-semibold text-foreground truncate">{holiday.name}</p>
        <p className="text-sm text-secondary mt-0.5">
          <span className="font-medium text-primary">{relativeDay(holiday.date, today)}</span>
          {' · '}
          {formatDate(holiday.date, { weekday: 'short', year: undefined })}
        </p>
        <Hint hint={hint} />
      </div>
    </div>
  );
}

function NextHoliday({ holiday }: { holiday: HolidayRow }) {
  return (
    <div className="rounded-lg border border-border p-3 min-w-0">
      <p className="text-xs font-medium text-secondary">
        {formatDate(holiday.date, { weekday: 'short', year: undefined })}
      </p>
      <p className="text-sm font-medium text-foreground truncate mt-0.5">{holiday.name}</p>
      <Hint hint={rosterHint(holiday)} compact />
    </div>
  );
}

function Hint({ hint, compact = false }: { hint: ReturnType<typeof rosterHint>; compact?: boolean }) {
  if (!hint) return null;
  return (
    <p
      title={hint.detail}
      className={`mt-1 inline-flex items-center gap-1 font-medium ${compact ? 'text-[11px]' : 'text-xs'} ${
        hint.tone === 'warn' ? 'text-amber-700' : 'text-green-700'
      }`}
    >
      <CalendarDays size={12} className="shrink-0" /> {hint.text}
    </p>
  );
}
