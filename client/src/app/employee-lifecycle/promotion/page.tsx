'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import Breadcrumb from '@/components/ui/Breadcrumb';
import LoadError from '@/components/ui/LoadError';
import { formatINR } from '@/lib/utils';
import { Plus, TrendingUp, ArrowRight, X, Loader2, History, Search, Users } from 'lucide-react';

const inputCls = 'w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';
const todayStr = () => new Date().toISOString().slice(0, 10);
const fmt = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export default function EmployeePromotionPage() {
  const [tab, setTab] = useState<'promote' | 'history'>('promote');
  // The New Promotion dialog is shared by the header button (no preselect) and
  // the per-row "Promote" buttons on the Promote tab (preselect that employee).
  const [dialog, setDialog] = useState<{ open: boolean; employeeId?: string }>({ open: false });
  const openDialog = (employeeId?: string) => setDialog({ open: true, employeeId });

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <Breadcrumb className="mb-2" items={[{ label: 'Employee Lifecycle' }, { label: 'Employee Promotion' }]} />
            <h1 className="text-2xl font-bold text-foreground">Employee Promotion</h1>
            <p className="text-secondary mt-1">Change an employee&apos;s designation with an optional salary revision — applied immediately, history kept</p>
          </div>
          <button onClick={() => openDialog()}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
            <Plus size={16} /> New Promotion
          </button>
        </div>

        <div className="flex gap-1 border-b border-border">
          <TabBtn active={tab === 'promote'} onClick={() => setTab('promote')} icon={TrendingUp} label="Promote" />
          <TabBtn active={tab === 'history'} onClick={() => setTab('history')} icon={History} label="History" />
        </div>

        {tab === 'promote' ? <PromoteTab onPromote={(id) => openDialog(id)} /> : <HistoryTab />}
      </div>

      {dialog.open && <NewPromotionDialog initialEmployeeId={dialog.employeeId} onClose={() => setDialog({ open: false })} />}
    </AppShell>
  );
}

