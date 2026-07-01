'use client';

import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Users, UserCheck, CalendarOff, Briefcase, Clock, UserPlus } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

export default function OverviewTab() {
  const { data: overview } = useQuery({
    queryKey: ['analytics-overview'],
    queryFn: () => api.get('/analytics/overview').then(r => r.data),
  });

  const { data: headcount } = useQuery({
    queryKey: ['analytics-headcount'],
    queryFn: () => api.get('/analytics/headcount').then(r => r.data),
  });

  if (!overview) return null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Employees', value: overview.totalEmployees, icon: Users, color: 'text-blue-600 bg-blue-50' },
          { label: 'Present Today', value: overview.presentToday, icon: UserCheck, color: 'text-green-600 bg-green-50' },
          { label: 'On Leave Today', value: overview.onLeaveToday, icon: CalendarOff, color: 'text-orange-600 bg-orange-50' },
          { label: 'Pending Leaves', value: overview.pendingLeaves, icon: Clock, color: 'text-yellow-600 bg-yellow-50' },
          { label: 'Open Vacancies', value: overview.openVacancies, icon: Briefcase, color: 'text-purple-600 bg-purple-50' },
          { label: 'Total Candidates', value: overview.totalCandidates, icon: UserPlus, color: 'text-cyan-600 bg-cyan-50' },
        ].map(card => (
          <div key={card.label} className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center gap-3">
              <div className={`p-2.5 rounded-lg ${card.color}`}>
                <card.icon size={20} />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{card.value}</p>
                <p className="text-sm text-secondary">{card.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {headcount && headcount.byProperty.length > 0 && (
          <div className="bg-card rounded-xl border border-border p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4">Headcount by Property</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={headcount.byProperty}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="property" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Employees" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {headcount && headcount.byDepartment.length > 0 && (
          <div className="bg-card rounded-xl border border-border p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4">Headcount by Department</h3>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={headcount.byDepartment}
                  dataKey="count"
                  nameKey="department"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  label={({ name, value }) => `${name} (${value})`}
                  labelLine={false}
                >
                  {headcount.byDepartment.map((_: any, i: number) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {overview.recentHires?.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">Recent Hires</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
            {overview.recentHires.map((emp: any) => (
              <div key={emp.id} className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-bold">
                  {emp.first_name[0]}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{emp.first_name} {emp.last_name}</p>
                  <p className="text-xs text-secondary">{new Date(emp.date_of_joining).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
