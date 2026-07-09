'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function AttendanceCalendar() {
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());
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
                  const dayOfWeek = new Date(calYear, calMonth, d).getDay();
                  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                  const isToday = dateStr === todayStr;
                  const isFuture = new Date(calYear, calMonth, d) > today;
                  const record = attendanceMap[dateStr];
                  const leave = leaveMap[dateStr];
                  const holiday = holidayMap[dateStr];

                  let badge = '';
                  let badgeBg = '';
                  let badgeText = '';
                  let tooltip = '';

                  if (holiday) {
                    badge = 'H'; badgeBg = 'bg-orange-100'; badgeText = 'text-orange-700'; tooltip = holiday;
                  } else if (leave) {
                    badge = 'L'; badgeBg = 'bg-blue-100'; badgeText = 'text-blue-700'; tooltip = leave;
                  } else if (record) {
                    if (record.status === 'present') {
                      badge = 'P'; badgeBg = 'bg-green-100'; badgeText = 'text-green-700';
                      tooltip = `Present${record.hours ? ` • ${record.hours}h` : ''}`;
                    } else if (record.status === 'absent') {
                      badge = 'A'; badgeBg = 'bg-red-100'; badgeText = 'text-red-700'; tooltip = 'Absent';
                    } else if (record.status === 'half_day') {
                      badge = 'HD'; badgeBg = 'bg-yellow-100'; badgeText = 'text-yellow-700';
                      tooltip = `Half Day${record.hours ? ` • ${record.hours}h` : ''}`;
                    } else if (record.status === 'short_punch') {
                      badge = 'SP'; badgeBg = 'bg-amber-100'; badgeText = 'text-amber-700';
                      tooltip = `Short Punch — left early${record.hours ? ` • ${record.hours}h` : ''}`;
                    } else if (record.status === 'miss_punch') {
                      badge = 'MP'; badgeBg = 'bg-orange-100'; badgeText = 'text-orange-700';
                      tooltip = 'Miss Punch — marked only once';
                    } else if (record.status === 'on_leave') {
                      badge = 'L'; badgeBg = 'bg-blue-100'; badgeText = 'text-blue-700'; tooltip = 'On Leave';
                    }
                    // A regularised day is shown as "R" (the underlying status stays in the tooltip).
                    if (record.isRegularised) {
                      tooltip = `Regularised — ${tooltip || record.status}`;
                      badge = 'R'; badgeBg = 'bg-indigo-100'; badgeText = 'text-indigo-700';
                    }
                  } else if (isWeekend && !isFuture) {
                    badge = 'WO'; badgeBg = 'bg-gray-100'; badgeText = 'text-gray-500'; tooltip = 'Weekly Off';
                  }

                  cells.push(
                    <div
                      key={d}
                      title={tooltip}
                      className={`h-14 sm:h-20 rounded-lg border p-1 sm:p-1.5 flex flex-col transition-colors ${
                        isToday ? 'border-primary bg-primary/5' :
                        isWeekend ? 'border-border/50 bg-muted/30' :
                        'border-border hover:bg-muted/30'
                      } ${isFuture ? 'opacity-40' : ''}`}
                    >
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
                    </div>
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
    </div>
  );
}
