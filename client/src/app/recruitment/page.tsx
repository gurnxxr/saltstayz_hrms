'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import LoadError from '@/components/ui/LoadError';
import { Briefcase, Users, Plus, TrendingUp, Trash2 } from 'lucide-react';

export default function RecruitmentPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canDelete = can('recruitment', 'delete');
  const [deleteTarget, setDeleteTarget] = useState<any>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/recruitment/vacancies/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vacancies'] });
      queryClient.invalidateQueries({ queryKey: ['vacancy-stats'] });
      queryClient.invalidateQueries({ queryKey: ['candidates-by-stage'] });
      toast.success('Vacancy deleted');
      setDeleteTarget(null);
    },
    onError: (e: any) => { toast.error(e.response?.data?.error || 'Failed to delete vacancy'); setDeleteTarget(null); },
  });

  const { data: stats } = useQuery({
    queryKey: ['vacancy-stats'],
    queryFn: () => api.get('/recruitment/stats').then(r => r.data),
  });

  const { data: stageCounts = [] } = useQuery({
    queryKey: ['candidates-by-stage'],
    queryFn: () => api.get('/recruitment/candidates/by-stage').then(r => r.data),
  });

  const { data: vacancies = [], isError: vacError, refetch: refetchVac } = useQuery({
    queryKey: ['vacancies'],
    queryFn: () => api.get('/recruitment/vacancies').then(r => r.data),
  });

  const stageMap = Object.fromEntries(
    stageCounts.map((s: { stage: string; count: number }) => [s.stage, s.count])
  );

  const statCards = [
    { label: 'Open Vacancies', value: stats?.open_count ?? 0, icon: Briefcase, color: 'text-blue-600 bg-blue-50' },
    { label: 'Total Candidates', value: stageCounts.reduce((s: number, c: { count: number }) => s + Number(c.count), 0), icon: Users, color: 'text-green-600 bg-green-50' },
    { label: 'In Interview', value: stageMap.interview ?? 0, icon: TrendingUp, color: 'text-purple-600 bg-purple-50' },
    { label: 'Positions Filled', value: stats?.total_filled ?? 0, icon: Briefcase, color: 'text-orange-600 bg-orange-50' },
  ];

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Recruitment</h1>
            <p className="text-secondary mt-1">Manage vacancies and candidates</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => router.push('/recruitment/candidates')}
              className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
            >
              All Candidates
            </button>
            <button
              onClick={() => router.push('/recruitment/vacancies/new')}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus size={16} />
              New Vacancy
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((card) => (
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

        {/* Recent Vacancies */}
        <div className="bg-card rounded-xl border border-border">
          <div className="p-6 border-b border-border flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Vacancies</h2>
            <button
              onClick={() => router.push('/recruitment/vacancies/new')}
              className="text-sm text-primary hover:underline"
            >
              + Add New
            </button>
          </div>
          {vacError ? (
            <LoadError message="Couldn't load vacancies." onRetry={() => refetchVac()} />
          ) : vacancies.length === 0 ? (
            <div className="p-8 text-center text-secondary">
              No vacancies yet. Create one to start recruiting.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {vacancies.map((v: any) => (
                <div
                  key={v.id}
                  className="p-4 flex items-center justify-between hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() => router.push(`/recruitment/vacancies/${v.id}`)}
                >
                  <div>
                    <p className="font-medium text-foreground">{v.job_title}</p>
                    <p className="text-sm text-secondary">
                      {v.department_name} &middot; {v.property_name}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-secondary">
                      {v.filled}/{v.positions} filled
                    </span>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                      v.status === 'open' ? 'bg-green-100 text-green-700' :
                      v.status === 'on_hold' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {v.status}
                    </span>
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
