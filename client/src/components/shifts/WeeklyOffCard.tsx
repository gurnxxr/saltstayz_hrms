'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { currentMonth, formatDate, formatMonth } from '@/lib/utils';
import { istToday, relativeDay } from '@/lib/holidays';
import { NON_STATUS_BADGES } from '@/lib/attendanceCodes';
import {
  DAYS_LONG, DAYS_SHORT, deriveWeeklyOff, offDaysInWords, ordinal,
  type CalendarDay, type OffDay, type WeeklyOff,
} from '@/lib/weeklyOff';
import { ArrowRight, Coffee } from 'lucide-react';

/** '2026-12' → '2027-01'. Date.UTC takes a 1-based month as "next" and rolls the year for free. */
const nextMonthOf = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
};

/**
 * The employee's own weekly off, resolved.
 *
 * Exported because /shifts/my needs the same answer. That page used to read the SHIFT's own off
 * days, which is only the first of four rungs the engine walks and is empty on every shift this
 * system shipped — so it told most of the workforce they "follow the company work week", which was
 * not true for anyone whose rest days come from a leave template. One hook, one answer, so the two
 * screens cannot disagree again.
 *
 * `undefined` means still loading; `null` means there is nothing honest to show.
 */
export function useMyWeeklyOff(): {
  data: WeeklyOff | null | undefined;
  hasEmployee: boolean;
  lookingAhead: boolean;
} {
  const { user } = useAuth();
  // Not every login is linked to an employee record. No profile, no request, no card.
  const hasEmployee = user?.employeeId != null;

  const today = istToday();
  const thisMonth = currentMonth();

  // Its own key prefix, NOT ['attendance-calendar', month]. That key belongs to AttendanceCalendar
  // and its queryFn THROWS where this one swallows; React Query caches by key alone, so sharing it
  // would hand whichever queryFn registered first to both — either this card stops hiding itself on
  // a failure, or /attendance silently renders an empty month. That exact collision has already
  // been fixed here once (see 'my-shift' vs 'my-shift-overview' in app/shifts/my/page.tsx).
  const monthQuery = (m: string) => ({
    queryKey: ['my-weekly-off', m],
    // The raw days are cached; the derivation happens outside, because `next` depends on today's
    // date and a value that goes stale at midnight has no business memoised against a month key.
    queryFn: () => api.get(`/attendance/my-calendar?month=${m}`)
      .then((r) => (r.data?.days ?? []) as CalendarDay[])
      .catch(() => null),
    enabled: hasEmployee,
  });

  const { data: curDays } = useQuery<CalendarDay[] | null>(monthQuery(thisMonth));
  const cur = useMemo(
    () => (curDays ? deriveWeeklyOff(curDays, today) : (curDays as null | undefined)),
    [curDays, today],
  );

  // One extra request, and only in the last few days of a month: today is past this month's last
  // rest day, so "next day off" lives in the next one. Same bargain as UpcomingHolidaysCard's
  // next-year query — pay for it once the current window is genuinely used up.
  //
  // `days.length` first, and it is not redundant. Someone with no rest day at any rung has no next
  // one either, in this month or any other, so without this they would fetch a second month on
  // every single dashboard load to re-learn that. That is the population the empty state exists
  // for, and on this data it is most of it.
  const needNext = !!cur && cur.days.length > 0 && cur.next === null;
  const nextQ = useQuery<CalendarDay[] | null>({
    ...monthQuery(nextMonthOf(thisMonth)),
    enabled: hasEmployee && needNext,
  });
  const nextOff = useMemo(
    () => (nextQ.data ? deriveWeeklyOff(nextQ.data, today)?.next ?? null : null),
    [nextQ.data, today],
  );

  if (cur === undefined) return { data: undefined, hasEmployee, lookingAhead: false };
  if (!cur) return { data: null, hasEmployee, lookingAhead: false };
  return {
    data: { ...cur, next: cur.next ?? nextOff },
    hasEmployee,
    lookingAhead: needNext && nextQ.isPending,
  };
}

/**
 * Which days of the week this person doesn't work, and when the next one is.
 *
 * Failures are swallowed (`.catch(() => null)`), matching the dashboard's bargain that a broken
 * self-service endpoint hides its own card rather than taking the page down. /shifts/my carries
 * the honest "couldn't load" wording for the same fact.
 */
