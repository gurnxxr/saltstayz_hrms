'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import AddApplicantDialog from '@/components/recruitment/AddApplicantDialog';
import { CANDIDATE_STAGES, OFF_RAMPS, STAGE_COLORS, STAGE_LABELS } from '@/lib/constants';
import { Search, ArrowLeft, User, Archive, UserPlus } from 'lucide-react';

// Every off-ramp (rejected / offer declined / no show) archives the candidate, so
// filtering to one of them has to include the archive or the table comes back empty.
const isOffRamp = (stage: string) => (OFF_RAMPS as readonly string[]).includes(stage);

export default function CandidatesPage() {
  const router = useRouter();
  const { can } = useAuth();
  const [showAddApplicant, setShowAddApplicant] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [stageFilter, setStageFilter] = useState('');
  const [vacancyFilter, setVacancyFilter] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);

  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ['all-candidates', debouncedSearch, stageFilter, vacancyFilter, includeArchived],
    queryFn: () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (stageFilter) params.set('stage', stageFilter);
      if (vacancyFilter) params.set('vacancy_id', vacancyFilter);
      // Off-ramped candidates are archived; show them when explicitly requested
      if (includeArchived || isOffRamp(stageFilter)) params.set('archived', 'all');
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

        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground">All Candidates</h1>
            <p className="text-secondary mt-1">Search and filter across all vacancies</p>
          </div>
          {can('recruitment', 'create') && (
            <button
              onClick={() => setShowAddApplicant(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <UserPlus size={16} /> Add Applicant
            </button>
          )}
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
            {CANDIDATE_STAGES.map(s => (
              <option key={s} value={s}>{STAGE_LABELS[s] || s}</option>
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
          <label className={`flex items-center gap-2 px-3 py-2 text-sm text-secondary select-none ${isOffRamp(stageFilter) ? 'cursor-default opacity-70' : 'cursor-pointer'}`}>
            <input
              type="checkbox"
              // Off-ramped candidates live in the archive, so archived are forced on there.
              checked={includeArchived || isOffRamp(stageFilter)}
              disabled={isOffRamp(stageFilter)}
              onChange={(e) => setIncludeArchived(e.target.checked)}
              className="rounded border-border"
            />
            Include archived
          </label>
        </div>

        {isOffRamp(stageFilter) && (
          <p className="flex items-center gap-1.5 text-xs text-secondary -mt-3">
            <Archive size={13} className="shrink-0" />
            {STAGE_LABELS[stageFilter]} applicants are archived — they&apos;re included here automatically.
          </p>
        )}

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
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STAGE_COLORS[c.stage] || 'bg-gray-100 text-gray-700'}`}>
                        {STAGE_LABELS[c.stage] || c.stage}
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

      {showAddApplicant && <AddApplicantDialog onClose={() => setShowAddApplicant(false)} />}
    </AppShell>
  );
}
