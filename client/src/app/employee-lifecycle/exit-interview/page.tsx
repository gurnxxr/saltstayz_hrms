'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import Breadcrumb from '@/components/ui/Breadcrumb';
import LoadError from '@/components/ui/LoadError';
import { Plus, ClipboardList, X, Loader2, Star, CheckCircle2 } from 'lucide-react';

const inputCls = 'w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';
const todayStr = () => new Date().toISOString().slice(0, 10);

const EXIT_REASONS = [
  'Better Opportunity', 'Compensation', 'Relocation', 'Personal',
  'Work Environment', 'Higher Studies', 'Other',
];

export default function ExitInterviewPage() {
  const [statusFilter, setStatusFilter] = useState('');
  const [showSchedule, setShowSchedule] = useState(false);
  const [completing, setCompleting] = useState<any | null>(null);

  const { data: rows = [], isError, refetch } = useQuery({
    queryKey: ['exit-interviews', statusFilter],
    queryFn: () => api.get(`/employee-lifecycle/exit-interviews${statusFilter ? `?status=${statusFilter}` : ''}`).then(r => r.data),
  });

  const fmt = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <Breadcrumb className="mb-2" items={[{ label: 'Employee Lifecycle' }, { label: 'Exit Interview' }]} />
            <h1 className="text-2xl font-bold text-foreground">Exit Interview</h1>
            <p className="text-secondary mt-1">Schedule interviews for departing employees and capture structured feedback</p>
          </div>
          <button onClick={() => setShowSchedule(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
            <Plus size={16} /> Schedule Interview
          </button>
        </div>

        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-border rounded-lg bg-background text-sm">
          <option value="">All Status</option>
          <option value="scheduled">Scheduled</option>
          <option value="completed">Completed</option>
        </select>

        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {isError ? (
            <LoadError message="Couldn't load exit interviews." onRetry={() => refetch()} />
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-secondary">
              <ClipboardList size={32} className="mx-auto mb-2 opacity-40" />
              <p className="text-sm font-medium text-foreground">No exit interviews yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-secondary">
                    <th className="px-4 py-3 font-medium">Employee</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Reason</th>
                    <th className="px-4 py-3 font-medium">Rating</th>
                    <th className="px-4 py-3 font-medium">Interviewer</th>
                    <th className="px-4 py-3 font-medium text-right"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r: any) => (
                    <tr key={r.id} className="hover:bg-muted/20">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-foreground">{r.first_name} {r.last_name}</p>
                        <p className="text-xs text-secondary">{r.employee_code} · {r.branch_name || '—'}</p>
                      </td>
                      <td className="px-4 py-2.5 text-secondary">{fmt(r.interview_date)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-secondary">{r.reason_for_leaving || '—'}</td>
                      <td className="px-4 py-2.5">
                        {r.overall_rating ? (
                          <span className="inline-flex items-center gap-1 text-foreground">
                            <Star size={13} className="text-amber-500 fill-amber-500" /> {r.overall_rating}/5
                          </span>
                        ) : <span className="text-xs text-secondary">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-secondary">{r.interviewer_email || '—'}</td>
                      <td className="px-4 py-2.5 text-right">
                        {r.status === 'scheduled' && (
                          <button onClick={() => setCompleting(r)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 transition-colors ml-auto">
                            <CheckCircle2 size={13} /> Complete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showSchedule && <ScheduleDialog onClose={() => setShowSchedule(false)} />}
      {completing && <CompleteDialog interview={completing} onClose={() => setCompleting(null)} />}
    </AppShell>
  );
}

function ScheduleDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [form, setForm] = useState({ employee_id: '', interview_date: todayStr(), reason_for_leaving: '' });

  const { data: employees = [] } = useQuery({
    queryKey: ['lifecycle-employees'],
    queryFn: () => api.get('/employee-lifecycle/employees').then(r => r.data),
  });

  const filteredEmployees = useMemo(() => {
    const q = employeeSearch.toLowerCase();
    if (!q) return employees;
    return employees.filter((e: any) =>
      `${e.first_name} ${e.last_name}`.toLowerCase().includes(q) || e.employee_code?.toLowerCase().includes(q));
  }, [employees, employeeSearch]);

  const scheduleMutation = useMutation({
    mutationFn: () => api.post('/employee-lifecycle/exit-interviews', {
      employee_id: Number(form.employee_id),
      interview_date: form.interview_date,
      reason_for_leaving: form.reason_for_leaving || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exit-interviews'] });
      toast.success('Exit interview scheduled');
      onClose();
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to schedule'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card rounded-xl border border-border shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-base font-semibold text-foreground">Schedule Exit Interview</h3>
          <button onClick={onClose} className="p-1 rounded-lg text-secondary hover:text-foreground hover:bg-muted transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Employee<span className="text-red-600"> *</span></label>
            <input className={`${inputCls} mb-1.5`} placeholder="Search name or code…"
              value={employeeSearch} onChange={(e) => setEmployeeSearch(e.target.value)} />
            <select className={inputCls} value={form.employee_id} size={5}
              onChange={(e) => setForm(p => ({ ...p, employee_id: e.target.value }))}>
              {filteredEmployees.map((e: any) => (
                <option key={e.id} value={e.id}>{e.first_name} {e.last_name} ({e.employee_code}) · {e.branch_name || '—'}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Interview date<span className="text-red-600"> *</span></label>
              <input type="date" className={inputCls} value={form.interview_date}
                onChange={(e) => setForm(p => ({ ...p, interview_date: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Expected reason</label>
              <select className={inputCls} value={form.reason_for_leaving}
                onChange={(e) => setForm(p => ({ ...p, reason_for_leaving: e.target.value }))}>
                <option value="">Unknown</option>
                {EXIT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs text-secondary">You are recorded as the interviewer; feedback is captured when the interview is completed.</p>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors">Cancel</button>
          <button onClick={() => scheduleMutation.mutate()} disabled={!form.employee_id || !form.interview_date || scheduleMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {scheduleMutation.isPending && <Loader2 size={14} className="animate-spin" />} Schedule
          </button>
        </div>
      </div>
    </div>
  );
}

function CompleteDialog({ interview, onClose }: { interview: any; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    reason_for_leaving: interview.reason_for_leaving || '',
    overall_rating: '',
    would_recommend: false,
    feedback: '',
    suggestions: '',
  });

  const completeMutation = useMutation({
    mutationFn: () => api.put(`/employee-lifecycle/exit-interviews/${interview.id}/complete`, {
      reason_for_leaving: form.reason_for_leaving || undefined,
      overall_rating: form.overall_rating ? Number(form.overall_rating) : undefined,
      would_recommend: form.would_recommend,
      feedback: form.feedback,
      suggestions: form.suggestions,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exit-interviews'] });
      toast.success('Exit interview completed');
      onClose();
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to complete'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card rounded-xl border border-border shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h3 className="text-base font-semibold text-foreground">Complete Interview</h3>
            <p className="text-xs text-secondary mt-0.5">{interview.first_name} {interview.last_name} ({interview.employee_code})</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-secondary hover:text-foreground hover:bg-muted transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Reason for leaving<span className="text-red-600"> *</span></label>
              <select className={inputCls} value={form.reason_for_leaving}
                onChange={(e) => setForm(p => ({ ...p, reason_for_leaving: e.target.value }))}>
                <option value="">Select…</option>
                {EXIT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Overall experience</label>
              <select className={inputCls} value={form.overall_rating}
                onChange={(e) => setForm(p => ({ ...p, overall_rating: e.target.value }))}>
                <option value="">Not rated</option>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} / 5</option>)}
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" className="accent-primary w-4 h-4" checked={form.would_recommend}
              onChange={(e) => setForm(p => ({ ...p, would_recommend: e.target.checked }))} />
            <span className="text-sm text-foreground">Would recommend SaltStayz as a place to work</span>
          </label>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Feedback</label>
            <textarea rows={3} className={`${inputCls} resize-none`} value={form.feedback}
              onChange={(e) => setForm(p => ({ ...p, feedback: e.target.value }))}
              placeholder="What the employee shared about their experience" />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Suggestions</label>
            <textarea rows={2} className={`${inputCls} resize-none`} value={form.suggestions}
              onChange={(e) => setForm(p => ({ ...p, suggestions: e.target.value }))}
              placeholder="What could improve" />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors">Cancel</button>
          <button onClick={() => completeMutation.mutate()} disabled={!form.reason_for_leaving || completeMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors">
            {completeMutation.isPending && <Loader2 size={14} className="animate-spin" />} Complete Interview
          </button>
        </div>
      </div>
    </div>
  );
}
