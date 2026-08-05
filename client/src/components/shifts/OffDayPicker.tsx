'use client';

/**
 * Picks which days of the week are NOT worked, optionally narrowed to particular occurrences —
 * "every Sunday, plus the 2nd and 4th Saturday" is the common Indian arrangement.
 *
 * Shared between the Shift Type screen and the Leave Template screen. It was written for shifts
 * first; the work week has since moved onto the leave template, and duplicating the control would
 * have meant two places where "2nd and 4th Saturday" could come to mean different things.
 */

// The type lives in lib/weeklyOff so plain modules can own it without importing from a
// 'use client' component. Re-exported here because half the app already imports it from this path.
import type { OffDay } from '@/lib/weeklyOff';
export type { OffDay };

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEK_ORDINALS = [1, 2, 3, 4, 5];
const SUFFIX = ['st', 'nd', 'rd', 'th', 'th'];

/**
 * The actual dates a pattern lands on in a given month.
 *
 * The occurrence is POSITIONAL — the 8th of any month is always the 2nd of its weekday, whatever
 * the calendar looks like. That is not obvious from a row of numbered pills, and being wrong about
 * it costs somebody a day's pay, so the control shows its work.
 */
export function datesInMonth(rules: OffDay[], year: number, month: number): number[] {
  const out: number[] = [];
  const last = new Date(year, month, 0).getDate();
  for (let d = 1; d <= last; d++) {
    const dow = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
    const occurrence = Math.floor((d - 1) / 7) + 1;
    if (rules.some((r) => r.day === dow && (r.weeks === null || r.weeks.includes(occurrence)))) out.push(d);
  }
  return out;
}

export default function OffDayPicker({
  value, onChange, emptyHint, preview,
}: {
  value: OffDay[];
  onChange: (v: OffDay[]) => void;
  /** What no off days means here — it differs between a shift and a leave template. */
  emptyHint?: string;
  /** Show which dates the pattern actually lands on over the next two months. */
  preview?: boolean;
}) {
  const byDay = new Map(value.map((o) => [o.day, o]));

  const toggleDay = (day: number) => {
    if (byDay.has(day)) onChange(value.filter((o) => o.day !== day));
    else onChange([...value, { day, weeks: null }].sort((a, b) => a.day - b.day));
  };

  const toggleWeek = (day: number, week: number) => {
    onChange(value.map((o) => {
      if (o.day !== day) return o;
      const cur = o.weeks ?? [];
      const next = cur.includes(week) ? cur.filter((w) => w !== week) : [...cur, week].sort();
      // Clearing every week means "every week" again, not "no weeks".
      return { ...o, weeks: next.length ? next : null };
    }));
  };

  const now = new Date();
  const months = preview && value.length
    ? [0, 1].map((offset) => {
      const dt = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const y = dt.getFullYear(); const m = dt.getMonth() + 1;
      return {
        label: dt.toLocaleString('en-IN', { month: 'long', year: 'numeric' }),
        dates: datesInMonth(value, y, m),
      };
    })
    : [];

  return (
    <div className="space-y-2">
      {DAYS.map((label, day) => {
        const off = byDay.get(day);
        const isOff = !!off;
        return (
          <div key={day} className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-2 cursor-pointer select-none w-32 shrink-0">
              <input
                type="checkbox"
                checked={isOff}
                onChange={() => toggleDay(day)}
                className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-primary/50"
              />
              <span className="text-sm text-foreground">{label}</span>
            </label>
            {isOff && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs text-secondary mr-1">
                  {off!.weeks === null ? 'Every week' : 'Only:'}
                </span>
                {WEEK_ORDINALS.map((w) => {
                  const on = off!.weeks?.includes(w) ?? false;
                  return (
                    <button
                      key={w}
                      type="button"
                      onClick={() => toggleWeek(day, w)}
                      className={`px-2 py-0.5 rounded-full text-xs font-medium border transition-colors ${
                        on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-secondary hover:bg-muted'
                      }`}
                      title={`${w}${SUFFIX[w - 1]} ${DAYS_SHORT[day]} of the month`}
                    >
                      {w}{SUFFIX[w - 1]}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {value.length === 0 && (
        <p className="text-xs text-secondary pt-1">
          {emptyHint ?? 'No off days set — employees on this shift follow the company work week.'}
        </p>
      )}

      {months.length > 0 && (
        <div className="mt-3 rounded-lg border border-border bg-muted/30 px-3 py-2 space-y-1">
          <p className="text-[11px] font-semibold text-secondary uppercase tracking-wide">Which dates this means</p>
          {months.map((m) => (
            <p key={m.label} className="text-xs text-foreground">
              <span className="text-secondary">{m.label}:</span>{' '}
              {m.dates.length ? m.dates.join(', ') : <span className="text-secondary">no days off</span>}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
