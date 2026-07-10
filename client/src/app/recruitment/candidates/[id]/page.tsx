'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import { allowedNextStages } from '@/lib/constants';
import { formatDateTime, formatINR } from '@/lib/utils';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import Breadcrumb from '@/components/ui/Breadcrumb';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import {
  User, Clock, ChevronRight, Check, Circle, Plus, Trash2, Upload, Paperclip, Download,
  Loader2, FileText, Percent, IndianRupee, AlertTriangle, Eye, ArrowRight, ArrowLeft,
} from 'lucide-react';

// ─── Stage vocabulary ───
//
// Steps 1-2 are VACANCY states (always complete for a candidate that exists); steps
// 3-11 come from the candidate's stage. The server is authoritative — the funnel
// order, labels and off-ramps come from GET /recruitment/stages; the stage-advance
// control mirrors allowedNextStages() from constants.
const VACANCY_STEPS = [
  { key: 'new_role', label: 'New Role' },
  { key: 'listed', label: 'Job Listing' },
];
const FALLBACK_FUNNEL = [
  'applied', 'interview', 'selected', 'document_collection', 'offer_released',
  'offer_accepted', 'pre_joining', 'joining', 'transferred',
];
const FALLBACK_OFFRAMPS = ['rejected', 'offer_declined', 'no_show'];
// Stages that carry side effects and have their own controls, so they never appear as
// a plain "Move to Stage" button.
const SPECIAL_STAGES = ['offer_released', 'offer_accepted', 'offer_declined', 'transferred'];
const CHECKLIST_STAGES = ['document_collection', 'pre_joining', 'joining'];
const OFFER_STAGES = ['offer_released', 'offer_accepted', 'pre_joining', 'joining', 'transferred'];

function labelFor(stage: string, labels?: Record<string, string>) {
  return labels?.[stage] ?? stage.replace(/_/g, ' ');
}
function stageClasses(stage: string, offRamps: string[]) {
  if (offRamps.includes(stage)) return 'bg-red-100 text-red-700 border-red-200';
  if (stage === 'transferred') return 'bg-green-100 text-green-700 border-green-200';
  if (stage === 'offer_released' || stage === 'offer_accepted') return 'bg-purple-100 text-purple-700 border-purple-200';
  return 'bg-blue-100 text-blue-700 border-blue-200';
}

