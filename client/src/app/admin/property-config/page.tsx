'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import {
  ArrowLeft, SlidersHorizontal, IndianRupee, Users, Wallet, TrendingUp, Save, X, MapPin,
} from 'lucide-react';

const inr = (n: number | null | undefined) =>
  n == null ? '—' : '₹' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0));

// Work status: server enum (active/pip/on_notice/left) ↔ display labels the admin uses.
const STATUS_META: Record<string, { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'bg-green-100 text-green-700 border-green-200' },
  pip: { label: 'PIP', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  on_notice: { label: 'Notice', cls: 'bg-orange-100 text-orange-700 border-orange-200' },
  left: { label: 'Inactive', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
};
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'pip', label: 'PIP' },
  { value: 'on_notice', label: 'Notice' },
  { value: 'left', label: 'Inactive' },
];

export default function PropertyConfigPage() {
  const router = useRouter();
  const [city, setCity] = useState('');
  const [propertyId, setPropertyId] = useState('');

  const { data: properties = [] } = useQuery({
    queryKey: ['pc-properties'],
    queryFn: () => api.get('/manpower/properties').then(r => r.data),
  });

  const cities = useMemo(
    () => Array.from(new Set(properties.map((p: any) => p.city).filter(Boolean))).sort(),
    [properties]
  );
  const propsInCity = useMemo(
    () => properties.filter((p: any) => !city || p.city === city),
    [properties, city]
  );

  return (
    <AppShell>
      <div className="space-y-6">
        <button onClick={() => router.push('/admin')} className="flex items-center gap-2 text-secondary hover:text-foreground text-sm">
          <ArrowLeft size={16} /> Back to Admin
        </button>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><SlidersHorizontal className="text-primary" size={20} /></div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Property Configuration</h1>
            <p className="text-secondary text-sm">Pick a city and property to configure workers, salaries, spend, budget and status.</p>
          </div>
        </div>

        {/* Selectors */}
        <div className="bg-card rounded-xl border border-border p-5 flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-secondary mb-1 flex items-center gap-1"><MapPin size={12} /> City</label>
            <select value={city} onChange={e => { setCity(e.target.value); setPropertyId(''); }}
              className="px-3 py-2 border border-border rounded-lg bg-background text-sm min-w-[200px]">
              <option value="">All cities</option>
              {cities.map((c: any) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">Property</label>
            <select value={propertyId} onChange={e => setPropertyId(e.target.value)}
              className="px-3 py-2 border border-border rounded-lg bg-background text-sm min-w-[280px]">
              <option value="">Select property</option>
              {propsInCity.map((p: any) => <option key={p.id} value={p.id}>{p.name}{p.city ? ` — ${p.city}` : ''}</option>)}
            </select>
          </div>
        </div>

        {propertyId ? <Console propertyId={Number(propertyId)} /> : (
          <div className="bg-card rounded-xl border border-dashed border-border p-10 text-center text-secondary text-sm">
            Select a property to open its configuration.
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Console({ propertyId }: { propertyId: number }) {
  const qc = useQueryClient();
  const [statusTarget, setStatusTarget] = useState<any | null>(null);
  const [salaryEdits, setSalaryEdits] = useState<Record<number, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ['property-console', propertyId],
    queryFn: () => api.get(`/manpower/property-console?property_id=${propertyId}`).then(r => r.data),
  });

  const saveSalary = useMutation({
    mutationFn: ({ id, monthly_ctc }: any) => api.put(`/manpower/employees/${id}/salary`, { monthly_ctc: Number(monthly_ctc) }),
    onSuccess: (_d, v: any) => { toast.success('Salary updated'); setSalaryEdits(e => { const n = { ...e }; delete n[v.id]; return n; }); qc.invalidateQueries({ queryKey: ['property-console', propertyId] }); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save salary'),
  });

  if (isLoading || !data) return <div className="bg-card rounded-xl border border-border p-10 text-center text-secondary text-sm">Loading…</div>;

  const { budget, totals, byDepartment, employees } = data;

  return (
    <div className="space-y-5">
      {/* Headline metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={<Wallet size={16} />} label="Total Manpower Budget" value={inr(budget.sanctioned_budget_monthly)} sub={`${inr(budget.remaining)} remaining`} danger={budget.committed > budget.sanctioned_budget_monthly} />
        <Kpi icon={<Users size={16} />} label="Sanctioned Employee Count" value={String(budget.sanctioned_headcount)} sub={`${budget.filled} filled`} />
        <Kpi icon={<IndianRupee size={16} />} label="Total Spend (all depts)" value={inr(totals.total_spend)} sub={`${totals.worker_count} workers`} />
        <Kpi icon={<TrendingUp size={16} />} label="Avg Salary / Worker" value={inr(totals.avg_salary)} />
      </div>

      {totals.on_pip > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 text-sm text-amber-800">
          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 border border-amber-200">PIP</span>
          <span><b>{totals.on_pip}</b> employee{totals.on_pip > 1 ? 's are' : ' is'} on PIP — HR can hire a backup for each while they remain on payroll.</span>
        </div>
      )}

      {/* Workers & spend per department */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-3 border-b border-border"><h3 className="text-sm font-semibold text-foreground">Departments</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-secondary">
              <tr className="text-left">
                <th className="px-5 py-2.5 font-medium">Department</th>
                <th className="px-5 py-2.5 font-medium text-right">No. of Workers</th>
                <th className="px-5 py-2.5 font-medium text-right">Total Spend</th>
                <th className="px-5 py-2.5 font-medium text-right">Avg Salary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {byDepartment.length === 0 ? (
                <tr><td colSpan={4} className="px-5 py-6 text-center text-secondary">No workers at this property.</td></tr>
              ) : byDepartment.map((d: any) => (
                <tr key={d.dept_name} className="hover:bg-muted/30">
                  <td className="px-5 py-2.5 font-medium text-foreground">{d.dept_name}</td>
                  <td className="px-5 py-2.5 text-right">{d.worker_count}</td>
                  <td className="px-5 py-2.5 text-right">{inr(d.spend)}</td>
                  <td className="px-5 py-2.5 text-right">{inr(d.avg_salary)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                <td className="px-5 py-2.5 text-foreground">All departments</td>
                <td className="px-5 py-2.5 text-right">{totals.worker_count}</td>
                <td className="px-5 py-2.5 text-right">{inr(totals.total_spend)}</td>
                <td className="px-5 py-2.5 text-right">{inr(totals.avg_salary)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Employees — adjust salary + status */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-3 border-b border-border"><h3 className="text-sm font-semibold text-foreground">Employees ({employees.length})</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-secondary">
              <tr className="text-left">
                <th className="px-5 py-2.5 font-medium">Employee</th>
                <th className="px-5 py-2.5 font-medium">Department</th>
                <th className="px-5 py-2.5 font-medium">Designation</th>
                <th className="px-5 py-2.5 font-medium">Salary (monthly)</th>
                <th className="px-5 py-2.5 font-medium">Status</th>
                <th className="px-5 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {employees.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-6 text-center text-secondary">No employees at this property.</td></tr>
              ) : employees.map((e: any) => {
                const edited = salaryEdits[e.id];
                const val = edited != null ? edited : (e.monthly_ctc != null ? String(e.monthly_ctc) : '');
                const meta = STATUS_META[e.employment_status] || STATUS_META.active;
                return (
                  <tr key={e.id} className="hover:bg-muted/30">
                    <td className="px-5 py-2.5">
                      <div className="font-medium text-foreground">{e.name}</div>
                      <div className="text-[11px] text-secondary">{e.employee_code}</div>
                    </td>
                    <td className="px-5 py-2.5 text-secondary">{e.dept_name}</td>
                    <td className="px-5 py-2.5 text-secondary">{e.job_title || '—'}</td>
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <input type="number" min="0" value={val}
                          onChange={ev => setSalaryEdits(s => ({ ...s, [e.id]: ev.target.value }))}
                          placeholder="—"
                          className="w-28 px-2 py-1 border border-border rounded-lg bg-background text-sm" />
                        <button
                          disabled={edited == null || saveSalary.isPending}
                          onClick={() => saveSalary.mutate({ id: e.id, monthly_ctc: val })}
                          className="p-1.5 rounded-lg text-primary hover:bg-primary/5 disabled:opacity-30" title="Save salary">
                          <Save size={14} />
                        </button>
                      </div>
                    </td>
                    <td className="px-5 py-2.5">
                      <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium border ${meta.cls}`}>{meta.label}</span>
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <button onClick={() => setStatusTarget(e)} className="px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/5 rounded-lg">Change status</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {statusTarget && (
        <StatusDialog employee={statusTarget} onClose={() => setStatusTarget(null)}
          onSaved={() => { setStatusTarget(null); qc.invalidateQueries({ queryKey: ['property-console', propertyId] }); }} />
      )}
    </div>
  );
}

function StatusDialog({ employee, onClose, onSaved }: { employee: any; onClose: () => void; onSaved: () => void }) {
  const [status, setStatus] = useState(employee.employment_status);
  const [lwd, setLwd] = useState(employee.last_working_day || '');
  const [pipStart, setPipStart] = useState('');
  const [pipEnd, setPipEnd] = useState('');
  const [reason, setReason] = useState('');

  const save = useMutation({
    mutationFn: () => api.put(`/manpower/employees/${employee.id}/status`, {
      status, reason, last_working_day: lwd || undefined, pip_start_date: pipStart || undefined, pip_end_date: pipEnd || undefined,
    }),
    onSuccess: () => { toast.success('Status updated'); onSaved(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-card rounded-xl border border-border w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <h3 className="font-semibold text-foreground">Change status — {employee.name}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="flex flex-wrap gap-2">
            {STATUS_OPTIONS.map(s => (
              <button key={s.value} onClick={() => setStatus(s.value)}
                className={`px-3 py-1.5 rounded-lg text-sm border ${status === s.value ? (STATUS_META[s.value]?.cls || '') + ' border-current' : 'border-border hover:bg-muted'}`}>
                {s.label}
              </button>
            ))}
          </div>
          {status === 'pip' && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="block text-xs text-secondary mb-1">PIP start *</span>
                <input type="date" value={pipStart} onChange={e => setPipStart(e.target.value)} className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm" /></label>
              <label className="block"><span className="block text-xs text-secondary mb-1">PIP end *</span>
                <input type="date" value={pipEnd} onChange={e => setPipEnd(e.target.value)} className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm" /></label>
            </div>
          )}
          {(status === 'on_notice' || status === 'left') && (
            <label className="block"><span className="block text-xs text-secondary mb-1">Last working day *</span>
              <input type="date" value={lwd} onChange={e => setLwd(e.target.value)} className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm" /></label>
          )}
          {status === 'left' && <p className="text-xs text-secondary">Marking Inactive frees the headcount slot and budget for this property.</p>}
          <label className="block"><span className="block text-xs text-secondary mb-1">Reason / note</span>
            <input value={reason} onChange={e => setReason(e.target.value)} className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm" /></label>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-3 py-2 border border-border rounded-lg text-sm hover:bg-muted">Cancel</button>
            <button onClick={() => save.mutate()} disabled={save.isPending} className="px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">{save.isPending ? 'Saving…' : 'Update status'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, sub, danger }: { icon: React.ReactNode; label: string; value: string; sub?: string; danger?: boolean }) {
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center gap-1.5 text-secondary text-[11px] uppercase tracking-wide">{icon}<span className="truncate">{label}</span></div>
      <p className={`text-2xl font-bold mt-1.5 ${danger ? 'text-red-600' : 'text-foreground'}`}>{value}</p>
      {sub && <p className="text-xs text-secondary mt-0.5">{sub}</p>}
    </div>
  );
}
