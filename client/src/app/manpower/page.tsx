'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import Link from 'next/link';
import { ShieldCheck, X, AlertTriangle, UserPlus } from 'lucide-react';
import LoadError from '@/components/ui/LoadError';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';

const inr = (n: number) => '₹' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0));

const STATUS_META: Record<string, { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'bg-green-100 text-green-700 border-green-200' },
  pip: { label: 'PIP', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  on_notice: { label: 'On Notice', cls: 'bg-orange-100 text-orange-700 border-orange-200' },
  left: { label: 'Left', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
};

function StatusChip({ status }: { status: string }) {
  const m = STATUS_META[status] || STATUS_META.active;
  return <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium border ${m.cls}`}>{m.label}</span>;
}

function Gauge({ committed, sanctioned }: { committed: number; sanctioned: number }) {
  const pct = sanctioned > 0 ? (committed / sanctioned) * 100 : 0;
  const over = committed > sanctioned;
  const color = over ? 'bg-red-500' : pct > 85 ? 'bg-amber-500' : 'bg-green-500';
  return (
    <div className="w-full">
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <p className={`text-[11px] mt-1 ${over ? 'text-red-600 font-medium' : 'text-secondary'}`}>
        {inr(committed)} / {inr(sanctioned)} · {pct.toFixed(0)}%{over ? ' · OVER' : ''}
      </p>
    </div>
  );
}

export default function ManpowerPage() {
  const tabs = [
    { key: 'budget', label: 'Budget' },
    { key: 'status', label: 'Employees & Status' },
    { key: 'replacements', label: 'Replacements' },
  ];
  const [tab, setTab] = useState('budget');

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <ShieldCheck className="text-primary" size={20} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Manpower &amp; Budget Control</h1>
            <p className="text-secondary text-sm">Sanctioned headcount, budget, and salary bands per property &amp; role.</p>
          </div>
        </div>

        <div className="flex gap-1 border-b border-border overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                tab === t.key ? 'border-primary text-primary' : 'border-transparent text-secondary hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'budget' && <BudgetTab />}
        {tab === 'status' && <StatusTab />}
        {tab === 'replacements' && <ReplacementsTab />}
      </div>
    </AppShell>
  );
}

// ─────────────────────────── Budget (property-wise) ───────────────────────────

function BudgetTab() {
  const [cluster, setCluster] = useState('');
  const [search, setSearch] = useState('');

  const { data: rows = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['mp-property-budgets'],
    queryFn: () => api.get('/manpower/property-budgets').then(r => r.data),
  });

  const clusterNames = useMemo(() => Array.from(new Set(rows.map((r: any) => r.cluster_name).filter(Boolean))).sort(), [rows]);
  const filtered = rows.filter((r: any) =>
    (!cluster || r.cluster_name === cluster) &&
    (!search || r.property_name.toLowerCase().includes(search.toLowerCase())));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search property" className="px-3 py-2 border border-border rounded-lg bg-background text-sm w-56" />
        <Select value={cluster} onChange={setCluster} placeholder="All clusters" options={clusterNames as string[]} />
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-secondary">
              <tr className="text-left">
                <th className="px-4 py-2.5 font-medium">Property Name</th>
                <th className="px-4 py-2.5 font-medium">HeadCount</th>
                <th className="px-4 py-2.5 font-medium w-72">Budget Utilised</th>
                <th className="px-4 py-2.5 font-medium text-right">Roles</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-secondary">Loading…</td></tr>
              ) : isError ? (
                <tr><td colSpan={4}><LoadError compact message="Couldn't load properties." onRetry={() => refetch()} /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-secondary">No properties.</td></tr>
              ) : filtered.map((r: any) => (
                <PropertyRow key={r.property_id} r={r} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-secondary">One row per property — headcount is cumulative across all roles. Budget &amp; headcount caps are set in Admin → Budget Control.</p>
    </div>
  );
}

function PropertyRow({ r }: { r: any }) {
  return (
    <tr className="hover:bg-muted/30">
      <td className="px-4 py-3">
        <div className="font-medium text-foreground">{r.property_name}</div>
        <div className="text-[11px] text-secondary">{r.cluster_name || 'Unassigned'}{r.source === 'rolled_up' ? ' · rolled-up' : ''}</div>
      </td>
      <td className="px-4 py-3">
        <span className={r.over_headcount ? 'text-red-600 font-medium' : ''}>{r.filled_headcount}/{r.sanctioned_headcount}</span>
        <div className="text-[11px] text-secondary">{r.remaining_slots} open</div>
      </td>
      <td className="px-4 py-3"><Gauge committed={Number(r.committed_amount)} sanctioned={Number(r.sanctioned_budget_monthly)} /></td>
      <td className="px-4 py-3 text-right text-secondary">{r.role_lines}</td>
    </tr>
  );
}

// ─────────────────────────── Employees & Status ───────────────────────────

function StatusTab() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [target, setTarget] = useState<any | null>(null);

  const { data: employees = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['mp-employees', status, debouncedSearch],
    queryFn: () => api.get(`/manpower/employees?${status ? `status=${status}&` : ''}${debouncedSearch ? `search=${encodeURIComponent(debouncedSearch)}` : ''}`).then(r => r.data),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name / code" className="px-3 py-2 border border-border rounded-lg bg-background text-sm w-56" />
        <Select value={status} onChange={setStatus} placeholder="All statuses" options={['active', 'pip', 'on_notice', 'left']} labels={{ active: 'Active', pip: 'PIP', on_notice: 'On Notice', left: 'Left' }} />
      </div>
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-secondary">
              <tr className="text-left">
                <th className="px-4 py-2.5 font-medium">Employee</th>
                <th className="px-4 py-2.5 font-medium">Property</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 font-medium">Monthly CTC</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Last working day</th>
                <th className="px-4 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-secondary">Loading…</td></tr>
              ) : isError ? (
                <tr><td colSpan={7}><LoadError compact message="Couldn't load employees." onRetry={() => refetch()} /></td></tr>
              ) : employees.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-secondary">No employees.</td></tr>
              ) : employees.map((e: any) => (
                <tr key={e.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{e.first_name} {e.last_name}</div>
                    <div className="text-[11px] text-secondary">{e.job_id ? `${e.job_id} · ` : ''}{e.employee_code}</div>
                  </td>
                  <td className="px-4 py-3">{e.branch_name}</td>
                  <td className="px-4 py-3">{e.job_title || '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{e.monthly_ctc ? inr(e.monthly_ctc) : '—'}{Number(e.sanction_variance) > 0 && <span className="ml-1 text-[11px] text-red-600">+{inr(e.sanction_variance)}</span>}</td>
                  <td className="px-4 py-3"><StatusChip status={e.employment_status} />{e.open_to_backfill ? <span className="ml-1 text-[11px] text-orange-600">backfill</span> : null}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-secondary">{e.last_working_day || '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setTarget(e)} className="px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/5 rounded-lg">Change status</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {target && <StatusDialog employee={target} onClose={() => setTarget(null)} onSaved={() => { setTarget(null); qc.invalidateQueries({ queryKey: ['mp-employees'] }); qc.invalidateQueries({ queryKey: ['mp-sanctions'] }); }} />}
    </div>
  );
}

// ─────────────────────────── Replacements (PIP / Left → backfill) ───────────────────────────

function ReplacementsTab() {
  const { data: rows = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['mp-replacements'],
    queryFn: () => api.get('/manpower/replacements').then(r => r.data),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 text-sm text-amber-800">
        <AlertTriangle size={16} className="text-amber-600 shrink-0" />
        <span>These JOBs are on PIP or have left and are open to backfill. Raise a vacancy mapped to the JOB ID to hire a replacement.</span>
      </div>
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-secondary">
              <tr className="text-left">
                <th className="px-4 py-2.5 font-medium">JOB ID</th>
                <th className="px-4 py-2.5 font-medium">Employee</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 font-medium">Property</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Last working day</th>
                <th className="px-4 py-2.5 font-medium text-right">Backfill</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-secondary">Loading…</td></tr>
              ) : isError ? (
                <tr><td colSpan={7}><LoadError compact message="Couldn't load replacements." onRetry={() => refetch()} /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-secondary">No open replacements — every JOB is filled.</td></tr>
              ) : rows.map((r: any) => (
                <tr key={r.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono text-xs text-foreground whitespace-nowrap">{r.job_id || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{r.name}</div>
                    <div className="text-[11px] text-secondary">{r.employee_code}</div>
                  </td>
                  <td className="px-4 py-3">{r.job_title || '—'}</td>
                  <td className="px-4 py-3">{r.branch_name}</td>
                  <td className="px-4 py-3"><StatusChip status={r.employment_status} /></td>
                  <td className="px-4 py-3 whitespace-nowrap text-secondary">{r.last_working_day || '—'}</td>
                  <td className="px-4 py-3 text-right">
                    {r.backfill_vacancy_open ? (
                      <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 border border-green-200">Vacancy raised</span>
                    ) : r.job_id ? (
                      <Link href={`/recruitment/vacancies/new?backfill_job_id=${encodeURIComponent(r.job_id)}`} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/5 rounded-lg"><UserPlus size={13} /> Raise vacancy</Link>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatusDialog({ employee, onClose, onSaved }: { employee: any; onClose: () => void; onSaved: () => void }) {
  const [status, setStatus] = useState(employee.employment_status);
  const [reason, setReason] = useState('');
  const [lwd, setLwd] = useState(employee.last_working_day || '');
  const [pipStart, setPipStart] = useState(employee.pip_start_date || '');
  const [pipEnd, setPipEnd] = useState(employee.pip_end_date || '');

  const save = useMutation({
    mutationFn: () => api.put(`/manpower/employees/${employee.id}/status`, {
      status, reason, last_working_day: lwd || undefined, pip_start_date: pipStart || undefined, pip_end_date: pipEnd || undefined,
    }),
    onSuccess: () => { toast.success('Status updated'); onSaved(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  return (
    <Modal title={`Change status — ${employee.first_name} ${employee.last_name}`} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Status">
          <div className="flex flex-wrap gap-2">
            {(['active', 'pip', 'on_notice', 'left'] as const).map(s => (
              <button key={s} onClick={() => setStatus(s)} className={`px-3 py-1.5 rounded-lg text-sm border ${status === s ? STATUS_META[s].cls + ' border-current' : 'border-border hover:bg-muted'}`}>{STATUS_META[s].label}</button>
            ))}
          </div>
        </Field>
        {status === 'pip' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="PIP start *"><input type="date" value={pipStart} onChange={e => setPipStart(e.target.value)} className={inputCls} /></Field>
            <Field label="PIP end *"><input type="date" value={pipEnd} onChange={e => setPipEnd(e.target.value)} className={inputCls} /></Field>
          </div>
        )}
        {(status === 'on_notice' || status === 'left') && (
          <Field label="Last working day *"><input type="date" value={lwd} onChange={e => setLwd(e.target.value)} className={inputCls} /></Field>
        )}
        {status === 'left' && <p className="text-xs text-secondary">Marking as Left frees the headcount slot and budget, and flags the position open to backfill.</p>}
        <Field label="Reason / note"><input value={reason} onChange={e => setReason(e.target.value)} className={inputCls} /></Field>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 py-2 border border-border rounded-lg text-sm hover:bg-muted">Cancel</button>
          <button onClick={() => save.mutate()} disabled={save.isPending} className="px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">{save.isPending ? 'Saving…' : 'Update status'}</button>
        </div>
      </div>
    </Modal>
  );
}

// ─────────────────────────────── Shared bits ───────────────────────────────

const inputCls = 'w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block text-xs font-medium text-secondary mb-1">{label}</span>{children}</label>;
}

function Select({ value, onChange, placeholder, options, labels }: { value: string; onChange: (v: string) => void; placeholder: string; options: string[]; labels?: Record<string, string> }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="px-3 py-2 border border-border rounded-lg bg-background text-sm">
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o} value={o}>{labels?.[o] || o}</option>)}
    </select>
  );
}


function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-card rounded-xl border border-border w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <h3 className="font-semibold text-foreground">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted"><X size={18} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
