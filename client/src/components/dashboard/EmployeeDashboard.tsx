'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import DashboardGreeting from '@/components/dashboard/DashboardGreeting';
import UpcomingHolidaysCard from '@/components/leaves/UpcomingHolidaysCard';
import { ATTENDANCE_CODES } from '@/lib/attendanceCodes';
import { CalendarCheck, CalendarOff, Clock, Wallet, CalendarPlus, FileText, User, BarChart3 } from 'lucide-react';

const fmt = (t?: string) => (t ? t.slice(0, 5) : '');

export default function EmployeeDashboard() {
  const router = useRouter();

  const { data, isLoading } = useQuery({
    queryKey: ['my-overview'],
    queryFn: () => api.get('/analytics/me/overview').then(r => r.data).catch(() => null),
  });

  // No .catch here on purpose. Swallowing the error turned every failure into "no shift", which
  // is a different fact and the one thing an employee cannot act on — and because this answer is
  // cached under the same key the My Shift page reads, that swallowed null was handed to that
  // page too, where it printed "No shift assigned yet" for someone who had one.
  const { data: myShift, isError: myShiftError } = useQuery({
    queryKey: ['my-shift'],
    queryFn: () => api.get('/shifts/me').then(r => r.data),
  });
  const currentShift = myShift?.current ?? null;

  // Direct reports. Self-scoped on the server, so this is safe for every role — it simply
  // comes back empty for anyone who isn't a reporting manager, and the card stays hidden.
  const { data: reportees = [] } = useQuery({
    queryKey: ['my-reportees'],
    queryFn: () => api.get('/employees/me/reportees').then(r => r.data).catch(() => []),
  });

  const att = data?.attendance ?? {};

  // The eight codes the record actually stores, in one place — so the tiles below add up to the
  // month instead of showing a hand-picked four. `other` is the reconciliation check: it is
  // total minus the eight, and should always be zero. If it isn't, a status nothing in the code
  // writes has reached the table, and that deserves to be visible rather than swallowed.
  const counts = ATTENDANCE_CODES.map((c) => ({ ...c, value: Number(att[c.code] ?? 0) }));
  const total = Number(att.total ?? 0);
  const other = Math.max(0, total - counts.reduce((a, c) => a + c.value, 0));

  // Attendance is scored against days the person was expected to work. Approved leave isn't a
  // miss, so it leaves the denominator; a month entirely of leave has nothing to score and says so.
  const workingDays = Number(att.working_days ?? 0);
  const pct = att.present_pct;
  const leave = data?.leave ?? { balances: [], remaining: 0, used_days: 0, total_days: 0, pending_count: 0 };

  // Unpaid leave (Loss of Pay) is allocated 365 days to mean "no limit", not as an entitlement —
  // nobody can run out of the right to take a day without pay. Counting it made the headline read
  // 404 days a year. So the card and the headline both show paid leave only, and the headline is
  // re-summed here rather than taken from the response, which totals every type server-side.
  // The leave type itself is untouched: it is still applied for from /leaves/apply.
  const paidBalances = (leave.balances as any[]).filter((b) => b.is_paid);
  const leaveTotal = paidBalances.reduce((a, b) => a + Number(b.total_days || 0), 0);
  const leaveUsed = paidBalances.reduce((a, b) => a + Number(b.used_days || 0), 0);
  const leaveRemaining = Math.max(0, leaveTotal - leaveUsed);

  const monthLabel = data?.month
    ? new Date(`${data.month}-01`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    : 'This month';

  return (
    <div className="space-y-6">
      <DashboardGreeting subtitle={`Your attendance and leave at a glance — ${monthLabel}`} />

      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card icon={<CalendarCheck className="w-6 h-6" />} label="Attendance (this month)"
          value={isLoading ? '--' : pct == null ? '—' : `${pct}%`}
          sub={workingDays > 0
            ? `${Number(att.present ?? 0)}/${workingDays} working days present`
            : 'No working days this month yet'}
          color="bg-green-50 text-green-600" />
        <Card icon={<Clock className="w-6 h-6" />} label="Avg working hours"
          value={isLoading ? '--' : (att.avg_working_hours || 0)} sub="per marked day"
          color="bg-blue-50 text-blue-600" />
        <Card icon={<Wallet className="w-6 h-6" />} label="Leave remaining"
          value={isLoading ? '--' : leaveRemaining} sub={`${leaveUsed} used of ${leaveTotal}`}
          color="bg-amber-50 text-amber-600" />
        <Card icon={<CalendarOff className="w-6 h-6" />} label="Pending requests"
          value={isLoading ? '--' : leave.pending_count} sub="awaiting approval"
          color="bg-red-50 text-red-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Leave balances */}
        <div className="bg-card rounded-xl border border-border p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">My Leave Balance</h2>
          {paidBalances.length === 0 ? (
            <p className="text-sm text-secondary py-6 text-center">No leave balances configured.</p>
          ) : (
            <div className="space-y-4">
              {paidBalances.map((b: any) => {
                const pct = b.total_days > 0 ? Math.round((b.used_days / b.total_days) * 100) : 0;
                return (
                  <div key={b.leave_type}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-foreground font-medium">{b.leave_type}</span>
                      <span className="text-secondary">{b.remaining} left · {b.used_days}/{b.total_days} used</span>
                    </div>
                    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${pct >= 100 ? 'bg-red-500' : 'bg-primary'}`} style={{ width: `${Math.min(100, pct)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* This-month attendance breakdown — every code the record can hold, so the tiles
            reconcile with the month. Zeros stay visible for the same reason. */}
        <div className="bg-card rounded-xl border border-border p-6">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">This Month</h2>
            <span className="text-xs text-secondary">{total} day{total === 1 ? '' : 's'} marked</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {counts.map((c) => (
              <Mini key={c.code} label={c.label} badge={c.badge} value={c.value}
                color={c.value > 0 ? c.tone : 'text-secondary/40'} />
            ))}
            {/* Only ever appears if the table holds a status nothing in the code writes. */}
            {other > 0 && <Mini label="Other" badge="?" value={other} color="text-secondary" />}
          </div>
        </div>
      </div>

      {/* Holidays — sits beside My Shift because both answer "when am I not working". */}
      <UpcomingHolidaysCard />

      {/* My Shift */}
      <div className="bg-card rounded-xl border border-border p-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-secondary">My Shift</p>
            {myShiftError ? (
              // Not the same as having no shift, so it must not read like it.
              <p className="text-lg font-bold text-foreground">Couldn&apos;t load your shift</p>
            ) : currentShift ? (
              <p className="text-lg font-bold text-foreground">
                {currentShift.name} <span className="text-sm font-normal text-secondary">({fmt(currentShift.start_time)}–{fmt(currentShift.end_time)})</span>
              </p>
            ) : (
              <p className="text-lg font-bold text-foreground">No shift assigned</p>
            )}
          </div>
        </div>
      </div>

      {/* My Team — only for people who actually have direct reports. */}
      {reportees.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">My Team</h2>
            <span className="text-xs text-secondary">{reportees.length} direct {reportees.length === 1 ? 'report' : 'reports'}</span>
          </div>
          <div className="divide-y divide-border">
            {reportees.map((r: any) => (
              <div key={r.id} className="py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-bold shrink-0">
                    {(r.first_name || '?')[0]}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{r.first_name} {r.last_name}</p>
                    <p className="text-xs text-secondary truncate">
                      {r.employee_code}{r.designation_name ? ` · ${r.designation_name}` : ''}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-secondary text-right shrink-0">{r.dept_name || '—'}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="bg-card rounded-xl border border-border p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Quick Actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Apply for Leave', href: '/leaves/my', icon: CalendarPlus },
            { label: 'My Attendance', href: '/attendance', icon: CalendarCheck },
            { label: 'My Performance', href: '/analytics', icon: BarChart3 },
            { label: 'My Payslips', href: '/salary', icon: FileText },
            { label: 'My Profile', href: '/profile', icon: User },
          ].map(a => (
            <button key={a.label} onClick={() => router.push(a.href)}
              className="flex items-center gap-2 px-4 py-3 border border-border rounded-lg text-sm font-medium text-foreground hover:bg-muted transition-colors text-left">
              <a.icon size={16} className="text-secondary shrink-0" /> {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Card({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-sm text-secondary truncate">{label}</p>
          <p className="text-2xl font-bold text-foreground mt-1">{value}</p>
          {sub && <p className="text-xs text-secondary mt-0.5">{sub}</p>}
        </div>
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${color}`}>{icon}</div>
      </div>
    </div>
  );
}

function Mini({ label, badge, value, color }: { label: string; badge?: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-border p-3 text-center">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {/* The short code beside the name, because it is what HR writes on the upload sheet and
          what the calendar shows in each cell. */}
      <p className="text-xs text-secondary mt-0.5 leading-tight">
        {label}{badge ? <span className="text-secondary/60"> · {badge}</span> : null}
      </p>
    </div>
  );
}