export default function WeeklyOffCard() {
  const { data, hasEmployee, lookingAhead } = useMyWeeklyOff();
  const today = istToday();

  if (!hasEmployee) return null;
  if (data === undefined) return <WeeklyOffSkeleton />;
  if (data === null) return null;

  return (
    <div className="bg-card rounded-xl border border-border p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-lg font-semibold text-foreground">Weekly Off</h2>
        <Link
          href="/attendance"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline shrink-0"
        >
          See my calendar <ArrowRight size={14} />
        </Link>
      </div>

      {data.days.length === 0 ? (
        <NoRestDay month={data.month} />
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <NextOff date={data.next} today={today} lookingAhead={lookingAhead} />
            <WeekStrip days={data.days} />
          </div>

          {/* The sentence, not the strip, is the accessible version of this card — which is why the
              strip is aria-hidden. `first-letter:uppercase`, not `capitalize`: capitalize uppercases
              EVERY word, so "every Sunday, plus the 2nd and 4th Saturday" comes out as a headline. */}
          <p className="text-sm text-secondary mt-4">
            <span className="text-foreground first-letter:uppercase">
              {offDaysInWords(data.days, { empty: '' })}
            </span>
            {data.decidedBy && <> · from <span className="text-foreground">{data.decidedBy}</span></>}
          </p>
        </>
      )}
    </div>
  );
}

function NextOff({ date, today, lookingAhead }: { date: string | null; today: string; lookingAhead: boolean }) {
  const rel = date ? relativeDay(date, today) : null;
  const soon = rel === 'Today' || rel === 'Tomorrow';
  return (
    <div className="flex items-start gap-4 rounded-lg border border-border/50 bg-muted/30 p-4">
      <div className="shrink-0 w-11 h-11 rounded-lg bg-card border border-border flex items-center justify-center text-secondary">
        <Coffee size={20} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-secondary">Next day off</p>
        {date ? (
          <>
            <p className="text-base font-semibold text-foreground truncate">
              {formatDate(date, { weekday: 'long', year: undefined })}
            </p>
            <p className={`text-sm mt-0.5 ${soon ? 'font-medium text-foreground' : 'text-secondary'}`}>
              {rel}
            </p>
          </>
        ) : lookingAhead ? (
          // Never print "no rest day left" while the next month is still in flight.
          <p className="text-sm text-secondary mt-1">Checking next month…</p>
        ) : (
          <p className="text-sm text-secondary mt-1">No rest day left in your working dates.</p>
        )}
      </div>
    </div>
  );
}

function WeekStrip({ days }: { days: OffDay[] }) {
  const WO = NON_STATUS_BADGES.weekly_off;
  const byDay = new Map(days.map((o) => [o.day, o]));
  return (
    // aria-hidden: the sentence below says the same thing in words. Seven boxes read out cell by
    // cell tells a screen-reader user nothing they can use.
    <div className="rounded-lg border border-border p-3" aria-hidden="true">
      <div className="grid grid-cols-7 gap-1">
        {DAYS_SHORT.map((d) => (
          <div key={d} className="text-center text-xs font-semibold text-secondary py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {DAYS_SHORT.map((_, dow) => {
          const off = byDay.get(dow);
          return (
            <div
              key={dow}
              title={off
                ? `${DAYS_LONG[dow]} — ${off.weeks
                  ? `only the ${off.weeks.map(ordinal).join(' and ')} of the month`
                  : 'every week'}`
                : `${DAYS_LONG[dow]} — a working day`}
              className={`h-[52px] rounded-lg border flex flex-col items-center justify-center gap-1 ${
                off ? 'border-border/50 bg-muted/30' : 'border-border'
              }`}
            >
              {off ? (
                <>
                  <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold ${WO.badgeBg} ${WO.badgeText}`}>
                    {WO.badge}
                  </span>
                  {/* Bare week numbers, not ordinals: a 1/7-width cell is about 44px on a phone and
                      "2nd·4th" does not fit. The strip's job is the shape at a glance; the sentence
                      below and the tooltip above both spell it out. */}
                  {off.weeks && (
                    <span className="text-[10px] font-medium text-secondary leading-none tabular-nums">
                      {off.weeks.join('·')}
                    </span>
                  )}
                </>
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-border" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The state that matters most.
 *
 * Somebody with no rest day at any of the four rungs is scheduled to work every day of the month,
 * which means a day the register never sees costs them a full day's pay. Amber is this app's
 * warning surface; the rest-day grey stays grey everywhere else on the card.
 */
function NoRestDay({ month }: { month: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <Coffee size={20} className="text-amber-700 shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-amber-900">No weekly off is set for you</p>
        <p className="text-sm text-amber-800 mt-0.5">
          Every day of {formatMonth(month)} counts as a day you were scheduled to work, so a day the
          register never sees can cost a full day&apos;s pay. Ask HR to set your rest days.
        </p>
      </div>
    </div>
  );
}

function WeeklyOffSkeleton() {
  return (
    <div className="bg-card rounded-xl border border-border p-6 animate-pulse">
      <div className="h-5 w-28 bg-muted rounded" />
      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="h-[86px] bg-muted rounded-lg" />
        <div className="h-[86px] bg-muted rounded-lg" />
      </div>
      <div className="h-4 w-72 bg-muted rounded mt-4" />
    </div>
  );
}
