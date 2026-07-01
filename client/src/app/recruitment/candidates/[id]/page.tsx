'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import { allowedNextStages } from '@/lib/constants';
import { formatDateTime } from '@/lib/utils';
import { ArrowLeft, User, Clock, ChevronRight } from 'lucide-react';

const STAGES = ['screening', 'interview', 'shortlisted', 'offered', 'rejected'] as const;
const STAGE_COLORS: Record<string, string> = {
  screening: 'bg-gray-100 text-gray-700 border-gray-200',
  interview: 'bg-blue-100 text-blue-700 border-blue-200',
  shortlisted: 'bg-purple-100 text-purple-700 border-purple-200',
  offered: 'bg-green-100 text-green-700 border-green-200',
  rejected: 'bg-red-100 text-red-700 border-red-200',
};

export default function CandidateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [moveNotes, setMoveNotes] = useState('');
  const [selectedStage, setSelectedStage] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', email: '', phone: '', notes: '' });

  const { data: candidate, isLoading } = useQuery({
    queryKey: ['candidate', id],
    queryFn: () => api.get(`/recruitment/candidates/${id}`).then(r => r.data),
  });

  const { data: history = [] } = useQuery({
    queryKey: ['candidate-history', id],
    queryFn: () => api.get(`/recruitment/candidates/${id}/history`).then(r => r.data),
  });

  const stageMoveMutation = useMutation({
    mutationFn: ({ stage, notes }: { stage: string; notes: string }) =>
      api.put(`/recruitment/candidates/${id}/stage`, { stage, notes }),
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ['candidate', id] });
      queryClient.invalidateQueries({ queryKey: ['candidate-history', id] });
      queryClient.invalidateQueries({ queryKey: ['candidates-by-stage'] });
      queryClient.invalidateQueries({ queryKey: ['onboarding-stats'] });
      queryClient.invalidateQueries({ queryKey: ['onboarding-checklists'] });
      if (vars.stage === 'offered') toast.success('Candidate offered — moved to Onboarding');
      else if (vars.stage === 'rejected') toast.success('Candidate rejected and archived');
      else toast.success('Stage updated');
      setSelectedStage('');
      setMoveNotes('');
    },
    onError: () => toast.error('Failed to update stage'),
  });

  const updateMutation = useMutation({
    mutationFn: (data: typeof editForm) =>
      api.put(`/recruitment/candidates/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['candidate', id] });
      toast.success('Candidate updated');
      setIsEditing(false);
    },
    onError: () => toast.error('Failed to update'),
  });

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      </AppShell>
    );
  }

  if (!candidate) {
    return (
      <AppShell>
        <div className="text-center py-20 text-secondary">Candidate not found.</div>
      </AppShell>
    );
  }

  const currentStageIndex = STAGES.indexOf(candidate.stage);

  return (
    <AppShell>
      <div className="space-y-6 max-w-4xl">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-secondary hover:text-foreground text-sm transition-colors"
        >
          <ArrowLeft size={16} />
          Back
        </button>

        {/* Candidate Header */}
        <div className="bg-card rounded-xl border border-border p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                <User size={24} className="text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground">{candidate.name}</h1>
                <p className="text-secondary">{candidate.job_title}</p>
                <p className="text-sm text-secondary">
                  {candidate.department_name} &middot; {candidate.property_name}
                </p>
              </div>
            </div>
            <span className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize ${STAGE_COLORS[candidate.stage]}`}>
              {candidate.stage}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-4 mt-6 pt-4 border-t border-border">
            <div>
              <p className="text-xs text-secondary">Email</p>
              <p className="text-sm text-foreground">{candidate.email || '-'}</p>
            </div>
            <div>
              <p className="text-xs text-secondary">Phone</p>
              <p className="text-sm text-foreground">{candidate.phone || '-'}</p>
            </div>
            <div>
              <p className="text-xs text-secondary">Applied</p>
              <p className="text-sm text-foreground">{new Date(candidate.created_at).toLocaleDateString()}</p>
            </div>
          </div>

          {candidate.notes && (
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-xs text-secondary mb-1">Notes</p>
              <p className="text-sm text-foreground">{candidate.notes}</p>
            </div>
          )}

          <div className="mt-4 pt-4 border-t border-border flex gap-2">
            <button
              onClick={() => {
                setEditForm({
                  name: candidate.name,
                  email: candidate.email || '',
                  phone: candidate.phone || '',
                  notes: candidate.notes || '',
                });
                setIsEditing(true);
              }}
              className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted transition-colors"
            >
              Edit Details
            </button>
          </div>
        </div>

        {/* Edit Form */}
        {isEditing && (
          <form
            onSubmit={(e) => { e.preventDefault(); updateMutation.mutate(editForm); }}
            className="bg-card rounded-xl border border-border p-6 grid grid-cols-2 gap-4"
          >
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input
                value={editForm.name}
                onChange={(e) => setEditForm(p => ({ ...p, name: e.target.value }))}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Email</label>
              <input
                value={editForm.email}
                onChange={(e) => setEditForm(p => ({ ...p, email: e.target.value }))}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Phone</label>
              <input
                value={editForm.phone}
                onChange={(e) => setEditForm(p => ({ ...p, phone: e.target.value }))}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Notes</label>
              <input
                value={editForm.notes}
                onChange={(e) => setEditForm(p => ({ ...p, notes: e.target.value }))}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div className="col-span-2 flex gap-2">
              <button type="submit" disabled={updateMutation.isPending} className="px-4 py-2 bg-primary text-white rounded-lg text-sm disabled:opacity-50">
                Save
              </button>
              <button type="button" onClick={() => setIsEditing(false)} className="px-4 py-2 border border-border rounded-lg text-sm">
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Stage Pipeline Tracker */}
        <div className="bg-card rounded-xl border border-border p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">Pipeline Progress</h2>
          <div className="flex items-center gap-1">
            {STAGES.filter(s => s !== 'rejected').map((stage, i) => {
              const isCurrent = stage === candidate.stage;
              const isPast = i < currentStageIndex && candidate.stage !== 'rejected';
              return (
                <div key={stage} className="flex items-center flex-1">
                  <div className={`flex-1 py-2 px-3 text-center text-xs font-medium rounded-lg capitalize ${
                    isCurrent ? STAGE_COLORS[stage] :
                    isPast ? 'bg-green-50 text-green-600' :
                    'bg-muted text-secondary'
                  }`}>
                    {stage}
                  </div>
                  {i < 3 && <ChevronRight size={14} className="text-secondary mx-0.5 shrink-0" />}
                </div>
              );
            })}
          </div>
        </div>

        {/* Move Stage — offered & rejected are terminal */}
        {candidate.stage !== 'offered' && candidate.stage !== 'rejected' && (
          <div className="bg-card rounded-xl border border-border p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Move to Stage</h2>
            <div className="flex flex-wrap gap-2 mb-4">
              {allowedNextStages(candidate.stage).map(stage => (
                <button
                  key={stage}
                  onClick={() => setSelectedStage(stage)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium capitalize border transition-colors ${
                    selectedStage === stage
                      ? `${STAGE_COLORS[stage]} border-current`
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  {stage}
                </button>
              ))}
            </div>
            {selectedStage && (
              <div className="space-y-3">
                <textarea
                  value={moveNotes}
                  onChange={(e) => setMoveNotes(e.target.value)}
                  placeholder="Add notes for this transition (optional)"
                  rows={2}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                />
                {selectedStage === 'offered' && (
                  <p className="text-xs text-green-700">This will create an employee record and start onboarding.</p>
                )}
                {selectedStage === 'rejected' && (
                  <p className="text-xs text-red-700">This will reject and archive the application.</p>
                )}
                <button
                  onClick={() => {
                    if (selectedStage === 'offered' && !confirm(`Mark ${candidate.name} as Offered? This creates an employee and starts onboarding.`)) return;
                    if (selectedStage === 'rejected' && !confirm(`Reject and archive ${candidate.name}?`)) return;
                    stageMoveMutation.mutate({ stage: selectedStage, notes: moveNotes });
                  }}
                  disabled={stageMoveMutation.isPending}
                  className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {stageMoveMutation.isPending ? 'Moving...' : `Move to ${selectedStage}`}
                </button>
              </div>
            )}
          </div>
        )}

        {/* History */}
        <div className="bg-card rounded-xl border border-border p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">Stage History</h2>
          {history.length === 0 ? (
            <p className="text-sm text-secondary">No stage changes yet.</p>
          ) : (
            <div className="space-y-3">
              {history.map((h: any) => (
                <div key={h.id} className="flex items-start gap-3 pb-3 border-b border-border last:border-0">
                  <div className="mt-0.5">
                    <Clock size={14} className="text-secondary" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${STAGE_COLORS[h.from_stage]}`}>
                        {h.from_stage}
                      </span>
                      <ChevronRight size={12} className="text-secondary" />
                      <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${STAGE_COLORS[h.to_stage]}`}>
                        {h.to_stage}
                      </span>
                    </div>
                    {h.notes && <p className="text-sm text-foreground mt-1">{h.notes}</p>}
                    <p className="text-xs text-secondary mt-1">
                      by {h.changed_by_email} &middot; {formatDateTime(h.created_at)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
