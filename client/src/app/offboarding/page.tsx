'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { UserMinus, Plus, Search, X, Eye, Loader2, Users, CheckCircle2 } from 'lucide-react';

const EXIT_TYPES = [
  { v: 'resignation', l: 'Resignation' },
  { v: 'termination', l: 'Termination' },
  { v: 'retirement', l: 'Retirement' },
  { v: 'end_of_contract', l: 'End of Contract' },
  { v: 'absconding', l: 'Absconding' },
];

const STATUS_BADGE: Record<string, string> = {
  initiated: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  cleared: 'bg-amber-100 text-amber-700',
  completed: 'bg-green-100 text-green-700',
};

export default function OffboardingPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);

  const { data: stats } = useQuery({ queryKey: ['offboarding-stats'], queryFn: () => api.get('/offboarding/stats').then(r => r.data) });
  const { data: cases = [], isFetching } = useQuery({
    queryKey: ['offboarding-cases', statusFilter],
    queryFn: () => api.get(`/offboarding/cases${statusFilter ? `?status=${statusFilter}` : ''}`).then(r => r.data),
    placeholderData: keepPreviousData,
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <UserMinus className="text-primary" size={22} />
              <h1 className="text-2xl font-bold text-foreground">Offboarding</h1>
            </div>
            <p className="text-secondary mt-1">Manage employee exits — resignation, clearance, Full &amp; Final settlement, and access revocation.</p>
          </div>
          <button onClick={() => setShowForm(true)} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
            <Plus size={16} /> Initiate Offboarding
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="In Progress" value={stats?.in_progress ?? 0} color="text-blue-600" />
          <Stat label="Cleared (awaiting FnF)" value={stats?.cleared ?? 0} color="text-amber-600" />
          <Stat label="Active Cases" value={stats?.active ?? 0} color="text-foreground" />
          <Stat label="Completed Exits" value={stats?.completed ?? 0} color="text-green-600" />
        </div>

        <div className="flex gap-2">
          {['', 'initiated', 'in_progress', 'cleared', 'completed'].map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm capitalize transition-colors ${statusFilter === s ? 'bg-primary text-white' : 'border border-border text-secondary hover:bg-muted'}`}>
              {s === '' ? 'All' : s.replace('_', ' ')}
            </button>
          ))}
        </div>

        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <table className="w-full">
            <thead><tr className="border-b border-border bg-muted/50">
              <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Employee</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Exit Type</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Last Working Day</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Clearance</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Status</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-secondary uppercase">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {cases.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-12 text-secondary text-sm">No offboarding cases{statusFilter ? ' in this status' : ''}.</td></tr>
              ) : cases.map((c: any) => (
                <tr key={c.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => router.push(`/offboarding/${c.id}`)}>
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-foreground">{c.first_name} {c.last_name}</div>
                    <div className="text-xs text-secondary">{c.employee_code} · {c.designation || '—'}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-foreground capitalize">{c.exit_type?.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3 text-sm text-secondary">{formatDate(c.last_working_day)}</td>
                  <td className="px-4 py-3 text-sm text-secondary">{c.completed_items}/{c.total_items}</td>
                  <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_BADGE[c.status]}`}>{c.status?.replace('_', ' ')}</span></td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={(e) => { e.stopPropagation(); router.push(`/offboarding/${c.id}`); }} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5 rounded-lg"><Eye size={14} /> Open</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {isFetching && <div className="px-4 py-2 text-xs text-secondary">updating…</div>}
        </div>
      </div>

      {showForm && <InitiateModal onClose={() => setShowForm(false)} onDone={(id) => { setShowForm(false); queryClient.invalidateQueries({ queryKey: ['offboarding-cases'] }); queryClient.invalidateQueries({ queryKey: ['offboarding-stats'] }); router.push(`/offboarding/${id}`); }} />}
    </AppShell>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <p className="text-xs text-secondary">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  );
}

function InitiateModal({ onClose, onDone }: { onClose: () => void; onDone: (id: number) => void }) {
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<any>(null);
  const [form, setForm] = useState({ exit_type: 'resignation', resignation_date: '', last_working_day: '', notice_period_days: '', reason: '' });

  const { data: results, isFetching: searching } = useQuery({
    queryKey: ['emp-picker', search],
    // page=1 forces the paginated { data } shape — without it the API returns a bare array.
    queryFn: () => api.get(`/employees?status=active&page=1&pageSize=8${search ? `&search=${encodeURIComponent(search)}` : ''}`).then(r => r.data),
    enabled: !picked,
    placeholderData: keepPreviousData,
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/offboarding/cases', { employee_id: picked.id, ...form }).then(r => r.data),
    onSuccess: (c) => { toast.success('Offboarding initiated'); onDone(c.id); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to initiate'),
  });

  // The API returns { data } when paginated, or a bare array otherwise — handle both.
  const employees = Array.isArray(results) ? results : (results?.data ?? []);
  const valid = picked && form.last_working_day;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card rounded-xl border border-border shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">Initiate Offboarding</h2>
          <button onClick={onClose}><X size={18} className="text-secondary" /></button>
        </div>

        {!picked ? (
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">Select an active employee to offboard</label>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
              <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or employee code…"
                className="w-full pl-9 pr-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
            <div className="mt-2 divide-y divide-border max-h-64 overflow-y-auto">
              {employees.map((e: any) => (
                <button key={e.id} onClick={() => setPicked(e)} className="w-full text-left px-2 py-2 hover:bg-muted/40 rounded flex items-center gap-2">
                  <span className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0">
                    {e.first_name?.[0]}{e.last_name?.[0]}
                  </span>
                  <span className="min-w-0">
                    <span className="text-sm font-medium text-foreground">{e.first_name} {e.last_name}</span>
                    <span className="text-xs text-secondary ml-2">{e.employee_code} · {e.designation_name || '—'}</span>
                  </span>
                </button>
              ))}
              {employees.length === 0 && (
                <p className="text-sm text-secondary py-3 text-center">
                  {searching ? 'Loading…' : search ? 'No active employees found.' : 'No active employees.'}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between bg-muted/40 rounded-lg px-3 py-2">
              <div>
                <span className="text-sm font-medium text-foreground">{picked.first_name} {picked.last_name}</span>
                <span className="text-xs text-secondary ml-2">{picked.employee_code}</span>
              </div>
              <button onClick={() => setPicked(null)} className="text-xs text-primary">Change</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-secondary mb-1">Exit type</label>
                <select value={form.exit_type} onChange={(e) => setForm({ ...form, exit_type: e.target.value })} className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm">
                  {EXIT_TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-secondary mb-1">Notice period (days)</label>
                <input type="number" value={form.notice_period_days} onChange={(e) => setForm({ ...form, notice_period_days: e.target.value })} className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-secondary mb-1">Resignation / notice date</label>
                <input type="date" value={form.resignation_date} onChange={(e) => setForm({ ...form, resignation_date: e.target.value })} className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-secondary mb-1">Last working day *</label>
                <input type="date" value={form.last_working_day} onChange={(e) => setForm({ ...form, last_working_day: e.target.value })} className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">Reason</label>
              <textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={2} className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm resize-none" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-sm">Cancel</button>
              <button onClick={() => createMutation.mutate()} disabled={!valid || createMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">
                {createMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Start offboarding
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
