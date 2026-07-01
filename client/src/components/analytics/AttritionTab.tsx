'use client';

import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { TrendingDown } from 'lucide-react';
import {
  ResponsiveContainer, Legend, Tooltip,
  PieChart, Pie, Cell,
  LineChart, Line, XAxis, YAxis, CartesianGrid,
} from 'recharts';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

export default function AttritionTab() {
  const { data: attrition } = useQuery({
    queryKey: ['analytics-attrition'],
    queryFn: () => api.get('/analytics/attrition').then(r => r.data),
  });

  if (!attrition) return null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="bg-card rounded-xl border border-border p-5 text-center">
          <p className="text-2xl font-bold text-foreground">{attrition.totalExits}</p>
          <p className="text-sm text-secondary">Total Exits (YTD)</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-5 text-center">
          <p className="text-2xl font-bold text-foreground">{attrition.attritionRate}%</p>
          <p className="text-sm text-secondary">Attrition Rate</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-5 text-center">
          <TrendingDown size={24} className={`mx-auto mb-1 ${Number(attrition.attritionRate) > 10 ? 'text-red-500' : 'text-green-500'}`} />
          <p className="text-sm text-secondary">{Number(attrition.attritionRate) > 10 ? 'High Attrition' : 'Healthy'}</p>
        </div>
      </div>

      {attrition.byReason?.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">Exits by Reason</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie data={attrition.byReason} dataKey="count" nameKey="reason" cx="50%" cy="50%" outerRadius={100} label>
                {attrition.byReason.map((_: any, i: number) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      {attrition.monthlyTrend?.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">Monthly Exit Trend</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={attrition.monthlyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Line type="monotone" dataKey="exits" stroke="#ef4444" strokeWidth={2} name="Exits" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {attrition.totalExits === 0 && (
        <div className="bg-card rounded-xl border border-border p-8 text-center text-secondary">
          No employee exits recorded this year.
        </div>
      )}
    </div>
  );
}