function TabBtn({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: React.ElementType; label: string }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${active ? 'border-primary text-primary' : 'border-transparent text-secondary hover:text-foreground'}`}>
      <Icon size={15} /> {label}
    </button>
  );
}

// ─────────────────────────────── Promote ───────────────────────────────
// A directory of active employees with their current designation. Each row can
// launch the New Promotion dialog pre-selected to that person.
function PromoteTab({ onPromote }: { onPromote: (employeeId: string) => void }) {
  const [search, setSearch] = useState('');
  const { data: employees = [], isError, refetch } = useQuery({
    queryKey: ['lifecycle-employees'],
    queryFn: () => api.get('/employee-lifecycle/employees').then(r => r.data),
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return employees;
    return employees.filter((e: any) =>
      `${e.first_name} ${e.last_name}`.toLowerCase().includes(q) ||
      e.employee_code?.toLowerCase().includes(q) ||
      (e.designation || '').toLowerCase().includes(q) ||
      (e.branch_name || '').toLowerCase().includes(q));
  }, [employees, search]);

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, code, designation…"
          className="w-full pl-9 pr-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {isError ? (
          <LoadError message="Couldn't load employees." onRetry={() => refetch()} />
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-secondary">
            <Users size={32} className="mx-auto mb-2 opacity-40" />
            <p className="text-sm font-medium text-foreground">No employees found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-secondary">
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Current designation</th>
                  <th className="px-4 py-3 font-medium">Branch</th>
                  <th className="px-4 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((e: any) => (
                  <tr key={e.id} className="hover:bg-muted/20">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-foreground">{e.first_name} {e.last_name}</p>
                      <p className="text-xs text-secondary">{e.employee_code}</p>
                    </td>
                    <td className="px-4 py-2.5 text-foreground">{e.designation || '—'}</td>
                    <td className="px-4 py-2.5 text-secondary">{e.branch_name || '—'}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => onPromote(String(e.id))}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-sm font-medium text-primary hover:bg-muted transition-colors">
                        <TrendingUp size={14} /> Promote
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────── History ───────────────────────────────
// The full log of every promotion made (global), newest first.
function HistoryTab() {
  const [search, setSearch] = useState('');
  const { data: rows = [], isError, refetch } = useQuery({
    queryKey: ['lifecycle-promotions'],
    queryFn: () => api.get('/employee-lifecycle/promotions').then(r => r.data),
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return rows;
    return rows.filter((r: any) =>
      `${r.first_name} ${r.last_name}`.toLowerCase().includes(q) ||
      r.employee_code?.toLowerCase().includes(q) ||
      (r.to_designation || '').toLowerCase().includes(q) ||
      (r.from_designation || '').toLowerCase().includes(q));
  }, [rows, search]);

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, code, designation…"
          className="w-full pl-9 pr-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {isError ? (
          <LoadError message="Couldn't load promotions." onRetry={() => refetch()} />
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-secondary">
            <TrendingUp size={32} className="mx-auto mb-2 opacity-40" />
            <p className="text-sm font-medium text-foreground">{rows.length === 0 ? 'No promotions recorded yet' : 'No promotions match your search'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-secondary">
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Designation</th>
                  <th className="px-4 py-3 font-medium">Salary Base</th>
                  <th className="px-4 py-3 font-medium">Note</th>
                  <th className="px-4 py-3 font-medium">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((r: any) => (
                  <tr key={r.id} className="hover:bg-muted/20">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-foreground">{r.first_name} {r.last_name}</p>
                      <p className="text-xs text-secondary">{r.employee_code} · {r.branch_name || '—'}</p>
                    </td>
                    <td className="px-4 py-2.5 text-secondary">{fmt(r.promotion_date)}</td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5 text-foreground">
                        <span className="text-secondary">{r.from_designation || '—'}</span>
                        <ArrowRight size={13} className="text-primary shrink-0" />
                        <span className="font-medium">{r.to_designation}</span>
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      {r.to_base ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-secondary">{r.from_base ? formatINR(r.from_base) : '—'}</span>
                          <ArrowRight size={13} className="text-green-600 shrink-0" />
                          <span className="font-medium text-green-700">{formatINR(r.to_base)}</span>
                        </span>
                      ) : <span className="text-xs text-secondary">unchanged</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-secondary max-w-48 truncate" title={r.note || ''}>{r.note || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-secondary">{r.created_by_email || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function NewPromotionDialog({ initialEmployeeId, onClose }: { initialEmployeeId?: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [reviseSalary, setReviseSalary] = useState(false);
  const [form, setForm] = useState({
    employee_id: initialEmployeeId ?? '', to_job_title_id: '', promotion_date: todayStr(), new_base: '', note: '',
  });

  const { data: employees = [] } = useQuery({
    queryKey: ['lifecycle-employees'],
    queryFn: () => api.get('/employee-lifecycle/employees').then(r => r.data),
  });
  const { data: options } = useQuery({
    queryKey: ['lifecycle-options'],
    queryFn: () => api.get('/employee-lifecycle/options').then(r => r.data),
  });

  const filteredEmployees = useMemo(() => {
    const q = employeeSearch.toLowerCase();
    if (!q) return employees;
    return employees.filter((e: any) =>
      `${e.first_name} ${e.last_name}`.toLowerCase().includes(q) || e.employee_code?.toLowerCase().includes(q));
  }, [employees, employeeSearch]);

  const selectedEmployee = employees.find((e: any) => String(e.id) === form.employee_id);

  const setTarget = (jobTitleId: string) => setForm(p => ({ ...p, to_job_title_id: jobTitleId }));

  const createMutation = useMutation({
    mutationFn: () => api.post('/employee-lifecycle/promotions', {
      employee_id: Number(form.employee_id),
      to_job_title_id: Number(form.to_job_title_id),
      promotion_date: form.promotion_date,
      new_base: reviseSalary && form.new_base ? Number(form.new_base) : undefined,
      note: form.note,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lifecycle-promotions'] });
      queryClient.invalidateQueries({ queryKey: ['lifecycle-employees'] });
      queryClient.invalidateQueries({ queryKey: ['employee-salary'] });
      toast.success('Promotion applied');
      onClose();
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to promote'),
  });

  const canSubmit = form.employee_id && form.to_job_title_id && form.promotion_date && (!reviseSalary || Number(form.new_base) > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card rounded-xl border border-border shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-base font-semibold text-foreground">New Promotion</h3>
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
                <option key={e.id} value={e.id}>{e.first_name} {e.last_name} ({e.employee_code}) · {e.designation || 'No designation'}</option>
              ))}
            </select>
            {selectedEmployee && (
              <p className="text-xs text-secondary mt-1">Current designation: <b>{selectedEmployee.designation || '—'}</b></p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">New designation<span className="text-red-600"> *</span></label>
              <select className={inputCls} value={form.to_job_title_id} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Select…</option>
                {(options?.job_titles ?? []).map((jt: any) => (
                  <option key={jt.id} value={jt.id} disabled={selectedEmployee?.job_title_id === jt.id}>{jt.title}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Promotion date<span className="text-red-600"> *</span></label>
              <input type="date" className={inputCls} value={form.promotion_date}
                onChange={(e) => setForm(p => ({ ...p, promotion_date: e.target.value }))} />
            </div>
          </div>
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" className="accent-primary w-4 h-4 mt-0.5" checked={reviseSalary}
              onChange={(e) => setReviseSalary(e.target.checked)} />
            <span className="text-sm text-foreground">Revise salary
              <span className="block text-xs text-secondary">Updates the employee&apos;s base salary. Their salary components and TDS are kept unchanged.</span>
            </span>
          </label>
          {reviseSalary && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">New monthly base ₹<span className="text-red-600"> *</span></label>
              <input type="number" min={1} className={inputCls} value={form.new_base}
                onChange={(e) => setForm(p => ({ ...p, new_base: e.target.value }))} />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Note</label>
            <textarea rows={2} className={`${inputCls} resize-none`} value={form.note}
              onChange={(e) => setForm(p => ({ ...p, note: e.target.value }))} placeholder="Optional context" />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors">Cancel</button>
          <button onClick={() => createMutation.mutate()} disabled={!canSubmit || createMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {createMutation.isPending && <Loader2 size={14} className="animate-spin" />} Promote
          </button>
        </div>
      </div>
    </div>
  );
}
