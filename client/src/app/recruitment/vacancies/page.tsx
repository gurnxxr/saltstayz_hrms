'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import Breadcrumb from '@/components/ui/Breadcrumb';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import LoadError from '@/components/ui/LoadError';
import { Plus, Trash2, Megaphone } from 'lucide-react';

// Steps 1-2 of the hiring process are states of a VACANCY. A new role is drafted
// (`new_role`), then listed/published (`listed`); both are "live". `closed` ends it.
// The server (recruitment.service.ts VACANCY_STATUSES) is authoritative.
const STATUS_LABELS: Record<string, string> = {
  new_role: 'New Role', listed: 'Listed', closed: 'Closed',
};
const STATUS_COLORS: Record<string, string> = {
  new_role: 'bg-blue-100 text-blue-700',
  listed: 'bg-green-100 text-green-700',
  closed: 'bg-gray-100 text-gray-700',
};
const STATUS_FILTERS = ['', 'new_role', 'listed', 'closed'];

export default function VacanciesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canDelete = can('recruitment', 'delete');
  const canEdit = can('recruitment', 'update');

  const [statusFilter, setStatusFilter] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<any>(null);

  const { data: vacancies = [], isError, refetch } = useQuery({
    queryKey: ['vacancies', statusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      return api.get(`/recruitment/vacancies?${params}`).then(r => r.data);
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['vacancies'] });
    queryClient.invalidateQueries({ queryKey: ['vacancy-stats'] });
  };

  const publishMutation = useMutation({
    mutationFn: (id: number) => api.put(`/recruitment/vacancies/${id}`, { status: 'listed' }),
    onSuccess: () => { invalidate(); toast.success('Vacancy listed — it is now published'); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to list vacancy'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/recruitment/vacancies/${id}`),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['pipeline-candidates'] });
      toast.success('Vacancy deleted');
      setDeleteTarget(null);
    },
    onError: (e: any) => { toast.error(e.response?.data?.error || 'Failed to delete vacancy'); setDeleteTarget(null); },
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <Breadcrumb items={[{ label: 'Recruitment', href: '/recruitment' }, { label: 'Vacancies' }]} />

        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Vacancies</h1>
            <p className="text-secondary mt-1">Draft a new role, then list it to start receiving applicants.</p>
          </div>
          <button
            onClick={() => router.push('/recruitment/vacancies/new')}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus size={16} />
            New Vacancy
          </button>
        </div>

        {/* Status filter */}
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s || 'all'}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                statusFilter === s ? 'border-primary text-primary bg-primary/5' : 'border-border text-secondary hover:bg-muted'
              }`}
            >
              {s ? STATUS_LABELS[s] : 'All'}
            </button>
          ))}
        </div>

        <div className="bg-card rounded-xl border border-border">
          {isError ? (
            <LoadError message="Couldn't load vacancies." onRetry={() => refetch()} />
          ) : vacancies.length === 0 ? (
            <div className="p-8 text-center text-secondary">
              No vacancies{statusFilter ? ` in "${STATUS_LABELS[statusFilter]}"` : ''} yet.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {vacancies.map((v: any) => (
                <div
                  key={v.id}
                  className="p-4 flex items-center justify-between gap-4 hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() => router.push(`/recruitment/vacancies/${v.id}`)}
                >
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">{v.job_title}</p>
                    <p className="text-sm text-secondary truncate">
                      {v.department_name} &middot; {v.property_name}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <span className="text-sm text-secondary whitespace-nowrap">
                      {v.filled}/{v.positions} filled
                    </span>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[v.status] || 'bg-gray-100 text-gray-700'}`}>
                      {STATUS_LABELS[v.status] || v.status}
                    </span>
                    {canEdit && v.status === 'new_role' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); publishMutation.mutate(v.id); }}
                        disabled={publishMutation.isPending}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-green-700 border border-green-200 rounded-lg hover:bg-green-50 disabled:opacity-50 transition-colors"
                        title="Publish this role — move it to Listed"
                      >
                        <Megaphone size={14} /> List it
                      </button>
                    )}
                    {canDelete && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(v); }}
                        className="p-1.5 rounded-lg text-secondary hover:text-red-600 hover:bg-red-50 transition-colors"
                        title="Delete vacancy"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete vacancy?"
        message={`Permanently delete the "${deleteTarget?.job_title}" vacancy${
          Number(deleteTarget?.candidate_count) > 0
            ? ` and its ${deleteTarget.candidate_count} applicant(s) and their history`
            : ''
        }? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </AppShell>
  );
}
