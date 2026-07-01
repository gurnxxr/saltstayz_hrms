'use client';

import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  LineChart, Line,
} from 'recharts';

export default function LeavesAnalyticsTab() {
  const { data: leaves } = useQuery({
    queryKey: ['analytics-leaves'],
    queryFn: () => api.get('/analytics/leaves').then(r => r.data),
  });

  return (
    <div className="space-y-6">
      {leaves?.byType?.length > 0 ? (
        <>
          <div className="bg-card rounded-xl border border-border p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4">Leave Requests by Type</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={leaves.byType}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="leave_type" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="approved" fill="#10b981" stackId="a" name="Approved" />
                <Bar dataKey="pending" fill="#f59e0b" stackId="a" name="Pending" />
                <Bar dataKey="rejected" fill="#ef4444" stackId="a" name="Rejected" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {leaves.monthlyTrend?.length > 0 && (
            <div className="bg-card rounded-xl border border-border p-6">
              <h3 className="text-lg font-semibold text-foreground mb-4">Monthly Leave Days (Approved)</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={leaves.monthlyTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="total_days" stroke="#8b5cf6" strokeWidth={2} name="Days" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      ) : (
        <div className="bg-card rounded-xl border border-border p-8 text-center text-secondary">
          No leave requests yet. Data will appear once employees start applying for leaves.
        </div>
      )}
    </div>
  );
}
