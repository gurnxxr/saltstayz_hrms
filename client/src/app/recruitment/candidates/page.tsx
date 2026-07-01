'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import { Search, ArrowLeft, User } from 'lucide-react';

const STAGES = ['screening', 'interview', 'shortlisted', 'offered', 'rejected'] as const;
const STAGE_COLORS: Record<string, string> = {
  screening: 'bg-gray-100 text-gray-700',
  interview: 'bg-blue-100 text-blue-700',
  shortlisted: 'bg-purple-100 text-purple-700',
  offered: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

export default function CandidatesPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [vacancyFilter, setVacancyFilter] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);

  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ['all-candidates', search, stageFilter, vacancyFilter, includeArchived],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (stageFilter) params.set('stage', stageFilter);
      if (vacancyFilter) params.set('vacancy_id', vacancyFilter);
      // Rejected candidates are archived; show them when explicitly requested
      if (includeArchived || stageFilter === 'rejected') params.set('archived', 'all');
      return api.get(`/recruitment/candidates?${params}`).then(r => r.data);
    },
  });

  const { data: vacancies = [] } = useQuery({
    queryKey: ['vacancies'],
    queryFn: () => api.get('/recruitment/vacancies').then(r => r.data),
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <button
          onClick={() => router.push('/recruitment')}
          className="flex items-center gap-2 text-secondary hover:text-foreground text-sm transition-colors"
        >
          <ArrowLeft size={16} />
          Back to Recruitment
        </button>

        <div>
          <h1 className="text-2xl font-bold text-foreground">All Candidates</h1>
          <p className="text-secondary mt-1">Search and filter across all vacancies</p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, phone..."
              className="w-full pl-9 pr-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="">All Stages</option>
            {STAGES.map(s => (
              <option key={s} value={s} className="capitalize">{s}</option>
            ))}
          </select>
          <select
            value={vacancyFilter}
            onChange={(e) => setVacancyFilter(e.target.value)}
            className="px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="">All Vacancies</option>
            {vacancies.map((v: any) => (
              <option key={v.id} value={v.id}>{v.job_title} - {v.property_name}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 px-3 py-2 text-sm text-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
              className="rounded border-border"
            />
            Include archived
          </label>
        </div>

        {/* Candidates Table */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : candidates.length === 0 ? (
            <div className="p-8 text-center text-secondary">
              No candidates found.
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Candidate</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Contact</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Position</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Stage</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Applied</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {candidates.map((c: any) => (
                  <tr
                    key={c.id}
                    className="hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => router.push(`/recruitment/candidates/${c.id}`)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                          <User size={14} className="text-primary" />
                        </div>
                        <span className="text-sm font-medium text-foreground">{c.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-foreground">{c.email || '-'}</p>
                      <p className="text-xs text-secondary">{c.phone || '-'}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground">{c.job_title}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize ${STAGE_COLORS[c.stage] || 'bg-gray-100 text-gray-700'}`}>
                        {c.stage}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-secondary">
                      {new Date(c.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </AppShell>
  );
}
