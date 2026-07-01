'use client';

import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  LineChart, Line,
} from 'recharts';

export default function AttendanceAnalyticsTab() {
  const { data: attendance } = useQuery({
    queryKey: ['analytics-attendance'],
    queryFn: () => api.get('/analytics/attendance').then(r => r.data),
  });

  return (
    <div className="space-y-6">
      {attendance?.summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Records', value: attendance.summary.total_records ?? 0 },
            { label: 'Present', value: attendance.summary.present ?? 0 },
            { label: 'Absent', value: attendance.summary.absent ?? 0 },
            { label: 'Avg Hours', value: attendance.summary.avg_working_hours ?? '-' },
          ].map(s => (
            <div key={s.label} className="bg-card rounded-xl border border-border p-5 text-center">
              <p className="text-2xl font-bold text-foreground">{s.value}</p>
              <p className="text-sm text-secondary">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {attendance?.byProperty?.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">Attendance % by Property</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={attendance.byProperty}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="property" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} unit="%" />
              <Tooltip formatter={(v) => `${v}%`} />
              <Bar dataKey="attendance_pct" fill="#10b981" radius={[4, 4, 0, 0]} name="Attendance %" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {attendance?.dailyTrend?.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">Daily Attendance Trend</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={attendance.dailyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="present" stroke="#10b981" strokeWidth={2} name="Present" />
              <Line type="monotone" dataKey="absent" stroke="#ef4444" strokeWidth={2} name="Absent" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {(!attendance?.summary?.total_records || attendance.summary.total_records === 0) && (
        <div className="bg-card rounded-xl border border-border p-8 text-center text-secondary">
          No attendance data recorded yet. Data will appear here once attendance tracking begins.
        </div>
      )}
    </div>
  );
}
