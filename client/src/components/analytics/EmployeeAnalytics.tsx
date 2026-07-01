'use client';

import { useQuery } from '@tanstack/react-query';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import { CalendarCheck, Clock, Wallet, CalendarOff } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, BarChart, Bar, Legend,
} from 'recharts';

const STATUS_COLORS = ['#10b981', '#ef4444', '#f59e0b', '#3b82f6']; // present, absent, half-day, on-leave

export default function EmployeeAnalytics() {
  const { data: overview } = useQuery({
    queryKey: ['my-overview'],
    queryFn: () => api.get('/analytics/me/overview').then(r => r.data).catch(() => null),
  });
  const { data: trends } = useQuery({
    queryKey: ['my-trends'],
    queryFn: () => api.get('/analytics/me/trends?months=6').then(r => r.data).catch(() => null),
  });

  const att = overview?.attendance ?? { present: 0, absent: 0, half_day: 0, on_leave: 0, total: 0, present_pct: 0, avg_working_hours: 0 };
  const leave = overview?.leave ?? { remaining: 0, used_days: 0, total_days: 0, pending_count: 0 };

  const attendanceTrend = trends?.attendanceTrend ?? [];
  const leaveByType = trends?.leaveByType ?? [];

  const statusPie = [
    { name: 'Present', value: att.present },
    { name: 'Absent', value: att.absent },
    { name: 'Half day', value: att.half_day },
    { name: 'On leave', value: att.on_leave },
  ].filter(s => s.value > 0);

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">My Performance</h1>
          <p className="text-secondary mt-1">Your personal attendance and leave analytics</p>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Kpi icon={<CalendarCheck className="w-5 h-5" />} label="Attendance (month)" value={`${att.present_pct}%`} color="bg-green-50 text-green-600" />
          <Kpi icon={<Clock className="w-5 h-5" />} label="Avg working hrs" value={att.avg_working_hours || 0} color="bg-blue-50 text-blue-600" />
          <Kpi icon={<Wallet className="w-5 h-5" />} label="Leave remaining" value={leave.remaining} color="bg-amber-50 text-amber-600" />
          <Kpi icon={<CalendarOff className="w-5 h-5" />} label="Pending requests" value={leave.pending_count} color="bg-red-50 text-red-600" />
        </div>

        {/* Attendance trend */}
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-1">Attendance % — last 6 months</h3>
          <p className="text-xs text-secondary mb-3">Share of marked days you were present</p>
          {attendanceTrend.length === 0 ? (
            <Empty />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={attendanceTrend} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                <Tooltip formatter={(v: any) => `${v}%`} />
                <Line type="monotone" dataKey="present_pct" name="Present %" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* This-month status breakdown */}
          <div className="bg-card rounded-xl border border-border p-5">
            <h3 className="text-sm font-semibold text-foreground mb-3">This month — status breakdown</h3>
            {statusPie.length === 0 ? (
              <Empty />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={statusPie} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2}>
                    {statusPie.map((_, i) => <Cell key={i} fill={STATUS_COLORS[i % STATUS_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend verticalAlign="bottom" height={28} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Leave usage by type */}
          <div className="bg-card rounded-xl border border-border p-5">
            <h3 className="text-sm font-semibold text-foreground mb-3">Leave usage by type</h3>
            {leaveByType.length === 0 ? (
              <Empty />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={leaveByType} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="leave_type" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend verticalAlign="top" height={28} />
                  <Bar dataKey="used" name="Used" stackId="a" fill="#f59e0b" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="remaining" name="Remaining" stackId="a" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Kpi({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string | number; color: string }) {
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${color}`}>{icon}</div>
        <div className="min-w-0">
          <p className="text-xl font-bold text-foreground">{value}</p>
          <p className="text-xs text-secondary truncate">{label}</p>
        </div>
      </div>
    </div>
  );
}

function Empty() {
  return <p className="text-sm text-secondary p-8 bg-muted/40 rounded-lg text-center">No data yet.</p>;
}
