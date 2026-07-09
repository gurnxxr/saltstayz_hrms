'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { allowedNextStages } from '@/lib/constants';
import Breadcrumb from '@/components/ui/Breadcrumb';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { Plus, User, Eye, Archive, Users, FileText, Download, Loader2, Pencil, ArrowRight } from 'lucide-react';

const EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship'];
const emptyJd = {
  summary: '', responsibilities: '', requirements: '',
  experience: '', employment_type: 'Full-time', reporting_to: '',
};

const ACTIVE_STAGES = ['screening', 'interview', 'shortlisted', 'offered'] as const;
const STAGE_LABELS: Record<string, string> = {
  screening: 'Screening', interview: 'Interview', shortlisted: 'Shortlisted',
  offered: 'Offered', rejected: 'Rejected',
};
const STAGE_COLORS: Record<string, string> = {
  screening: 'bg-gray-100 text-gray-700',
  interview: 'bg-blue-100 text-blue-700',
  shortlisted: 'bg-purple-100 text-purple-700',
  offered: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

export default function VacancyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canEdit = can('recruitment', 'update');

  const [showAddCandidate, setShowAddCandidate] = useState(false);
  const [candidateForm, setCandidateForm] = useState({ name: '', email: '', phone: '', notes: '' });
  const [statusEdit, setStatusEdit] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [stageConfirm, setStageConfirm] = useState<{ candidate: any; stage: string } | null>(null);
  const [showJd, setShowJd] = useState(false);
  const [jd, setJd] = useState(emptyJd);

  const { data: vacancy, isLoading } = useQuery({
    queryKey: ['vacancy', id],
    queryFn: () => api.get(`/recruitment/vacancies/${id}`).then(r => r.data),
  });

  const { data: candidates = [] } = useQuery({
    queryKey: ['vacancy-candidates', id],
    queryFn: () => api.get(`/recruitment/candidates?vacancy_id=${id}`).then(r => r.data),
  });

  const { data: archivedCandidates = [] } = useQuery({
    queryKey: ['vacancy-candidates-archived', id],
    queryFn: () => api.get(`/recruitment/candidates?vacancy_id=${id}&archived=true`).then(r => r.data),
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['vacancy-candidates', id] });
    queryClient.invalidateQueries({ queryKey: ['vacancy-candidates-archived', id] });
    queryClient.invalidateQueries({ queryKey: ['vacancy', id] });
    queryClient.invalidateQueries({ queryKey: ['vacancies'] });
    queryClient.invalidateQueries({ queryKey: ['vacancy-stats'] });
    queryClient.invalidateQueries({ queryKey: ['candidates-by-stage'] });
    queryClient.invalidateQueries({ queryKey: ['onboarding-stats'] });
    queryClient.invalidateQueries({ queryKey: ['onboarding-checklists'] });
    queryClient.invalidateQueries({ queryKey: ['offer-candidates'] });
  };

  const addCandidateMutation = useMutation({
    mutationFn: (data: typeof candidateForm) =>
      api.post('/recruitment/candidates', { ...data, vacancy_id: Number(id) }),
    onSuccess: () => {
      invalidateAll();
      toast.success('Candidate added');
      setCandidateForm({ name: '', email: '', phone: '', notes: '' });
      setShowAddCandidate(false);
    },
    onError: () => toast.error('Failed to add candidate'),
  });

  const updateStatusMutation = useMutation({
    mutationFn: (status: string) => api.put(`/recruitment/vacancies/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vacancy', id] });
      queryClient.invalidateQueries({ queryKey: ['vacancies'] });
      queryClient.invalidateQueries({ queryKey: ['vacancy-stats'] });
      toast.success('Vacancy status updated');
      setStatusEdit(false);
    },
  });

  const stageMoveMutation = useMutation({
    mutationFn: ({ candidateId, stage }: { candidateId: number; stage: string }) =>
      api.put(`/recruitment/candidates/${candidateId}/stage`, { stage }),
    onSuccess: (_d, { stage }) => {
      invalidateAll();
      setStageConfirm(null);
      if (stage === 'offered') {
        toast.success('Candidate offered — moved to Onboarding', {
          action: { label: 'Go to Onboarding', onClick: () => router.push('/onboarding') },
        });
      } else if (stage === 'rejected') toast.success('Candidate rejected and archived');
      else toast.success('Stage updated');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to update stage'),
  });

  // Load the saved JD into the form only when the editor is opened — never on
  // background refetches, so in-progress edits are never clobbered.
  function openJdEditor() {
    const d = vacancy?.jd_data;
    setJd(d && typeof d === 'object' ? {
      summary: d.summary || '',
      responsibilities: Array.isArray(d.responsibilities) ? d.responsibilities.join('\n') : (d.responsibilities || ''),
      requirements: Array.isArray(d.requirements) ? d.requirements.join('\n') : (d.requirements || ''),
      experience: d.experience || '',
      employment_type: d.employment_type || 'Full-time',
      reporting_to: d.reporting_to || '',
    } : emptyJd);
    setShowJd(true);
  }

  const saveJdMutation = useMutation({
    mutationFn: () => api.put(`/recruitment/vacancies/${id}/jd`, jd).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vacancy', id] });
      toast.success('Job description saved');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save JD'),
  });

  async function downloadJd() {
    try {
      const res = await api.get(`/recruitment/vacancies/${id}/jd/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `JD_${(vacancy?.job_title || 'Position').replace(/\s+/g, '_')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to download JD');
    }
  }

  function handleStageChange(c: any, stage: string) {
    if (stage === c.stage) return;
    // Offered / Rejected are consequential and terminal — confirm via dialog
    // (consistent with the delete flow). Intermediate moves apply immediately.
    if (stage === 'offered' || stage === 'rejected') { setStageConfirm({ candidate: c, stage }); return; }
    stageMoveMutation.mutate({ candidateId: c.id, stage });
  }

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      </AppShell>
    );
  }

  if (!vacancy) {
    return (
      <AppShell>
        <div className="text-center py-20 text-secondary">Vacancy not found.</div>
      </AppShell>
    );
  }

  const stageCount = (s: string) => candidates.filter((c: any) => c.stage === s).length;
  const rows = showArchived ? archivedCandidates : candidates;

  return (
    <AppShell>
      <div className="space-y-6">
        <Breadcrumb items={[{ label: 'Recruitment', href: '/recruitment' }, { label: vacancy.job_title }]} />

        {/* Vacancy Header */}
        <div className="bg-card rounded-xl border border-border p-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground">{vacancy.job_title}</h1>
              <p className="text-secondary mt-1">{vacancy.department_name} &middot; {vacancy.property_name}</p>
              {vacancy.reporting_manager_name && (
                <p className="text-sm text-secondary mt-1">Reporting Manager: <span className="text-foreground font-medium">{vacancy.reporting_manager_name}</span></p>
              )}
              <p className="text-sm text-secondary mt-2">{vacancy.description || 'No description'}</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-sm text-secondary">Positions</p>
                <p className="text-lg font-bold text-foreground">{vacancy.filled}/{vacancy.positions}</p>
              </div>
              {statusEdit ? (
                <div className="flex items-center gap-2">
                  <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)}
                    className="px-2 py-1 border border-border rounded-lg text-sm bg-background">
                    <option value="open">Open</option>
                    <option value="on_hold">On Hold</option>
                    <option value="closed">Closed</option>
                  </select>
                  <button onClick={() => updateStatusMutation.mutate(newStatus)} className="px-3 py-1 bg-primary text-white rounded-lg text-sm">Save</button>
                  <button onClick={() => setStatusEdit(false)} className="px-3 py-1 border border-border rounded-lg text-sm">Cancel</button>
                </div>
              ) : (
                <button
                  onClick={() => { if (canEdit) { setNewStatus(vacancy.status); setStatusEdit(true); } }}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium ${canEdit ? 'cursor-pointer' : ''} ${
                    vacancy.status === 'open' ? 'bg-green-100 text-green-700' :
                    vacancy.status === 'on_hold' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-gray-100 text-gray-700'
                  }`}
                >
                  {vacancy.status}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Job Description */}
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <FileText size={18} className="text-primary" />
              <div>
                <h2 className="text-sm font-semibold text-foreground">Job Description</h2>
                <p className="text-xs text-secondary">
                  {vacancy.jd_data ? 'JD configured — edit or download the PDF' : 'Configure the JD and download it as a PDF'}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              {vacancy.jd_data && (
                <button onClick={downloadJd} className="flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors">
                  <Download size={15} /> Download PDF
                </button>
              )}
              {canEdit && (
                <button onClick={() => (showJd ? setShowJd(false) : openJdEditor())} className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
                  {vacancy.jd_data ? <Pencil size={15} /> : <FileText size={15} />}
                  {showJd ? 'Close editor' : vacancy.jd_data ? 'Edit JD' : 'Generate JD'}
                </button>
              )}
            </div>
          </div>

          {showJd && canEdit && (
            <div className="mt-4 border-t border-border pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-foreground mb-1">About the Role</label>
                <textarea rows={3} value={jd.summary} onChange={(e) => setJd(p => ({ ...p, summary: e.target.value }))}
                  placeholder="Brief overview of the role and team..."
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-foreground mb-1">Key Responsibilities <span className="text-secondary font-normal">(one per line)</span></label>
                <textarea rows={4} value={jd.responsibilities} onChange={(e) => setJd(p => ({ ...p, responsibilities: e.target.value }))}
                  placeholder={'Manage daily front-desk operations\nHandle guest check-in / check-out\n...'}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-foreground mb-1">Requirements & Qualifications <span className="text-secondary font-normal">(one per line)</span></label>
                <textarea rows={4} value={jd.requirements} onChange={(e) => setJd(p => ({ ...p, requirements: e.target.value }))}
                  placeholder={'Graduate in Hotel Management\nExcellent communication skills\n...'}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Experience</label>
                <input value={jd.experience} onChange={(e) => setJd(p => ({ ...p, experience: e.target.value }))} placeholder="e.g. 2–4 years"
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Employment Type</label>
                <select value={jd.employment_type} onChange={(e) => setJd(p => ({ ...p, employment_type: e.target.value }))}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                  {EMPLOYMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Reporting To</label>
                <input value={jd.reporting_to} onChange={(e) => setJd(p => ({ ...p, reporting_to: e.target.value }))} placeholder="e.g. Front Office Manager"
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">CTC (from salary structure)</label>
                {vacancy.ctc?.configured ? (
                  <div className="w-full px-3 py-2 border border-border rounded-lg bg-muted/40 text-sm text-foreground">
                    <span className="font-semibold">{vacancy.ctc.label}</span>
                    <span className="text-secondary"> — auto-included on the JD</span>
                  </div>
                ) : (
                  <div className="w-full px-3 py-2 border border-amber-300 rounded-lg bg-amber-50 text-sm text-amber-800">
                    No salary structure for this designation. Set it in{' '}
                    <a href="/setup/salary-structure" className="underline">Payroll → Salary Structures</a>.
                  </div>
                )}
              </div>
              <div className="md:col-span-2 flex gap-2 pt-1">
                <button onClick={() => saveJdMutation.mutate()} disabled={saveJdMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted disabled:opacity-50 transition-colors">
                  {saveJdMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : null} Save
                </button>
                <button
                  onClick={async () => { await saveJdMutation.mutateAsync(); downloadJd(); }}
                  disabled={saveJdMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                  <Download size={15} /> Save & Download PDF
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Funnel summary */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {ACTIVE_STAGES.map(s => (
            <div key={s} className="bg-card rounded-xl border border-border p-4">
              <p className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${STAGE_COLORS[s]}`}>{STAGE_LABELS[s]}</p>
              <p className="text-2xl font-bold text-foreground mt-2">{stageCount(s)}</p>
            </div>
          ))}
          <div className="bg-card rounded-xl border border-border p-4">
            <p className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-100 text-red-700">Archived</p>
            <p className="text-2xl font-bold text-foreground mt-2">{archivedCandidates.length}</p>
          </div>
        </div>

        {/* Applicants toolbar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-secondary" />
            <h2 className="text-lg font-semibold text-foreground">
              {showArchived ? 'Archived Applicants' : 'Applicants'} ({rows.length})
            </h2>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowArchived(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 border rounded-lg text-sm font-medium transition-colors ${
                showArchived ? 'border-primary text-primary bg-primary/5' : 'border-border hover:bg-muted'
              }`}
            >
              <Archive size={15} /> {showArchived ? 'Show Active' : 'Show Archived'}
            </button>
            {canEdit && !showArchived && (
              <button
                onClick={() => setShowAddCandidate(!showAddCandidate)}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <Plus size={16} /> Add Applicant
              </button>
            )}
          </div>
        </div>

        {/* Add Candidate form */}
        {showAddCandidate && !showArchived && (
          <form
            onSubmit={(e) => { e.preventDefault(); addCandidateMutation.mutate(candidateForm); }}
            className="bg-card rounded-xl border border-border p-6 grid grid-cols-1 md:grid-cols-2 gap-4"
          >
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Name *</label>
              <input required value={candidateForm.name} onChange={(e) => setCandidateForm(p => ({ ...p, name: e.target.value }))}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Email</label>
              <input type="email" value={candidateForm.email} onChange={(e) => setCandidateForm(p => ({ ...p, email: e.target.value }))}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Phone</label>
              <input value={candidateForm.phone} onChange={(e) => setCandidateForm(p => ({ ...p, phone: e.target.value }))}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Notes</label>
              <input value={candidateForm.notes} onChange={(e) => setCandidateForm(p => ({ ...p, notes: e.target.value }))}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
            <div className="md:col-span-2 flex gap-3">
              <button type="submit" disabled={addCandidateMutation.isPending} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">
                {addCandidateMutation.isPending ? 'Adding...' : 'Add Applicant'}
              </button>
              <button type="button" onClick={() => setShowAddCandidate(false)} className="px-4 py-2 border border-border rounded-lg text-sm">Cancel</button>
            </div>
          </form>
        )}

        {/* Applicants table */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {rows.length === 0 ? (
            <div className="p-10 text-center text-secondary">
              {showArchived ? 'No archived applicants.' : 'No applicants yet. Add one to start the funnel.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Applicant</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Email</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Phone</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Stage</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Applied</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-secondary uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((c: any) => (
                    <tr key={c.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <User size={14} className="text-primary" />
                          </div>
                          <span className="text-sm font-medium text-foreground">{c.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-secondary">{c.email || '—'}</td>
                      <td className="px-4 py-3 text-sm text-secondary">{c.phone || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${STAGE_COLORS[c.stage] || 'bg-gray-100 text-gray-700'}`}>
                          {STAGE_LABELS[c.stage] || c.stage}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-secondary">{new Date(c.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {canEdit && !c.archived && c.stage !== 'offered' && (
                            <select
                              value={c.stage}
                              onChange={(e) => handleStageChange(c, e.target.value)}
                              disabled={stageMoveMutation.isPending}
                              className="px-2 py-1.5 border border-border rounded-lg bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/50"
                              title="Change stage"
                            >
                              {[c.stage, ...allowedNextStages(c.stage)].map(s => (
                                <option key={s} value={s}>{STAGE_LABELS[s] || s}</option>
                              ))}
                            </select>
                          )}
                          {c.stage === 'offered' && !c.archived && (
                            <button
                              onClick={() => router.push('/onboarding')}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-green-700 hover:bg-green-50 rounded-lg transition-colors"
                              title="Open Onboarding to generate the offer letter"
                            >
                              In onboarding <ArrowRight size={12} />
                            </button>
                          )}
                          <button
                            onClick={() => router.push(`/recruitment/candidates/${c.id}`)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/5 rounded-lg transition-colors"
                          >
                            <Eye size={13} /> View
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!stageConfirm}
        title={stageConfirm?.stage === 'offered' ? 'Mark as Offered?' : 'Reject applicant?'}
        message={stageConfirm ? (stageConfirm.stage === 'offered'
          ? <>Move <span className="font-medium text-foreground">{stageConfirm.candidate.name}</span> to Onboarding for offer-letter generation. The employee record is created only when the offer is accepted.</>
          : <>Reject and archive <span className="font-medium text-foreground">{stageConfirm.candidate.name}</span>? Their application moves to the archive.</>) : undefined}
        confirmLabel={stageConfirm?.stage === 'offered' ? 'Mark Offered' : 'Reject & Archive'}
        danger={stageConfirm?.stage === 'rejected'}
        loading={stageMoveMutation.isPending}
        onConfirm={() => stageConfirm && stageMoveMutation.mutate({ candidateId: stageConfirm.candidate.id, stage: stageConfirm.stage })}
        onCancel={() => setStageConfirm(null)}
      />
    </AppShell>
  );
}
