'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import Breadcrumb from '@/components/ui/Breadcrumb';
import LoadError from '@/components/ui/LoadError';
import { Plus, ArrowRightLeft, ArrowRight, X, Loader2 } from 'lucide-react';

const inputCls = 'w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';
const todayStr = () => new Date().toISOString().slice(0, 10);

export default function EmployeeTransferPage() {
  const [showNew, setShowNew] = useState(false);

  const { data: rows = [], isError, refetch } = useQuery({
    queryKey: ['lifecycle-transfers'],
    queryFn: () => api.get('/employee-lifecycle/transfers').then(r => r.data),
  });

  const fmt = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  const change = (from: string | null, to: string | null) => to ? (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-secondary">{from || '—'}</span>
      <ArrowRight size={13} className="text-primary shrink-0" />
      <span className="font-medium text-foreground">{to}</span>
    </span>
  ) : <span className="text-xs text-secondary">unchanged</span>;

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <Breadcrumb className="mb-2" items={[{ label: 'Employee Lifecycle' }, { label: 'Employee Transfer' }]} />
            <h1 className="text-2xl font-bold text-foreground">Employee Transfer</h1>
            <p className="text-secondary mt-1">Move employees between properties and departments — applied immediately, history kept</p>
          </div>
          <button onClick={() => setShowNew(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
            <Plus size={16} /> New Transfer
          </button>
        </div>

        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {isError ? (
            <LoadError message="Couldn't load transfers." onRetry={() => refetch()} />
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-secondary">
              <ArrowRightLeft size={32} className="mx-auto mb-2 opacity-40" />
              <p className="text-sm font-medium text-foreground">No transfers recorded yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-secondary">
                    <th className="px-4 py-3 font-medium">Employee</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Property</th>
                    <th className="px-4 py-3 font-medium">Department</th>
                    <th className="px-4 py-3 font-medium">Note</th>
                    <th className="px-4 py-3 font-medium">By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r: any) => (
                    <tr key={r.id} className="hover:bg-muted/20">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-foreground">{r.first_name} {r.last_name}</p>
                        <p className="text-xs text-secondary">{r.employee_code}</p>
                      </td>
                      <td className="px-4 py-2.5 text-secondary">{fmt(r.transfer_date)}</td>
                      <td className="px-4 py-2.5">{change(r.from_branch, r.to_branch)}</td>
                      <td className="px-4 py-2.5">{change(r.from_dept, r.to_dept)}</td>
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

      {showNew && <NewTransferDialog onClose={() => setShowNew(false)} />}
    </AppShell>
  );
}

function NewTransferDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [form, setForm] = useState({ employee_id: '', transfer_date: todayStr(), to_branch: '', to_dept: '', note: '' });

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

  const createMutation = useMutation({
    mutationFn: () => api.post('/employee-lifecycle/transfers', {
      employee_id: Number(form.employee_id),
      transfer_date: form.transfer_date,
      to_branch: form.to_branch || undefined,
      to_dept: form.to_dept || undefined,
      note: form.note,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lifecycle-transfers'] });
      queryClient.invalidateQueries({ queryKey: ['lifecycle-employees'] });
      toast.success('Transfer applied');
      onClose();
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to transfer'),
  });

  const canSubmit = form.employee_id && form.transfer_date && (form.to_branch || form.to_dept);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card rounded-xl border border-border shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-base font-semibold text-foreground">New Transfer</h3>
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
            {selectedEmployee && (
              <p className="text-xs text-secondary mt-1">Currently: <b>{selectedEmployee.branch_name || '—'}</b> · {selectedEmployee.dept_name || '—'}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">New property</label>
              <select className={inputCls} value={form.to_branch} onChange={(e) => setForm(p => ({ ...p, to_branch: e.target.value }))}>
                <option value="">— Unchanged —</option>
                {(options?.properties ?? []).map((p: any) => (
                  <option key={p.id} value={p.name} disabled={selectedEmployee?.branch_name === p.name}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">New department</label>
              <select className={inputCls} value={form.to_dept} onChange={(e) => setForm(p => ({ ...p, to_dept: e.target.value }))}>
                <option value="">— Unchanged —</option>
                {(options?.departments ?? []).map((d: any) => (
                  <option key={d.id} value={d.name} disabled={selectedEmployee?.dept_name === d.name}>{d.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Transfer date<span className="text-red-600"> *</span></label>
            <input type="date" className={inputCls} value={form.transfer_date}
              onChange={(e) => setForm(p => ({ ...p, transfer_date: e.target.value }))} />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Note</label>
            <textarea rows={2} className={`${inputCls} resize-none`} value={form.note}
              onChange={(e) => setForm(p => ({ ...p, note: e.target.value }))} placeholder="Optional context" />
          </div>
          <p className="text-xs text-secondary">Property changes take effect everywhere — manpower budgets, holiday region, and attendance views follow the new property.</p>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors">Cancel</button>
          <button onClick={() => createMutation.mutate()} disabled={!canSubmit || createMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {createMutation.isPending && <Loader2 size={14} className="animate-spin" />} Transfer
          </button>
        </div>
      </div>
    </div>
  );
}
