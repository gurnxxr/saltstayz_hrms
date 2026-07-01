'use client';

import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  Cell,
} from 'recharts';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

export default function RecruitmentAnalyticsTab() {
  const { data: recruitment } = useQuery({
    queryKey: ['analytics-recruitment'],
    queryFn: () => api.get('/analytics/recruitment').then(r => r.data),
  });

  if (!recruitment) return null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Vacancies', value: recruitment.vacancyStats?.total_vacancies ?? 0 },
          { label: 'Open', value: recruitment.vacancyStats?.open_vacancies ?? 0 },
          { label: 'Total Positions', value: recruitment.vacancyStats?.total_positions ?? 0 },
          { label: 'Filled', value: recruitment.vacancyStats?.total_filled ?? 0 },
        ].map(s => (
          <div key={s.label} className="bg-card rounded-xl border border-border p-5 text-center">
            <p className="text-2xl font-bold text-foreground">{s.value}</p>
            <p className="text-sm text-secondary">{s.label}</p>
          </div>
        ))}
      </div>

      {recruitment.pipelineStages?.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">Candidate Pipeline</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={recruitment.pipelineStages}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="stage" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} name="Candidates">
                {recruitment.pipelineStages.map((_: any, i: number) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {recruitment.byProperty?.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">Vacancies by Property</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={recruitment.byProperty}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="property" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="positions" fill="#3b82f6" name="Positions" />
              <Bar dataKey="filled" fill="#10b981" name="Filled" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
