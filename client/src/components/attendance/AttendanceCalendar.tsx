'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { ChevronLeft, ChevronRight, X, ClipboardCheck } from 'lucide-react';
import RaiseRegularisationDialog from './RaiseRegularisationDialog';

// What a clicked day carries into the detail card — computed once when the cell renders so the
// card doesn't re-derive the badge/label.
interface SelectedDay {
  dateStr: string;
  label: string;            // "Wednesday, 1 July 2026"
  statusLabel: string;      // "Present", "Absent", "No attendance recorded", …
  badgeBg: string;
  badgeText: string;
  checkIn?: string;
  checkOut?: string;
  hours?: number;
  isRegularised?: boolean;
  isOnLeave: boolean;       // approved leave — the server won't override it, so no regularise
}

export default function AttendanceCalendar() {
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());
  // The day whose detail card is open, and whether the regularise form is showing for it.
  const [selectedDay, setSelectedDay] = useState<SelectedDay | null>(null);
  const [regularising, setRegularising] = useState(false);
  const monthStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}`;
  const { data: calendarData, isLoading: calLoading } = useQuery({
    queryKey: ['attendance-calendar', monthStr],
    queryFn: () => api.get(`/attendance/my-calendar?month=${monthStr}`).then(r => r.data),
  });

  const { data: summaryData } = useQuery({
    queryKey: ['attendance-summary', monthStr],
    queryFn: () => api.get(`/attendance/my-summary?month=${monthStr}`).then(r => r.data),
  });

  const attendanceMap = useMemo(() => {
    const map: Record<string, { status: string; checkIn?: string; checkOut?: string; hours?: number; isRegularised?: boolean }> = {};
    if (calendarData?.records) {
      for (const r of calendarData.records) {
        map[r.date] = { status: r.status, checkIn: r.check_in, checkOut: r.check_out, hours: r.working_hours, isRegularised: !!r.is_regularised };
      }
    }
    return map;
  }, [calendarData]);

  const leaveMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (calendarData?.leaves) {
      for (const l of calendarData.leaves) {
        const start = new Date(l.start_date);
        const end = new Date(l.end_date);
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const key = d.toISOString().slice(0, 10);
          map[key] = l.leave_type;
        }
      }
    }
    return map;
  }, [calendarData]);

  const holidayMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (calendarData?.holidays) {
      for (const h of calendarData.holidays) {
        map[h.date] = h.name;
      }
    }
    return map;
  }, [calendarData]);

  // The server's own work calendar: which days this person was scheduled to work, and what said
  // so. Without it the screen had to guess Sat/Sun for everybody, which is wrong for anyone on a
  // six-day week and gave no reason at all for a rest day.
  const dayMap = useMemo(() => {
    const map: Record<string, { kind: string; decided_by_name?: string }> = {};
    for (const d of calendarData?.days ?? []) map[d.date] = d;
    return map;
  }, [calendarData]);

  function prevMonth() {
    if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); }
    else setCalMonth(m => m - 1);
  }
  function nextMonth() {
    if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); }
    else setCalMonth(m => m + 1);
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      {summaryData && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <div className="bg-card rounded-xl border border-border p-4">
            <p className="text-xs font-medium text-secondary">Present</p>
            <p className="text-2xl font-bold text-green-600 mt-1">{summaryData.present || 0}</p>
          </div>
          <div className="bg-card rounded-xl border border-border p-4">
            <p className="text-xs font-medium text-secondary">Absent</p>
            <p className="text-2xl font-bold text-red-600 mt-1">{summaryData.absent || 0}</p>
          </div>
          <div className="bg-card rounded-xl border border-border p-4">
            <p className="text-xs font-medium text-secondary">Half Day</p>
            <p className="text-2xl font-bold text-yellow-600 mt-1">{summaryData.half_day || 0}</p>
          </div>
          <div className="bg-card rounded-xl border border-border p-4">
            <p className="text-xs font-medium text-secondary">Short Punch</p>
            <p className="text-2xl font-bold text-amber-600 mt-1">{summaryData.short_punch || 0}</p>
          </div>
          <div className="bg-card rounded-xl border border-border p-4">
            <p className="text-xs font-medium text-secondary">Miss Punch</p>
            <p className="text-2xl font-bold text-orange-600 mt-1">{summaryData.miss_punch || 0}</p>
          </div>
          <div className="bg-card rounded-xl border border-border p-4">
            <p className="text-xs font-medium text-secondary">On Leave</p>
            <p className="text-2xl font-bold text-blue-600 mt-1">{summaryData.on_leave || 0}</p>
          </div>
          <div className="bg-card rounded-xl border border-border p-4">
            <p className="text-xs font-medium text-secondary">Avg Hours</p>
            <p className="text-2xl font-bold text-foreground mt-1">{summaryData.avg_working_hours || '—'}</p>
          </div>
        </div>
      )}

      {/* Calendar */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <button onClick={prevMonth} className="p-2 hover:bg-muted rounded-lg transition-colors">
            <ChevronLeft size={18} />
          </button>
          <h3 className="text-lg font-semibold text-foreground">
            {new Date(calYear, calMonth).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
          </h3>
          <button onClick={nextMonth} className="p-2 hover:bg-muted rounded-lg transition-colors">
            <ChevronRight size={18} />
          </button>
        </div>

        {calLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : (
          <div className="p-4">
            {/* Day Headers */}
            <div className="grid grid-cols-7 gap-1 mb-1">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                <div key={d} className="text-center text-xs font-semibold text-secondary py-2">
                  {d}
                </div>
              ))}
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-1">
              {(() => {
                const firstDay = new Date(calYear, calMonth, 1).getDay();
                const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
                const today = new Date();
                const todayStr = today.toISOString().slice(0, 10);
                const cells: React.ReactNode[] = [];

                for (let i = 0; i < firstDay; i++) {
                  cells.push(<div key={`empty-${i}`} className="h-14 sm:h-20" />);
                }

                for (let d = 1; d <= daysInMonth; d++) {
                  const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                  // Whether this was a day THEY were scheduled to work, from the server's own work
                  // calendar — the same one payroll reads. This used to be `dayOfWeek === 0 || 6`,
                  // which told a six-day employee their Saturday was a day off when they had
                  // worked it, and gave no hint at all why a Sunday "no punch" cost them nothing.
                  const scheduled = dayMap[dateStr];
                  const isWeekend = scheduled ? scheduled.kind === 'weekly_off' : false;
                  const isToday = dateStr === todayStr;
                  const isFuture = new Date(calYear, calMonth, d) > today;
                  const record = attendanceMap[dateStr];
                  const leave = leaveMap[dateStr];
                  const holiday = holidayMap[dateStr];

                  let badge = '';
                  let badgeBg = '';
                  let badgeText = '';
                  let tooltip = '';
                  // A plain human label for the day-detail card (the badge is an abbreviation).
                  let statusLabel = 'No attendance recorded';

                  if (holiday) {
                    badge = 'H'; badgeBg = 'bg-orange-100'; badgeText = 'text-orange-700'; tooltip = holiday;
                    statusLabel = `Holiday — ${holiday}`;
                  } else if (leave) {
                    badge = 'L'; badgeBg = 'bg-blue-100'; badgeText = 'text-blue-700'; tooltip = leave;
                    statusLabel = `On leave — ${leave}`;
                  } else if (record) {
                    if (record.status === 'present') {
                      badge = 'P'; badgeBg = 'bg-green-100'; badgeText = 'text-green-700';
                      tooltip = `Present${record.hours ? ` • ${record.hours}h` : ''}`; statusLabel = 'Present';
                    } else if (record.status === 'absent') {
                      badge = 'A'; badgeBg = 'bg-red-100'; badgeText = 'text-red-700'; tooltip = 'Absent'; statusLabel = 'Absent';
                    } else if (record.status === 'half_day') {
                      badge = 'HD'; badgeBg = 'bg-yellow-100'; badgeText = 'text-yellow-700';
                      tooltip = `Half Day${record.hours ? ` • ${record.hours}h` : ''}`; statusLabel = 'Half Day';
                    } else if (record.status === 'hhd') {
                      badge = 'HHD'; badgeBg = 'bg-teal-100'; badgeText = 'text-teal-700';
                      tooltip = 'Half-day Holiday — paid ½'; statusLabel = 'Half-day Holiday';
                    } else if (record.status === 'short_punch') {
                      badge = 'SP'; badgeBg = 'bg-amber-100'; badgeText = 'text-amber-700';
                      tooltip = `Short Punch — left early${record.hours ? ` • ${record.hours}h` : ''}`; statusLabel = 'Short Punch — left early';
                    } else if (record.status === 'miss_punch') {
                      badge = 'MP'; badgeBg = 'bg-orange-100'; badgeText = 'text-orange-700';
                      tooltip = 'Miss Punch — marked only once'; statusLabel = 'Miss Punch — marked only once';
                    } else if (record.status === 'no_punch') {
                      badge = 'NP'; badgeBg = 'bg-purple-100'; badgeText = 'text-purple-700';
                      tooltip = 'No Punch — no biometric record'; statusLabel = 'No Punch — no biometric record';
                    } else if (record.status === 'on_leave') {
                      badge = 'L'; badgeBg = 'bg-blue-100'; badgeText = 'text-blue-700'; tooltip = 'On Leave'; statusLabel = 'On Leave';
                    }
                    // A regularised day is shown as "R" (the underlying status stays in the tooltip).
                    if (record.isRegularised) {
                      tooltip = `Regularised — ${tooltip || record.status}`;
                      badge = 'R'; badgeBg = 'bg-indigo-100'; badgeText = 'text-indigo-700';
                    }
                  } else if (isWeekend && !isFuture) {
                    badge = 'WO'; badgeBg = 'bg-gray-100'; badgeText = 'text-gray-500';
                    // Name the policy that made it a rest day, so "why wasn't I docked?" — and its
                    // mirror, "why WAS I?" — has an answer on the day itself.
                    const why = scheduled?.decided_by_name ? ` — ${scheduled.decided_by_name}` : '';
                    tooltip = `Weekly Off${why}`;
                    statusLabel = `Weekly Off${why}`;
                  }

                  const isOnLeave = record?.status === 'on_leave' || !!leave;
                  const cellClass = `h-14 sm:h-20 rounded-lg border p-1 sm:p-1.5 flex flex-col text-left w-full transition-colors ${
                    isToday ? 'border-primary bg-primary/5' :
                    isWeekend ? 'border-border/50 bg-muted/30' :
                    'border-border hover:bg-muted/30'
                  } ${isFuture ? 'opacity-40' : 'cursor-pointer hover:border-primary/40'}`;

                  // Only past/today cells act — you can't regularise a day that hasn't happened.
                  const openDay = () => setSelectedDay({
                    dateStr,
                    label: new Date(calYear, calMonth, d).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
                    statusLabel: record?.isRegularised ? `Regularised — ${statusLabel}` : statusLabel,
                    badgeBg: badgeBg || 'bg-muted', badgeText: badgeText || 'text-secondary',
                    checkIn: record?.checkIn, checkOut: record?.checkOut, hours: record?.hours,
                    isRegularised: record?.isRegularised, isOnLeave,
                  });

                  const inner = (
                    <>
                      <span className={`text-xs font-medium ${isToday ? 'text-primary' : 'text-foreground'}`}>
                        {d}
                      </span>
                      {badge && !isFuture && (
                        <div className="flex-1 flex items-center justify-center">
                          <span className={`inline-flex items-center justify-center w-6 h-6 sm:w-8 sm:h-8 rounded-full text-[10px] sm:text-xs font-bold ${badgeBg} ${badgeText}`}>
                            {badge}
                          </span>
                        </div>
                      )}
                      {record?.checkIn && !isFuture && (
                        <p className="text-[10px] text-secondary text-center truncate">
                          {record.checkIn.split(' ')[1]?.slice(0, 5)}
                        </p>
                      )}
                    </>
                  );

                  cells.push(
                    isFuture ? (
                      <div key={d} title={tooltip} className={cellClass}>{inner}</div>
                    ) : (
                      <button key={d} type="button" onClick={openDay} title={tooltip}
                        aria-label={`${d} — ${statusLabel}. Open day details`} className={cellClass}>
                        {inner}
                      </button>
                    )
                  );
                }

                return cells;
              })()}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-4 mt-4 pt-4 border-t border-border">
              {[
                { badge: 'P', bg: 'bg-green-100', text: 'text-green-700', label: 'Present' },
                { badge: 'A', bg: 'bg-red-100', text: 'text-red-700', label: 'Absent' },
                { badge: 'HD', bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Half Day' },
                { badge: 'HHD', bg: 'bg-teal-100', text: 'text-teal-700', label: 'Half-day Holiday' },
                { badge: 'SP', bg: 'bg-amber-100', text: 'text-amber-700', label: 'Short Punch' },
                { badge: 'MP', bg: 'bg-orange-100', text: 'text-orange-700', label: 'Miss Punch' },
                { badge: 'L', bg: 'bg-blue-100', text: 'text-blue-700', label: 'On Leave' },
                { badge: 'R', bg: 'bg-indigo-100', text: 'text-indigo-700', label: 'Regularised' },
                { badge: 'H', bg: 'bg-orange-100', text: 'text-orange-700', label: 'Holiday' },
                { badge: 'WO', bg: 'bg-gray-100', text: 'text-gray-500', label: 'Weekly Off' },
              ].map(item => (
                <div key={item.badge} className="flex items-center gap-1.5">
                  <span className={`w-6 h-6 rounded-full ${item.bg} ${item.text} text-[10px] font-bold flex items-center justify-center`}>{item.badge}</span>
                  <span className="text-xs text-secondary">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Day detail — opens on clicking any past/today cell, with a Regularise action. */}
      {selectedDay && !regularising && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSelectedDay(null)} />
          <div className="relative bg-card rounded-xl border border-border shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-base font-semibold text-foreground">{selectedDay.label}</h3>
              <button onClick={() => setSelectedDay(null)} className="p-1 rounded-lg text-secondary hover:text-foreground hover:bg-muted transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${selectedDay.badgeBg} ${selectedDay.badgeText}`}>
                  {selectedDay.statusLabel}
                </span>
              </div>
              {(selectedDay.checkIn || selectedDay.checkOut || selectedDay.hours != null) && (
                <dl className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-secondary">Punch in</dt>
                    <dd className="font-medium text-foreground">{selectedDay.checkIn?.split(' ')[1]?.slice(0, 5) || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-secondary">Punch out</dt>
                    <dd className="font-medium text-foreground">{selectedDay.checkOut?.split(' ')[1]?.slice(0, 5) || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-secondary">Hours</dt>
                    <dd className="font-medium text-foreground">{selectedDay.hours != null ? `${selectedDay.hours}h` : '—'}</dd>
                  </div>
                </dl>
              )}
              {selectedDay.isOnLeave && (
                <p className="text-xs text-secondary">This day is on approved leave — regularisation can&apos;t override it.</p>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
              <button onClick={() => setSelectedDay(null)} className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors">
                Close
              </button>
              <button
                onClick={() => setRegularising(true)}
                disabled={selectedDay.isOnLeave}
                title={selectedDay.isOnLeave ? 'Approved leave cannot be regularised' : undefined}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                <ClipboardCheck size={15} /> Regularise this day
              </button>
            </div>
          </div>
        </div>
      )}

      {/* The shared regularisation form, prefilled with the clicked date. */}
      {selectedDay && regularising && (
        <RaiseRegularisationDialog
          initialDate={selectedDay.dateStr}
          onClose={() => { setRegularising(false); setSelectedDay(null); }}
        />
      )}
    </div>
  );
}
