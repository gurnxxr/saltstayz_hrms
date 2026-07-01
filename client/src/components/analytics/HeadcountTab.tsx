'use client';

import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from 'recharts';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

export default function HeadcountTab() {
  const { data: headcount } = useQuery({
    queryKey: ['analytics-headcount'],
    queryFn: () => api.get('/analytics/headcount').then(r => r.data),
  });

  if (!headcount) return null;

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-xl border border-border p-6 text-center">
        <p className="text-4xl font-bold text-foreground">{headcount.total}</p>
        <p className="text-secondary mt-1">Total Active Employees</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card rounded-xl border border-border p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">By Property</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={headcount.byProperty} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis type="number" allowDecimals={false} />
              <YAxis type="category" dataKey="property" tick={{ fontSize: 11 }} width={150} />
              <Tooltip />
              <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} name="Employees" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card rounded-xl border border-border p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">By Department</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie data={headcount.byDepartment} dataKey="count" nameKey="department" cx="50%" cy="50%" outerRadius={100} label>
                {headcount.byDepartment.map((_: any, i: number) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card rounded-xl border border-border p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">By Job Title (Top 10)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={headcount.byJobTitle}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="job_title" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={70} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} name="Employees" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card rounded-xl border border-border p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">By Category</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie data={headcount.byCategory} dataKey="count" nameKey="category" cx="50%" cy="50%" innerRadius={50} outerRadius={100} label>
                {headcount.byCategory.map((_: any, i: number) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