export default function CandidateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();

  const [moveNotes, setMoveNotes] = useState('');
  const [selectedStage, setSelectedStage] = useState('');
  const [stageConfirm, setStageConfirm] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', email: '', phone: '', notes: '' });
  const [showOfferEditor, setShowOfferEditor] = useState(false);
  const [newItem, setNewItem] = useState('');
  const [uploadingId, setUploadingId] = useState<number | null>(null);
  const [removeDoc, setRemoveDoc] = useState<{ id: number; name: string } | null>(null);
  const [acceptDate, setAcceptDate] = useState('');
  const [declineReason, setDeclineReason] = useState('');

  const invalidateCandidate = () => {
    queryClient.invalidateQueries({ queryKey: ['candidate', id] });
    queryClient.invalidateQueries({ queryKey: ['candidate-history', id] });
    queryClient.invalidateQueries({ queryKey: ['candidate-checklists', id] });
    queryClient.invalidateQueries({ queryKey: ['candidate-offer', id] });
    queryClient.invalidateQueries({ queryKey: ['candidates-by-stage'] });
    queryClient.invalidateQueries({ queryKey: ['recruitment-candidates'] });
    queryClient.invalidateQueries({ queryKey: ['joining-queue'] });
  };

  const { data: candidate, isLoading } = useQuery({
    queryKey: ['candidate', id],
    queryFn: () => api.get(`/recruitment/candidates/${id}`).then(r => r.data),
  });

  const { data: stages } = useQuery({
    queryKey: ['recruitment-stages'],
    queryFn: () => api.get('/recruitment/stages').then(r => r.data),
    staleTime: Infinity,
  });

  const { data: history = [] } = useQuery({
    queryKey: ['candidate-history', id],
    queryFn: () => api.get(`/recruitment/candidates/${id}/history`).then(r => r.data),
  });

  const stageIsChecklist = !!candidate && CHECKLIST_STAGES.includes(candidate.stage);
  const { data: checklists = [] } = useQuery({
    queryKey: ['candidate-checklists', id],
    queryFn: () => api.get(`/recruitment/candidates/${id}/checklists`).then(r => r.data),
    enabled: stageIsChecklist,
  });

  const stageHasOffer = !!candidate && OFFER_STAGES.includes(candidate.stage);
  const { data: offer } = useQuery({
    queryKey: ['candidate-offer', id],
    queryFn: () => api.get(`/recruitment/candidates/${id}/offer`).then(r => r.data),
    enabled: stageHasOffer,
    retry: false,
  });

  // ─── Mutations ───
  const stageMoveMutation = useMutation({
    mutationFn: ({ stage, notes }: { stage: string; notes: string }) =>
      api.put(`/recruitment/candidates/${id}/stage`, { stage, notes }),
    onSuccess: (_d, vars) => {
      invalidateCandidate();
      if (FALLBACK_OFFRAMPS.includes(vars.stage)) toast.success('Candidate archived');
      else toast.success('Stage updated');
      setSelectedStage('');
      setMoveNotes('');
      setStageConfirm(null);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to update stage'),
  });

  const updateMutation = useMutation({
    mutationFn: (data: typeof editForm) => api.put(`/recruitment/candidates/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['candidate', id] });
      toast.success('Candidate updated');
      setIsEditing(false);
    },
    onError: () => toast.error('Failed to update'),
  });

  const acceptMutation = useMutation({
    mutationFn: () => api.post(`/recruitment/candidates/${id}/offer/accept`, { joining_date: acceptDate || undefined }),
    onSuccess: () => { invalidateCandidate(); toast.success('Offer acceptance recorded'); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to record acceptance'),
  });

  const declineMutation = useMutation({
    mutationFn: () => api.post(`/recruitment/candidates/${id}/offer/decline`, { reason: declineReason || undefined }),
    onSuccess: () => { invalidateCandidate(); toast.success('Offer decline recorded'); setDeclineReason(''); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to record decline'),
  });

  const transferMutation = useMutation({
    mutationFn: () => api.post(`/recruitment/candidates/${id}/transfer`, { notes: moveNotes || undefined }),
    onSuccess: () => { invalidateCandidate(); toast.success('Employee transferred to reporting manager'); setMoveNotes(''); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to transfer'),
  });

  // ─── Checklist item mutations ───
  const toggleItemMutation = useMutation({
    mutationFn: (itemId: number) => api.put(`/checklists/items/${itemId}/toggle`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['candidate-checklists', id] }),
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to update item'),
  });
  const addItemMutation = useMutation({
    mutationFn: ({ instanceId, label }: { instanceId: number; label: string }) =>
      api.post(`/checklists/instances/${instanceId}/items`, { label }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['candidate-checklists', id] }); toast.success('Item added'); setNewItem(''); },
    onError: () => toast.error('Failed to add item'),
  });
  const deleteItemMutation = useMutation({
    mutationFn: (itemId: number) => api.delete(`/checklists/items/${itemId}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['candidate-checklists', id] }); toast.success('Item removed'); },
    onError: () => toast.error('Failed to remove item'),
  });
  const uploadDocMutation = useMutation({
    mutationFn: ({ itemId, file }: { itemId: number; file: File }) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.post(`/checklists/items/${itemId}/document`, fd);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['candidate-checklists', id] }); toast.success('Document uploaded'); setUploadingId(null); },
    onError: (e: any) => { toast.error(e.response?.data?.error || 'Upload failed'); setUploadingId(null); },
  });
  const removeDocMutation = useMutation({
    mutationFn: (itemId: number) => api.delete(`/checklists/items/${itemId}/document`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['candidate-checklists', id] }); toast.success('Document removed'); setRemoveDoc(null); },
    onError: () => { toast.error('Failed to remove document'); setRemoveDoc(null); },
  });

  async function downloadDoc(itemId: number, name: string) {
    try {
      const res = await api.get(`/checklists/items/${itemId}/document`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to download document');
    }
  }

  async function downloadOfferPdf() {
    try {
      const res = await api.get(`/recruitment/candidates/${id}/offer/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `Offer_Letter_${String(candidate?.name || 'Candidate').replace(/\s+/g, '_')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to download PDF');
    }
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

  if (!candidate) {
    return (
      <AppShell>
        <div className="text-center py-20 text-secondary">Candidate not found.</div>
      </AppShell>
    );
  }

  const labels: Record<string, string> = stages?.labels ?? {};
  const funnel: string[] = stages?.funnel_order ?? FALLBACK_FUNNEL;
  const offRamps: string[] = stages?.off_ramps ?? FALLBACK_OFFRAMPS;
  const stageChecklistMap: Record<string, string> = stages?.stage_checklist ?? {};

  const isOffRamped = offRamps.includes(candidate.stage);
  // Where an off-ramped candidate left the funnel: the from_stage of the transition
  // that took them off-ramp (history is newest-first).
  const leftFromStage: string | null = isOffRamped
    ? (history.find((h: any) => offRamps.includes(h.to_stage))?.from_stage ?? funnel[0])
    : null;
  const currentFunnelKey = isOffRamped ? leftFromStage : candidate.stage;
  let currentFunnelIdx = currentFunnelKey ? funnel.indexOf(currentFunnelKey) : -1;
  if (isOffRamped && currentFunnelIdx === -1) currentFunnelIdx = 0;

  // 11-step stepper: two vacancy steps + the nine funnel steps.
  const steps = [
    ...VACANCY_STEPS.map((s) => ({ key: s.key, label: s.label, status: 'complete' as string, note: '' })),
    ...funnel.map((key, fi) => {
      let status: string;
      let note = '';
      if (isOffRamped) {
        if (fi < currentFunnelIdx) status = 'complete';
        else if (fi === currentFunnelIdx) { status = 'offramped'; note = labelFor(candidate.stage, labels); }
        else status = 'upcoming';
      } else {
        if (fi < currentFunnelIdx) status = 'complete';
        else if (fi === currentFunnelIdx) status = 'current';
        else status = 'upcoming';
      }
      return { key, label: labelFor(key, labels), status, note };
    }),
  ];

  // Checklist for the current stage (steps 6 / 9 / 10).
  const checklistKey = stageChecklistMap[candidate.stage];
  const currentChecklist = checklists.find((c: any) => c.template_key === checklistKey);
  const checklistComplete = !!currentChecklist
    && currentChecklist.total_items > 0
    && currentChecklist.completed_items === currentChecklist.total_items;

  // Generic "Move to Stage" options: the allowed next stages, minus the ones with
  // dedicated controls (offer release / accept / decline / transfer).
  const moveOptions = allowedNextStages(candidate.stage).filter((s) => !SPECIAL_STAGES.includes(s));
  const selectedIsForward = !!selectedStage && !offRamps.includes(selectedStage);
  const forwardBlockedByChecklist = selectedIsForward && stageIsChecklist && !checklistComplete;

  const employeeLinked = candidate.employee_id
    && ['offer_accepted', 'pre_joining', 'joining', 'transferred'].includes(candidate.stage);

  return (
    <AppShell>
      <div className="space-y-6 max-w-4xl">
        <Breadcrumb items={[{ label: 'Recruitment', href: '/recruitment' }, { label: 'Candidates', href: '/recruitment/candidates' }, { label: candidate.name }]} />

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
            <span className={`px-3 py-1.5 rounded-full text-xs font-medium border ${stageClasses(candidate.stage, offRamps)}`}>
              {labelFor(candidate.stage, labels)}
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

        {/* Pipeline Progress — the eleven steps */}
        <div className="bg-card rounded-xl border border-border p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">Pipeline Progress</h2>
          <div className="flex flex-wrap gap-2">
            {steps.map((step, i) => (
              <div key={step.key} className="flex items-center gap-2">
                <div className={`flex items-center gap-2 py-1.5 pl-1.5 pr-3 rounded-lg border text-xs font-medium ${
                  step.status === 'complete' ? 'bg-green-50 text-green-600 border-green-200' :
                  step.status === 'current' ? 'bg-blue-100 text-blue-700 border-blue-300' :
                  step.status === 'offramped' ? 'bg-red-100 text-red-700 border-red-200' :
                  'bg-muted text-secondary border-border'
                }`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 ${
                    step.status === 'complete' ? 'bg-green-100 text-green-700' :
                    step.status === 'current' ? 'bg-blue-200 text-blue-800' :
                    step.status === 'offramped' ? 'bg-red-200 text-red-800' :
                    'bg-background text-secondary'
                  }`}>
                    {step.status === 'complete' ? <Check size={12} /> : i + 1}
                  </span>
                  <span className="capitalize">{step.label}</span>
                  {step.note && <span className="text-[10px] font-semibold uppercase tracking-wide">· {step.note}</span>}
                </div>
                {i < steps.length - 1 && <ChevronRight size={13} className="text-secondary/60 shrink-0" />}
              </div>
            ))}
          </div>
        </div>

        {/* Linked employee record (offer accepted and beyond) */}
        {employeeLinked && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-green-800">
              An employee record has been created for this hire{candidate.stage === 'transferred' ? ' and activated' : ''}.
            </p>
            <button
              onClick={() => router.push(`/employees/${candidate.employee_id}`)}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
            >
              View Employee Record <ArrowRight size={15} />
            </button>
          </div>
        )}

        {/* Offer letter (step 7 onward) */}
        {stageHasOffer && offer && (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <FileText size={18} className="text-primary" /> Offer Letter
              </h2>
              <button
                onClick={downloadOfferPdf}
                className="flex items-center gap-2 px-3 py-1.5 border border-border rounded-lg text-sm hover:bg-muted transition-colors"
              >
                <Download size={14} /> Download PDF
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-muted/40 rounded-lg p-5 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-secondary">Position</p>
                  <p className="text-sm font-semibold text-foreground">{offer.template_data?.designation || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-secondary">Annual CTC</p>
                  <p className="text-sm font-semibold text-foreground">&#8377; {offer.template_data?.salary || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-secondary">Date of Joining</p>
                  <p className="text-sm font-semibold text-foreground">
                    {offer.template_data?.joining_date
                      ? new Date(offer.template_data.joining_date).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-secondary">Status</p>
                  <p className="text-sm font-semibold text-foreground capitalize">{offer.status || '—'}</p>
                </div>
              </div>

              {/* HR actions — no candidate portal; acceptance/decline is recorded here. */}
              {candidate.stage === 'offer_released' && offer.status === 'issued' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <div className="border border-border rounded-lg p-4 space-y-3">
                    <p className="text-sm font-medium text-foreground">Record Acceptance</p>
                    <div>
                      <label className="block text-xs text-secondary mb-1">Joining date (optional — defaults to the offer)</label>
                      <input
                        type="date"
                        value={acceptDate}
                        onChange={(e) => setAcceptDate(e.target.value)}
                        className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                    </div>
                    <button
                      onClick={() => acceptMutation.mutate()}
                      disabled={acceptMutation.isPending}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                    >
                      {acceptMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                      Record Acceptance
                    </button>
                  </div>
                  <div className="border border-border rounded-lg p-4 space-y-3">
                    <p className="text-sm font-medium text-foreground">Record Decline</p>
                    <div>
                      <label className="block text-xs text-secondary mb-1">Reason (optional)</label>
                      <input
                        value={declineReason}
                        onChange={(e) => setDeclineReason(e.target.value)}
                        placeholder="e.g. Accepted another offer"
                        className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                    </div>
                    <button
                      onClick={() => declineMutation.mutate()}
                      disabled={declineMutation.isPending}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-red-300 text-red-700 rounded-lg text-sm font-medium hover:bg-red-50 disabled:opacity-50 transition-colors"
                    >
                      {declineMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
                      Record Decline
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Phase checklist (steps 6 / 9 / 10) */}
        {stageIsChecklist && (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            {!currentChecklist ? (
              <div className="p-6 text-sm text-secondary flex items-center gap-2">
                <Loader2 size={16} className="animate-spin" /> Loading checklist…
              </div>
            ) : (
              <>
                <div className="p-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
                  <h2 className="text-lg font-semibold text-foreground">{currentChecklist.template_name}</h2>
                  <span className={`text-sm font-medium ${checklistComplete ? 'text-green-600' : 'text-foreground'}`}>
                    {currentChecklist.completed_items}/{currentChecklist.total_items} complete
                  </span>
                </div>

                <div className="divide-y divide-border">
                  {currentChecklist.items?.map((item: any) => (
                    <div key={item.id} className="px-4 py-3 group">
                      <div className="flex items-center justify-between">
                        <button
                          onClick={() => toggleItemMutation.mutate(item.id)}
                          className="flex items-center gap-3 flex-1 text-left"
                        >
                          {item.is_completed ? (
                            <Check size={18} className="text-green-600 shrink-0" />
                          ) : (
                            <Circle size={18} className="text-secondary/40 shrink-0" />
                          )}
                          <div>
                            <p className={`text-sm ${item.is_completed ? 'line-through text-secondary' : 'text-foreground'}`}>
                              {item.label}
                            </p>
                            {item.is_completed && item.completed_at && (
                              <p className="text-xs text-secondary">
                                Completed {new Date(item.completed_at).toLocaleDateString()}
                              </p>
                            )}
                          </div>
                        </button>
                        <div className="flex items-center gap-1">
                          {currentChecklist.supports_documents && (
                            item.document_url ? (
                              <>
                                <button
                                  onClick={() => downloadDoc(item.id, item.document_name || 'document')}
                                  className="inline-flex items-center gap-1.5 px-2 py-1 text-xs text-primary hover:bg-primary/5 rounded-lg max-w-[180px]"
                                  title={item.document_name}
                                >
                                  <Paperclip size={13} className="shrink-0" />
                                  <span className="truncate">{item.document_name || 'View'}</span>
                                  <Download size={12} className="shrink-0" />
                                </button>
                                <button
                                  onClick={() => setRemoveDoc({ id: item.id, name: item.document_name || 'document' })}
                                  className="p-1 rounded text-secondary/40 hover:text-red-500"
                                  title="Remove document"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </>
                            ) : (
                              <label className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border border-border rounded-lg cursor-pointer hover:bg-muted ${uploadingId === item.id ? 'opacity-60 pointer-events-none' : ''}`}>
                                {uploadingId === item.id ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                                Upload
                                <input
                                  type="file"
                                  className="hidden"
                                  accept=".pdf,.jpg,.jpeg,.png"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) { setUploadingId(item.id); uploadDocMutation.mutate({ itemId: item.id, file }); }
                                    e.target.value = '';
                                  }}
                                />
                              </label>
                            )
                          )}
                          <button
                            onClick={() => deleteItemMutation.mutate(item.id)}
                            className="p-1 rounded text-secondary/30 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                            title="Remove item"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Add custom item */}
                <div className="p-4 border-t border-border">
                  <form
                    onSubmit={(e) => { e.preventDefault(); if (newItem.trim()) addItemMutation.mutate({ instanceId: currentChecklist.id, label: newItem.trim() }); }}
                    className="flex gap-2"
                  >
                    <input
                      value={newItem}
                      onChange={(e) => setNewItem(e.target.value)}
                      placeholder="Add a custom checklist item..."
                      className="flex-1 px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <button
                      type="submit"
                      disabled={!newItem.trim() || addItemMutation.isPending}
                      className="flex items-center gap-1 px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50"
                    >
                      <Plus size={14} /> Add
                    </button>
                  </form>
                </div>
              </>
            )}
          </div>
        )}

        {/* Release Offer — document collection complete unlocks the salary editor */}
        {candidate.stage === 'document_collection' && (
          showOfferEditor ? (
            <OfferEditor
              candidateId={id}
              onCancel={() => setShowOfferEditor(false)}
              onReleased={() => { setShowOfferEditor(false); invalidateCandidate(); }}
            />
          ) : (
            <div className="bg-card rounded-xl border border-border p-6 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Release Offer</h2>
                <p className="text-sm text-secondary mt-0.5">
                  {checklistComplete
                    ? 'Document collection is complete. Set the salary and issue the offer letter.'
                    : 'Complete the document-collection checklist to unlock offer release.'}
                </p>
              </div>
              <button
                onClick={() => setShowOfferEditor(true)}
                disabled={!checklistComplete}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                <FileText size={15} /> Release Offer
              </button>
            </div>
          )
        )}

        {/* Move to Stage — plain forward moves + off-ramps */}
        {moveOptions.length > 0 && (
          <div className="bg-card rounded-xl border border-border p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Move to Stage</h2>
            <div className="flex flex-wrap gap-2 mb-4">
              {moveOptions.map((stage) => (
                <button
                  key={stage}
                  onClick={() => setSelectedStage(stage)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium capitalize border transition-colors ${
                    selectedStage === stage
                      ? `${stageClasses(stage, offRamps)} border-current`
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  {labelFor(stage, labels)}
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
                {offRamps.includes(selectedStage) && (
                  <p className="text-xs text-red-700">This archives the application out of the active pipeline.</p>
                )}
                {forwardBlockedByChecklist && (
                  <p className="text-xs text-amber-700">Complete the {currentChecklist?.template_name} checklist before advancing.</p>
                )}
                <button
                  onClick={() => {
                    if (offRamps.includes(selectedStage)) { setStageConfirm(selectedStage); return; }
                    stageMoveMutation.mutate({ stage: selectedStage, notes: moveNotes });
                  }}
                  disabled={stageMoveMutation.isPending || forwardBlockedByChecklist}
                  className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {stageMoveMutation.isPending ? 'Moving...' : `Move to ${labelFor(selectedStage, labels)}`}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Transfer to Manager — step 11 */}
        {candidate.stage === 'joining' && (
          <div className="bg-card rounded-xl border border-border p-6">
            <h2 className="text-lg font-semibold text-foreground mb-2">Transfer to Reporting Manager</h2>
            <p className="text-sm text-secondary mb-4">
              {checklistComplete
                ? 'Joining-day formalities are complete. Activate the employee and hand them to their manager.'
                : 'Complete the joining-day checklist to enable transfer.'}
            </p>
            <textarea
              value={moveNotes}
              onChange={(e) => setMoveNotes(e.target.value)}
              placeholder="Add notes (optional)"
              rows={2}
              className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none mb-3"
            />
            <button
              onClick={() => transferMutation.mutate()}
              disabled={transferMutation.isPending || !checklistComplete}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {transferMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={15} />}
              Transfer to Manager
            </button>
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
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium border ${stageClasses(h.from_stage, offRamps)}`}>
                        {labelFor(h.from_stage, labels)}
                      </span>
                      <ChevronRight size={12} className="text-secondary" />
                      <span className={`px-2 py-0.5 rounded text-xs font-medium border ${stageClasses(h.to_stage, offRamps)}`}>
                        {labelFor(h.to_stage, labels)}
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

      <ConfirmDialog
        open={!!stageConfirm}
        title="Archive applicant?"
        message={<>Move <span className="font-medium text-foreground">{candidate.name}</span> to <span className="font-medium text-foreground">{labelFor(stageConfirm || '', labels)}</span>? Their application moves out of the active pipeline.</>}
        confirmLabel="Archive"
        danger
        loading={stageMoveMutation.isPending}
        onConfirm={() => stageConfirm && stageMoveMutation.mutate({ stage: stageConfirm, notes: moveNotes })}
        onCancel={() => setStageConfirm(null)}
      />

      <ConfirmDialog
        open={!!removeDoc}
        title="Remove document?"
        message={`Remove "${removeDoc?.name}"? This also unchecks the item.`}
        confirmLabel="Remove"
        danger
        loading={removeDocMutation.isPending}
        onConfirm={() => removeDoc && removeDocMutation.mutate(removeDoc.id)}
        onCancel={() => setRemoveDoc(null)}
      />
    </AppShell>
  );
}

// ─── Salary editor (step 7) ───
//
// Carried over from the deleted onboarding EmployeeOfferEditor. The breakdown is
// computed by the SERVER via /offer-breakdown — no salary math in the client. The
// release button is disabled when the offered monthly CTC exceeds the sanctioned band.

function OfferRow({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={strong ? 'font-medium text-foreground' : 'text-secondary'}>{label}</span>
      <span className={strong ? 'font-semibold text-foreground' : 'text-foreground'}>{formatINR(value)}</span>
    </div>
  );
}

function OfferEditor({ candidateId, onCancel, onReleased }: { candidateId: string; onCancel: () => void; onReleased: () => void }) {
  const [designation, setDesignation] = useState('');
  const [joiningDate, setJoiningDate] = useState('');
  const [pct, setPct] = useState('0');
  const [finalBase, setFinalBase] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const { data: def, isLoading } = useQuery({
    queryKey: ['candidate-offer-defaults', candidateId],
    queryFn: () => api.get(`/recruitment/candidates/${candidateId}/offer-defaults`).then(r => r.data),
  });

  useEffect(() => {
    if (!def) return;
    setDesignation(def.designation || '');
    setFinalBase(def.base_gross ? String(def.base_gross) : '');
    setPct('0');
  }, [def]);

  const baseGross = Number(def?.base_gross) || 0;
  const finalNum = Math.round(Number(finalBase) || 0);

  // Server-computed live breakdown at the adjusted base (debounced while typing).
  const debouncedBase = useDebouncedValue(finalNum, 350);
  const { data: offerCalc } = useQuery({
    queryKey: ['candidate-offer-breakdown', candidateId, debouncedBase],
    queryFn: () => api.get(`/recruitment/candidates/${candidateId}/offer-breakdown?base=${debouncedBase}`).then(r => r.data),
    enabled: !!def?.configured && debouncedBase > 0,
    placeholderData: (prev) => prev,
  });
  const bd = offerCalc?.breakdown ?? null;
  // Manpower & Budget Control: offered monthly CTC cannot exceed the sanctioned band.
  const bandMax = def?.band_max ?? null;
  const overBand = bandMax != null && bd != null && bd.ctc > bandMax;

  const onPctChange = (v: string) => {
    setPct(v);
    if (baseGross > 0) setFinalBase(String(Math.round(baseGross * (1 + (Number(v) || 0) / 100))));
  };
  const onFinalChange = (v: string) => {
    setFinalBase(v);
    const f = Number(v) || 0;
    setPct(baseGross > 0 ? String(Math.round((f / baseGross - 1) * 10000) / 100) : '0');
  };

  async function handlePreview() {
    setPreviewing(true);
    try {
      const res = await api.post(`/recruitment/candidates/${candidateId}/offer/preview`,
        { base_gross: finalNum, designation, joining_date: joiningDate }, { responseType: 'blob' });
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' })));
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to generate preview');
    } finally { setPreviewing(false); }
  }

  const releaseMutation = useMutation({
    mutationFn: () => api.post(`/recruitment/candidates/${candidateId}/offer`,
      { base_gross: finalNum, designation, joining_date: joiningDate }),
    onSuccess: () => { toast.success('Offer letter issued'); onReleased(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to issue offer letter'),
  });

  if (isLoading) {
    return (
      <div className="bg-card rounded-xl border border-border p-6 flex items-center justify-center">
        <Loader2 className="animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <FileText size={18} className="text-primary" /> Release Offer — {def?.candidate_name}
        </h2>
        <button onClick={onCancel} className="flex items-center gap-1.5 text-secondary hover:text-foreground text-sm transition-colors">
          <ArrowLeft size={15} /> Cancel
        </button>
      </div>

      {def && !def.configured ? (
        <div className="bg-amber-50 border border-amber-300 text-amber-800 rounded-xl p-4 text-sm">
          No salary structure for this designation. Set it up in <a href="/setup/salary-structure" className="underline">Payroll → Salary Structures</a> first.
        </div>
      ) : def?.already_issued ? (
        <div className="bg-amber-50 border border-amber-300 text-amber-800 rounded-xl p-4 text-sm">
          An offer letter has already been issued for this candidate.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Designation</label>
              <input value={designation} onChange={(e) => setDesignation(e.target.value)}
                className="w-full px-3 py-2.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Joining Date</label>
              <input type="date" value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)}
                className="w-full px-3 py-2.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>

            <div className="border-t border-border pt-4">
              <p className="text-sm font-medium text-foreground">Base salary (monthly)</p>
              <p className="text-xs text-secondary mb-3">From structure: <b>{formatINR(baseGross)}</b>/mo. Adjust by % or set the final amount — a negative % decrements.</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1">Adjustment %</label>
                  <div className="relative">
                    <Percent size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-secondary" />
                    <input type="number" step="any" value={pct} onChange={(e) => onPctChange(e.target.value)}
                      className="w-full pl-7 pr-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1">Final monthly base ₹</label>
                  <div className="relative">
                    <IndianRupee size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-secondary" />
                    <input type="number" step="any" value={finalBase} onChange={(e) => onFinalChange(e.target.value)}
                      className="w-full pl-7 pr-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                  </div>
                </div>
              </div>
            </div>

            {bd && (
              <div className="bg-muted/40 rounded-lg p-4 text-sm space-y-1.5">
                {(bd.earnings ?? []).map((l: any) => (
                  <OfferRow key={l.name} label={l.name} value={l.amount} />
                ))}
                <OfferRow label="Gross Earnings" value={bd.gross_earnings} strong />
                <OfferRow label="Net In-Hand (approx.)" value={bd.net_pay} />
                <div className="flex items-center justify-between pt-2 mt-1 border-t border-border">
                  <span className="font-semibold text-primary">Annual CTC (offer)</span>
                  <span className="font-bold text-primary">{formatINR(offerCalc?.annual_ctc ?? 0)}</span>
                </div>
                {bandMax != null && (
                  <div className={`flex items-center justify-between pt-1.5 text-xs ${overBand ? 'text-red-600 font-medium' : 'text-secondary'}`}>
                    <span>Sanctioned cap (monthly CTC)</span>
                    <span>{formatINR(bandMax)}/mo</span>
                  </div>
                )}
              </div>
            )}

            {overBand && (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700">
                <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                <span>Offered monthly CTC <b>{formatINR(bd!.ctc)}</b> exceeds the sanctioned band maximum <b>{formatINR(bandMax!)}</b> for this role/property. Lower the base salary, or raise the band in Admin → Budget Control.</span>
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button onClick={handlePreview} disabled={previewing || !finalNum}
                className="flex items-center gap-2 px-5 py-2.5 border border-primary text-primary rounded-lg text-sm font-medium hover:bg-primary/5 disabled:opacity-50 transition-colors">
                {previewing ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />} Preview PDF
              </button>
              <button onClick={() => releaseMutation.mutate()} disabled={releaseMutation.isPending || !finalNum || !joiningDate || overBand}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                {releaseMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} Release Offer
              </button>
            </div>
          </div>

          <div className="bg-card rounded-xl border border-border overflow-hidden">
            {previewUrl ? (
              <iframe src={previewUrl} className="w-full h-[600px] border-0" title="Offer Letter Preview" />
            ) : (
              <div className="flex flex-col items-center justify-center h-[600px] text-secondary">
                <FileText size={48} className="opacity-20 mb-3" />
                <p className="text-sm">Adjust the base salary and click <b>Preview PDF</b></p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
