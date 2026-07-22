'use client';

import { useMemo, useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import LoadError from '@/components/ui/LoadError';
import AddApplicantDialog from '@/components/recruitment/AddApplicantDialog';
import { CANDIDATE_QUERY_KEYS } from '@/lib/constants';
import { Briefcase, Users, TrendingUp, CheckCircle2, Plus, User, ListChecks, ChevronDown, ChevronRight, Upload, UserPlus, X } from 'lucide-react';

// The server (recruitment.service.ts) is authoritative for the funnel — GET
// /recruitment/stages mirrors it. These locals are the fallback vocabulary so the
// board still renders if the stages endpoint hasn't answered yet.
const FUNNEL_ORDER = [
  'applied', 'interview', 'selected', 'document_collection', 'offer_released',
  'offer_accepted', 'pre_joining', 'joining', 'transferred',
];
const OFF_RAMPS = ['rejected', 'offer_declined', 'no_show'];
const STAGE_LABELS: Record<string, string> = {
  applied: 'Shortlisting', interview: 'Interview', selected: 'Selection',
  document_collection: 'Document Collection', offer_released: 'Offer Release',
  offer_accepted: 'Offer Acceptance', pre_joining: 'Pre-joining Formalities',
  joining: 'Joining Day', transferred: 'Transfer to Manager',
  rejected: 'Rejected', offer_declined: 'Offer Declined', no_show: 'No Show',
};
const STAGE_CHECKLIST: Record<string, string> = {
  document_collection: 'document_collection', pre_joining: 'pre_joining', joining: 'joining_day',
};

// Column accent per stage — a soft dot + header tint keeps 9 columns legible.
const STAGE_DOT: Record<string, string> = {
  applied: 'bg-gray-400', interview: 'bg-blue-500', selected: 'bg-indigo-500',
  document_collection: 'bg-amber-500', offer_released: 'bg-green-500',
  offer_accepted: 'bg-emerald-500', pre_joining: 'bg-purple-500',
  joining: 'bg-teal-500', transferred: 'bg-slate-500',
  rejected: 'bg-red-500', offer_declined: 'bg-orange-500', no_show: 'bg-rose-500',
};

export default function RecruitmentPage() {
  const router = useRouter();
  const [showOffRamp, setShowOffRamp] = useState(false);

  const { data: stages } = useQuery({
    queryKey: ['recruitment-stages'],
    queryFn: () => api.get('/recruitment/stages').then(r => r.data),
  });

  const { data: stats } = useQuery({
    queryKey: ['vacancy-stats'],
    queryFn: () => api.get('/recruitment/stats').then(r => r.data),
  });

  // Everything, archived included — off-ramped applicants live in the archive but
  // still belong on the board (in their off-ramp column).
  const { data: candidates = [], isError, refetch } = useQuery({
    queryKey: ['pipeline-candidates'],
    queryFn: () => api.get('/recruitment/candidates?archived=all').then(r => r.data),
  });

  // ── Bulk candidate upload (CSV → Shortlisting) ──
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const [showUpload, setShowUpload] = useState(false);
  const [showAddApplicant, setShowAddApplicant] = useState(false);
  const [uploadVacancyId, setUploadVacancyId] = useState('');
  const [uploadResult, setUploadResult] = useState<any>(null);
  const uploadFileRef = useRef<HTMLInputElement>(null);

  const { data: vacancies = [] } = useQuery({
    queryKey: ['vacancies'],
    queryFn: () => api.get('/recruitment/vacancies').then(r => r.data),
  });
  const openVacancies = vacancies.filter((v: any) => v.status !== 'closed');

  const uploadMutation = useMutation({
    mutationFn: ({ file, vacancyId }: { file: File; vacancyId: string }) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('vacancy_id', vacancyId);
      return api.post('/recruitment/candidates/bulk-upload', fd).then(r => r.data);
    },
    onSuccess: (data) => {
      setUploadResult(data);
      CANDIDATE_QUERY_KEYS.forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
      toast.success(`${data.created} candidate(s) added to Shortlisting${data.skipped ? `, ${data.skipped} skipped` : ''}`);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Upload failed'),
  });

  function handleUploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file && uploadVacancyId) { setUploadResult(null); uploadMutation.mutate({ file, vacancyId: uploadVacancyId }); }
    if (uploadFileRef.current) uploadFileRef.current.value = '';
  }
  function closeUpload() { setShowUpload(false); setUploadResult(null); setUploadVacancyId(''); }

  const funnelOrder: string[] = stages?.funnel_order ?? FUNNEL_ORDER;
  const offRamps: string[] = stages?.off_ramps ?? OFF_RAMPS;
  const labels: Record<string, string> = stages?.labels ?? STAGE_LABELS;
  const stageChecklist: Record<string, string> = stages?.stage_checklist ?? STAGE_CHECKLIST;

  const byStage = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const c of candidates) (map[c.stage] ||= []).push(c);
    return map;
  }, [candidates]);

  const funnelCount = funnelOrder.reduce((n, s) => n + (byStage[s]?.length ?? 0), 0);
  const offRampCount = offRamps.reduce((n, s) => n + (byStage[s]?.length ?? 0), 0);

  const statCards = [
    { label: 'Open Vacancies', value: stats?.open_count ?? 0, icon: Briefcase, color: 'text-blue-600 bg-blue-50' },
    { label: 'Active Candidates', value: funnelCount, icon: Users, color: 'text-green-600 bg-green-50' },
    { label: 'In Interview', value: byStage.interview?.length ?? 0, icon: TrendingUp, color: 'text-purple-600 bg-purple-50' },
    { label: 'Positions Filled', value: stats?.total_filled ?? 0, icon: CheckCircle2, color: 'text-orange-600 bg-orange-50' },
  ];

  function Column({ stage }: { stage: string }) {
    const rows = byStage[stage] ?? [];
    return (
      <div className="flex flex-col rounded-xl border border-border bg-muted/40">
        <div className="px-3 py-2.5 border-b border-border">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full shrink-0 ${STAGE_DOT[stage] || 'bg-gray-400'}`} />
            <span className="text-sm font-semibold text-foreground truncate">{labels[stage] || stage}</span>
            <span className="ml-auto text-xs font-medium text-secondary bg-card border border-border rounded-full px-1.5 py-0.5">
              {rows.length}
            </span>
          </div>
          {stageChecklist[stage] && (
            <p className="mt-1 flex items-center gap-1 text-[11px] text-secondary">
              <ListChecks size={12} className="shrink-0" /> Checklist gate
            </p>
          )}
        </div>
        <div className="p-2 space-y-2 min-h-[80px] max-h-72 overflow-y-auto">
          {rows.length === 0 ? (
            <p className="text-center text-xs text-secondary py-6">No candidates</p>
          ) : (
            rows.map((c: any) => (
              <Link
                key={c.id}
                href={`/recruitment/candidates/${c.id}`}
                className="block bg-card rounded-lg border border-border p-3 hover:border-primary/50 hover:shadow-sm transition-all"
              >
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <User size={13} className="text-primary" />
                  </div>
                  <span className="text-sm font-medium text-foreground truncate">{c.name}</span>
                </div>
                <p className="text-xs text-secondary mt-2 truncate">{c.job_title}</p>
                <p className="text-[11px] text-secondary mt-1">
                  Applied {new Date(c.created_at).toLocaleDateString()}
                </p>
              </Link>
            ))
          )}
        </div>
      </div>
    );
  }

  return (
    <AppShell>
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Recruitment Pipeline</h1>
            <p className="text-secondary mt-1">Every applicant, by stage — click a card to open the candidate.</p>
          </div>
          <div className="flex gap-3">
            <Link
              href="/recruitment/vacancies"
              className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
            >
              Vacancies
            </Link>
            <Link
              href="/recruitment/candidates"
              className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
            >
              All Candidates
            </Link>
            {can('recruitment', 'create') && (
              <>
                <button
                  onClick={() => setShowAddApplicant(true)}
                  className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
                >
                  <UserPlus size={16} /> Add Applicant
                </button>
                <button
                  onClick={() => { setUploadResult(null); setShowUpload(true); }}
                  className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
                >
                  <Upload size={16} /> Upload Candidates
                </button>
              </>
            )}
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
            <div key={card.label} className="bg-card rounded-xl border border-border p-4">
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

        {/* Off-ramp toggle */}
        {offRampCount > 0 && (
          <div className="flex items-center justify-end">
            <button
              onClick={() => setShowOffRamp(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 border rounded-lg text-sm font-medium transition-colors ${
                showOffRamp ? 'border-primary text-primary bg-primary/5' : 'border-border hover:bg-muted'
              }`}
            >
              {showOffRamp ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              Off-ramp ({offRampCount})
            </button>
          </div>
        )}

        {/* Kanban board — 9 funnel columns, horizontally scrollable */}
        {isError ? (
          <div className="bg-card rounded-xl border border-border">
            <LoadError message="Couldn't load the pipeline." onRetry={() => refetch()} />
          </div>
        ) : (
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 pb-4">
            {funnelOrder.map((stage) => <Column key={stage} stage={stage} />)}
            {showOffRamp && offRamps.map((stage) => <Column key={stage} stage={stage} />)}
          </div>
        )}
      </div>

      {showAddApplicant && <AddApplicantDialog onClose={() => setShowAddApplicant(false)} />}

      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closeUpload}>
          <div className="bg-card rounded-xl border border-border w-full max-w-lg p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-foreground">Upload Candidates</h3>
              <button onClick={closeUpload}><X size={16} className="text-secondary" /></button>
            </div>
            <p className="text-sm text-secondary">
              Import a CSV of applicants for a vacancy — each row is added under{' '}
              <strong className="text-foreground">Shortlisting</strong>. Columns:{' '}
              <span className="font-medium text-foreground">Name</span> (required), Phone Number, Address, Resume Link, Email Address.
            </p>
            <div>
              <label className="block text-xs font-medium mb-1">Vacancy *</label>
              <select
                value={uploadVacancyId}
                onChange={(e) => setUploadVacancyId(e.target.value)}
                disabled={uploadMutation.isPending}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm disabled:opacity-50"
              >
                <option value="">Select vacancy…</option>
                {openVacancies.map((v: any) => (
                  <option key={v.id} value={v.id}>{v.job_title} — {v.property_name}</option>
                ))}
              </select>
              {openVacancies.length === 0 && (
                <p className="mt-1 text-xs text-amber-600">No open vacancies — create or reopen one first.</p>
              )}
            </div>
            <input ref={uploadFileRef} type="file" accept=".csv" className="hidden" onChange={handleUploadFile} />
            <button
              onClick={() => uploadFileRef.current?.click()}
              disabled={!uploadVacancyId || uploadMutation.isPending}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              <Upload size={16} /> {uploadMutation.isPending ? 'Processing…' : 'Choose CSV file'}
            </button>
            {!uploadVacancyId && <p className="text-xs text-secondary text-center">Pick a vacancy to enable upload.</p>}
            {uploadResult && (
              <div className="rounded-lg border border-border p-3 text-sm space-y-2">
                <p className="font-medium text-foreground">{uploadResult.total} row(s) processed</p>
                <div className="flex flex-wrap gap-4 text-xs">
                  <span className="text-green-600">{uploadResult.created} added</span>
                  {uploadResult.skipped > 0 && <span className="text-yellow-600">{uploadResult.skipped} skipped</span>}
                </div>
                {uploadResult.errors?.length > 0 && (
                  <div className="max-h-40 overflow-y-auto rounded bg-red-50 border border-red-200 p-2 space-y-0.5">
                    {uploadResult.errors.map((err: string, i: number) => (
                      <p key={i} className="text-xs text-red-700">{err}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
