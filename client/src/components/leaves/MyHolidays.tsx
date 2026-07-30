'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import LoadError from '@/components/ui/LoadError';
import { formatDate } from '@/lib/utils';
import { istToday, groupByMonth, rosterHint, monthOf, dayOf } from '@/lib/holidays';
import type { MyHolidaysResponse, HolidayRow } from '@/lib/types';
import { CalendarDays, MapPin, ChevronLeft, ChevronRight, AlertTriangle, CornerDownRight } from 'lucide-react';

/**
 * The holidays that apply to the signed-in person, for a whole year, grouped by month.
 *
 * Each row says how the day lands on THEIR roster, because the same holiday is a day off for
 * one person and an ordinary rest day for the next.
 */
export default function MyHolidays() {
  const today = istToday();
  const currentYear = Number(today.slice(0, 4));
  const currentMonth = monthOf(today);
  const [year, setYear] = useState(currentYear);

  // Keep the ['my-holidays', …] prefix — the admin holidays screen invalidates ['my-holidays']
  // and react-query matches by prefix. No .catch() here: a real failure must reach LoadError
  // rather than masquerade as "no holidays published".
  const { data, isLoading, isError, refetch } = useQuery<MyHolidaysResponse>({
    queryKey: ['my-holidays', year],
    queryFn: () => api.get(`/leave/holidays/me?year=${year}`).then(r => r.data),
  });

  const monthRef = useRef<HTMLElement | null>(null);
  const scrolledOnce = useRef(false);

  // Land on the current month. scrollIntoView, NOT window.scrollTo — the scroll container is
  // <main> inside AppShell, so scrolling the window does nothing.
  useEffect(() => {
    if (scrolledOnce.current || isLoading || year !== currentYear || !monthRef.current) return;
    scrolledOnce.current = true;
    monthRef.current.scrollIntoView({ block: 'start', behavior: 'auto' });
  }, [isLoading, year, currentYear]);

  const jumpToThisMonth = () => {
    if (year !== currentYear) { setYear(currentYear); return; }
    monthRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  const holidays = data?.holidays ?? [];
  const months = useMemo(() => groupByMonth(holidays, year), [holidays, year]);

  // Bounded by the years that actually have holidays, so an arrow never leads somewhere empty.
  const years = data?.available_years?.length ? data.available_years : [currentYear];
  const minYear = Math.min(...years, currentYear);
  const maxYear = Math.max(...years, currentYear);

  if (isError) return <LoadError message="Couldn't load holidays." onRetry={() => refetch()} />;
  if (isLoading) return <HolidaysSkeleton />;

  return (
    <div>
      {/* Fixed h-14 so the month headings can offset by exactly top-14 and never overlap it. */}
      <div className="sticky top-0 z-20 h-14 flex items-center justify-between gap-3 bg-background">
        <div role="group" aria-label="Year" className="flex items-center gap-1">
          <button
            onClick={() => setYear(y => y - 1)}
            disabled={year <= minYear}
            aria-label={`Previous year, ${year - 1}`}
            className="p-2 rounded-lg text-secondary hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            <ChevronLeft size={18} />
          </button>
          <span aria-live="polite" className="text-lg font-semibold text-foreground tabular-nums min-w-[4ch] text-center">
            {year}
          </span>
          <button
            onClick={() => setYear(y => y + 1)}
            disabled={year >= maxYear}
            aria-label={`Next year, ${year + 1}`}
            className="p-2 rounded-lg text-secondary hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        <button
          onClick={jumpToThisMonth}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-sm font-medium text-foreground hover:bg-muted transition-colors"
        >
          <CornerDownRight size={14} className="text-secondary" /> This month
        </button>
      </div>

      <ScopeNote data={data} />

      {/* When the banner above already explains the blank page — no department on file, or the
          calendar simply hasn't been given to this team yet — EmptyYear would sit underneath it
          contradicting it with "your HR team hasn't published a calendar". Show one or the other. */}
      {holidays.length === 0 && data?.dept_status === 'ok' && data?.scope_status !== 'no_holidays_for_you' ? (
        <EmptyYear year={year} currentYear={currentYear} onBack={() => setYear(currentYear)} />
      ) : holidays.length === 0 ? null : (
        <div className="mt-4 bg-card rounded-xl border border-border overflow-hidden">
          {months.map(m => {
            const isThisMonth = year === currentYear && m.month === currentMonth;
            const headingId = `holiday-month-${year}-${m.month}`;
            return (
              <section
                key={m.month}
                ref={isThisMonth ? monthRef : undefined}
                aria-labelledby={headingId}
                // Without this, scrollIntoView parks the heading underneath the sticky toolbar.
                className="scroll-mt-14"
              >
                <h3
                  id={headingId}
                  className={`sticky top-14 z-10 flex items-center gap-2 px-4 sm:px-5 py-2.5 border-b border-border text-sm font-semibold ${
                    isThisMonth ? 'bg-primary/10 text-primary' : 'bg-muted text-secondary'
                  }`}
                >
                  {m.label}
                  {isThisMonth && (
                    <span className="px-2 py-0.5 rounded-full bg-primary text-white text-[10px] font-bold uppercase tracking-wide">
                      This month
                    </span>
                  )}
                  <span className="ml-auto font-normal text-xs">{m.holidays.length || 'None'}</span>
                </h3>

                {m.holidays.length === 0 ? (
                  <p className="px-4 sm:px-5 py-3 text-sm text-secondary border-b border-border">
                    No holidays this month.
                  </p>
                ) : (
                  <ul role="list" className="divide-y divide-border border-b border-border">
                    {m.holidays.map(h => <HolidayItem key={h.id} h={h} today={today} />)}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function HolidayItem({ h, today }: { h: HolidayRow; today: string }) {
  const past = h.date < today;
  const isToday = h.date === today;
  const hint = rosterHint(h);

  return (
    <li className={`flex items-start gap-3 sm:gap-4 px-4 sm:px-5 py-3 ${past ? 'opacity-55' : ''} ${isToday ? 'bg-primary/5' : ''}`}>
      <div className={`shrink-0 w-12 rounded-lg border text-center py-1 ${
        isToday ? 'border-primary bg-primary text-white' : 'border-border bg-muted text-foreground'
      }`}>
        <span className="block text-base font-bold leading-tight">{dayOf(h.date)}</span>
        <span className={`block text-[10px] font-medium uppercase tracking-wide ${isToday ? 'text-white/85' : 'text-secondary'}`}>
          {formatDate(h.date, { day: undefined, month: undefined, year: undefined, weekday: 'short' })}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        {/* The chip splits the date across two lines, so give a screen reader the whole thing. */}
        <span className="sr-only">{formatDate(h.date, { weekday: 'long' })}. </span>
        <p className="text-sm font-medium text-foreground">
          {h.name}
          {isToday && <span className="ml-2 text-xs font-semibold text-primary">Today</span>}
        </p>
        {!h.in_employment && h.employment_note && (
          <p className="mt-0.5 text-xs text-secondary">{h.employment_note}</p>
        )}
        {hint && (
          <p
            title={hint.detail}
            className={`mt-0.5 text-xs font-medium ${hint.tone === 'warn' ? 'text-amber-700' : 'text-green-700'}`}
          >
            {hint.text}
            {hint.detail && hint.tone === 'good' && (
              <span className="hidden sm:inline text-secondary font-normal"> · {hint.detail}</span>
            )}
          </p>
        )}
      </div>

      {/* Only the exception is badged. Nearly every holiday is national, so a "National" pill on
          every row was twelve repetitions of something the header already says. */}
      {!h.is_national && (
        <span className="shrink-0 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
          {h.state || 'Regional'}
        </span>
      )}
    </li>
  );
}

/**
 * Where the list came from — or what is wrong that makes it short.
 *
 * Two kinds of problem, and they read differently. A work-location problem still returns the
 * national holidays, so it is a warning ABOVE a populated list: blanking the page would hide
 * real information and make a typo look like an outage. A DEPARTMENT problem returns nothing at
 * all, because holidays are given department by department — so that one must not promise a
 * list below it.
 */
function ScopeNote({ data }: { data?: MyHolidaysResponse }) {
  const status = data?.scope_status ?? 'ok';
  const deptStatus = data?.dept_status ?? 'ok';
  const property = data?.region?.property_name;
  const state = data?.region?.state;
  const department = data?.department?.department_name;
  const year = data?.year;

  // The department problem is the one that costs them everything, so it wins the banner.
  if (deptStatus !== 'ok') {
    const deptCopy = deptStatus === 'no_department_on_profile'
      ? {
        title: "We don't know which team you're in",
        body: 'Holidays are given team by team — housekeeping, front desk, management and so on — and your profile doesn\'t say which team you\'re in, so we can\'t work out which holidays are yours. Ask your HR team to add your department to your profile.',
      }
      : {
        title: "Your team name doesn't match any of our departments",
        body: `Your profile says you're in "${data?.dept_name ?? ''}", but that isn't one of the departments set up in the system, so we can't work out which holidays are yours. Ask your HR team to correct the department on your profile.`,
      };
    return <Warning {...deptCopy} />;
  }

  if (status === 'no_holidays_for_you') {
    return (
      <Warning
        title="No holidays are set for your team yet"
        body={`The ${year} calendar is published, but none of it has been given to ${department || 'your team'}${property ? ` at ${property}` : ''} yet. This is usually still being set up — ask your HR team if you think that's wrong.`}
      />
    );
  }

  if (status === 'ok' || status === 'no_holidays_published') {
    return (
      <div className="text-sm text-secondary space-y-0.5">
        <p className="inline-flex items-start gap-1.5">
          <MapPin size={14} className="text-primary mt-0.5 shrink-0" />
          <span>
            Showing the holidays for{' '}
            <span className="font-medium text-foreground">{department || 'your team'}</span>
            {property && <> at <span className="font-medium text-foreground">{property}</span></>}
            {state && <> ({state})</>}.
          </span>
        </p>
        <p className="pl-[22px] text-xs">
          Holidays can differ from team to team and from hotel to hotel, so your list may not
          match a colleague&apos;s.
        </p>
      </div>
    );
  }

  const copy: Record<string, { title: string; body: string }> = {
    no_branch_on_profile: {
      title: "We don't know which hotel you work at",
      body: "Your holiday list depends on your work location, and your profile doesn't have one recorded yet. You're seeing every national holiday below. Ask your HR team to add your hotel to your profile — your state's holidays will appear here once they do.",
    },
    branch_not_matched: {
      title: "Your work location doesn't match any of our hotels",
      body: `Your profile says you work at ${data?.branch_name ? `"${data.branch_name}"` : 'a location'}, but that doesn't match any hotel set up in the system, so we can't tell which state's holidays apply to you. You're seeing every national holiday below. Ask your HR team to correct the work location on your profile.`,
    },
    no_state_on_property: {
      title: "Your hotel's state isn't set up yet",
      body: `You're at ${property || 'your hotel'}, but we don't have its state recorded, so holidays that apply only in that state can't be shown. You're seeing every national holiday below. Ask your HR team to set the state for ${property || 'your hotel'}.`,
    },
  };
  const chosen = copy[status];
  if (!chosen) return null;
  return <Warning {...chosen} />;
}

function Warning({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
      <div className="text-sm min-w-0">
        <p className="font-medium text-amber-900">{title}</p>
        <p className="text-amber-800 mt-0.5">{body}</p>
      </div>
    </div>
  );
}

function EmptyYear({ year, currentYear, onBack }: { year: number; currentYear: number; onBack: () => void }) {
  return (
    <div className="mt-4 bg-card rounded-xl border border-border p-10 text-center">
      <CalendarDays size={32} className="mx-auto mb-3 text-secondary opacity-40" />
      <p className="text-base font-medium text-foreground">No holidays published for {year} yet</p>
      <p className="text-sm text-secondary mt-1 max-w-md mx-auto">
        Your HR team hasn&apos;t published the holiday calendar for this year. It usually goes up
        before the year starts — check back soon, or ask your HR team.
      </p>
      {year !== currentYear && (
        <button
          onClick={onBack}
          className="mt-4 px-4 py-2 border border-border rounded-lg text-sm font-medium text-foreground hover:bg-muted transition-colors"
        >
          Back to {currentYear}
        </button>
      )}
    </div>
  );
}

// PageSkeleton hardcodes `p-6 ml-64` for a whole page outside AppShell, so it would indent this
// by another 256px inside a tab panel. A local one it is.
function HolidaysSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-14 flex items-center justify-between">
        <div className="h-8 w-32 bg-muted rounded-lg" />
        <div className="h-8 w-28 bg-muted rounded-lg" />
      </div>
      <div className="h-4 w-72 bg-muted rounded mt-1" />
      <div className="mt-4 bg-card rounded-xl border border-border overflow-hidden">
        {[0, 1].map(s => (
          <div key={s}>
            <div className="h-10 bg-muted/70 border-b border-border" />
            {[0, 1, 2].map(i => (
              <div key={i} className="flex items-center gap-4 px-5 py-3 border-b border-border">
                <div className="w-12 h-11 bg-muted rounded-lg shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-40 bg-muted rounded" />
                  <div className="h-3 w-24 bg-muted rounded" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
