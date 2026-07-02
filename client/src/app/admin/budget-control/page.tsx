'use client';

import { useState, useMemo, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import LoadError from '@/components/ui/LoadError';
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning';
import Breadcrumb from '@/components/ui/Breadcrumb';
import { Wallet, Save, IndianRupee, Users, UserCheck, UserPlus, ChevronDown, ChevronRight } from 'lucide-react';

const inr = (n: number) => '₹' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0));

export default function BudgetControlPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [cluster, setCluster] = useState('');
  const [edits, setEdits] = useState<Record<number, { budget: string; head: string }>>({});
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data: rows = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['budget-control'],
    queryFn: () => api.get('/manpower/property-budgets').then(r => r.data),
  });
  const { data: clusters = [] } = useQuery({
    queryKey: ['mp-clusters'],
    queryFn: () => api.get('/manpower/clusters').then(r => r.data).catch(() => []),
  });

  const save = useMutation({
    mutationFn: ({ id, budget, head }: any) => api.post(`/manpower/property-budgets/${id}`, { sanctioned_budget_monthly: Number(budget), sanctioned_headcount: Number(head) }),
    onSuccess: (_d, v: any) => { toast.success('Budget saved'); setEdits(e => { const n = { ...e }; delete n[v.id]; return n; }); qc.invalidateQueries({ queryKey: ['budget-control'] }); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save'),
  });

  useUnsavedChangesWarning(Object.keys(edits).length > 0);

  const clusterNames = useMemo(() => Array.from(new Set(rows.map((r: any) => r.cluster_name).filter(Boolean))).sort(), [rows]);
  const filtered = rows.filter((r: any) => !cluster || r.cluster_name === cluster);

  // Effective (edited-but-unsaved values count live) → totals recompute as you type.
  const eff = (r: any) => {
    const e = edits[r.property_id];
    return {
      budget: Number(e ? e.budget : r.sanctioned_budget_monthly) || 0,
      head: Number(e ? e.head : r.sanctioned_headcount) || 0,
      filled: Number(r.filled_headcount) || 0,
      committed: Number(r.committed_amount) || 0,
    };
  };
  const totals = filtered.reduce((a: any, r: any) => {
    const v = eff(r); a.budget += v.budget; a.head += v.head; a.filled += v.filled; a.committed += v.committed; return a;
  }, { budget: 0, head: 0, filled: 0, committed: 0 });

  const val = (r: any, field: 'budget' | 'head') => {
    const e = edits[r.property_id];
    if (e) return e[field];
    return String(field === 'budget' ? r.sanctioned_budget_monthly : r.sanctioned_headcount);
  };
  const setVal = (r: any, field: 'budget' | 'head', v: string) => {
    setEdits(prev => ({
      ...prev,
      [r.property_id]: {
        budget: field === 'budget' ? v : (prev[r.property_id]?.budget ?? String(r.sanctioned_budget_monthly)),
        head: field === 'head' ? v : (prev[r.property_id]?.head ?? String(r.sanctioned_headcount)),
      },
    }));
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <Breadcrumb items={[{ label: 'Admin', href: '/admin' }, { label: 'Budget Control' }]} />
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><Wallet className="text-primary" size={20} /></div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Budget Control</h1>
            <p className="text-secondary text-sm">Set the sanctioned monthly budget (CTC) and headcount per property. These cap hiring across all roles.</p>
          </div>
        </div>

        {/* Live metrics — recompute as soon as any value is edited */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <Metric icon={<IndianRupee size={16} />} label="Total Sanctioned Amount" value={inr(totals.budget)} sub="monthly CTC, all properties" />
          <Metric icon={<Users size={16} />} label="Total Sanctioned Headcount" value={String(totals.head)} sub={`${filtered.length} properties`} />
          <Metric icon={<UserCheck size={16} />} label="Positions Filled" value={String(totals.filled)} sub={`${filtered.length} properties`} />
          <Metric icon={<UserPlus size={16} />} label="Open Slots" value={String(Math.max(0, totals.head - totals.filled))} sub="sanctioned − filled" />
          <Metric icon={<Wallet size={16} />} label="Remaining Budget" value={inr(totals.budget - totals.committed)} danger={totals.committed > totals.budget} sub={`${inr(totals.committed)} committed`} />
        </div>

        <div className="flex items-center gap-2">
          <select value={cluster} onChange={e => setCluster(e.target.value)} className="px-3 py-2 border border-border rounded-lg bg-background text-sm">
            <option value="">All clusters</option>
            {clusterNames.map((c: any) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-secondary">
                <tr className="text-left">
                  <th className="px-4 py-2.5 font-medium">Property</th>
                  <th className="px-4 py-2.5 font-medium">Sanctioned Budget (monthly CTC)</th>
                  <th className="px-4 py-2.5 font-medium">Sanctioned Headcount</th>
                  <th className="px-4 py-2.5 font-medium">Positions Filled</th>
                  <th className="px-4 py-2.5 font-medium">Committed</th>
                  <th className="px-4 py-2.5 font-medium text-right">Save</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-secondary">Loading…</td></tr>
                ) : isError ? (
                  <tr><td colSpan={6}><LoadError compact message="Couldn't load budgets." onRetry={() => refetch()} /></td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-secondary">No properties.</td></tr>
                ) : filtered.map((r: any) => {
                  const dirty = !!edits[r.property_id];
                  const isOpen = expanded === r.property_id;
                  return (
                    <Fragment key={r.property_id}>
                    <tr className="hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <button onClick={() => setExpanded(isOpen ? null : r.property_id)} title="Salary bands" className="align-middle mr-1.5 p-0.5 rounded hover:bg-muted">
                          {isOpen ? <ChevronDown size={14} className="text-secondary inline" /> : <ChevronRight size={14} className="text-secondary inline" />}
                        </button>
                        <div className="font-medium text-foreground">{r.property_name}</div>
                        <div className="text-[11px] text-secondary">{r.cluster_name || 'Unassigned'} · {r.source === 'explicit' ? 'explicit' : 'rolled-up from roles'}</div>
                      </td>
                      <td className="px-4 py-3">
                        <input type="number" min="0" value={val(r, 'budget')} onChange={e => setVal(r, 'budget', e.target.value)}
                          className="w-40 px-3 py-1.5 border border-border rounded-lg bg-background text-sm" />
                      </td>
                      <td className="px-4 py-3">
                        <input type="number" min="0" value={val(r, 'head')} onChange={e => setVal(r, 'head', e.target.value)}
                          className="w-28 px-3 py-1.5 border border-border rounded-lg bg-background text-sm" />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={r.over_headcount ? 'text-red-600 font-medium' : 'text-foreground'}>{r.filled_headcount}</span>
                        <span className="text-secondary"> / {val(r, 'head')} · {Math.max(0, Number(val(r, 'head')) - r.filled_headcount)} open</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={r.over_budget ? 'text-red-600 font-medium' : 'text-foreground'}>{inr(r.committed_amount)}</span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {dirty && <span className="mr-2 text-[11px] font-medium text-amber-600">Unsaved</span>}
                        <button
                          onClick={() => save.mutate({ id: r.property_id, budget: val(r, 'budget'), head: val(r, 'head') })}
                          disabled={!dirty || save.isPending}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-40"
                        >
                          <Save size={13} /> Save
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={6} className="bg-muted/20 px-4 py-3 space-y-4">
                          <PropertyDeptCounts propertyId={r.property_id} />
                          <PropertyBands propertyId={r.property_id} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <p className="text-xs text-secondary">Headcount is cumulative across all roles at the property. Per-role salary bands are set in Manpower &amp; Budget Control.</p>
      </div>
    </AppShell>
  );
}

// Per-department sanctioned employee count — the same figure editable in Property Configuration.
function PropertyDeptCounts({ propertyId }: { propertyId: number }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['bc-console', propertyId],
    queryFn: () => api.get(`/manpower/property-console?property_id=${propertyId}`).then(r => r.data),
  });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: ({ department, worker_count }: any) => api.put('/manpower/property-console/department-workers', { property_id: propertyId, department, worker_count: Number(worker_count) }),
    onSuccess: (_d, v: any) => { toast.success('Employees per department saved'); setEdits(e => { const n = { ...e }; delete n[v.department]; return n; }); qc.invalidateQueries({ queryKey: ['bc-console', propertyId] }); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save'),
  });

  const deptDirty = Object.keys(edits).length > 0;
  useUnsavedChangesWarning(deptDirty);

  if (isLoading || !data) return <p className="text-xs text-secondary">Loading departments…</p>;
  const depts: any[] = data.byDepartment || [];

  return (
    <div className="space-y-2">
      <p className="text-[11px] uppercase tracking-wide text-secondary">
        No. of employees by department (sanctioned)
        {deptDirty && <span className="ml-2 normal-case tracking-normal font-medium text-amber-600">· Unsaved changes</span>}
      </p>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-border/60">
          {depts.length === 0 && <tr><td className="py-2 text-secondary text-xs">No departments.</td></tr>}
          {depts.map((d) => {
            const edited = edits[d.dept_name];
            const val = edited != null ? edited : String(d.sanctioned_workers ?? 0);
            return (
              <tr key={d.dept_name}>
                <td className="py-2 pr-3 font-medium text-foreground">{d.dept_name}</td>
                <td className="py-2 pr-3 text-secondary text-xs">{d.actual_workers} hired</td>
                <td className="py-2 pr-2">
                  <input type="number" min="0" value={val} onChange={ev => setEdits(p => ({ ...p, [d.dept_name]: ev.target.value }))}
                    className="w-24 px-2 py-1 border border-border rounded-lg bg-background text-sm" />
                </td>
                <td className="py-2 text-right">
                  <button disabled={edited == null || save.isPending}
                    onClick={() => save.mutate({ department: d.dept_name, worker_count: val })}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-primary text-white rounded-lg text-xs font-medium disabled:opacity-40"><Save size={12} /> Save</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Per-property salary-band editor (moved here from the Manpower module).
function PropertyBands({ propertyId }: { propertyId: number }) {
  const qc = useQueryClient();
  const { data: roles = [], isLoading } = useQuery({
    queryKey: ['bc-sanctions', propertyId],
    queryFn: () => api.get(`/manpower/sanctions?property_id=${propertyId}`).then(r => r.data),
  });
  const { data: jobTitles = [] } = useQuery({
    queryKey: ['bc-jobtitles'], queryFn: () => api.get('/recruitment/job-titles').then(r => r.data).catch(() => []),
  });
  const [edits, setEdits] = useState<Record<number, { min: string; max: string }>>({});
  const [add, setAdd] = useState({ job_title_id: '', min: '', max: '' });

  const saveBand = useMutation({
    mutationFn: (b: any) => api.put('/manpower/sanctions/band', b),
    onSuccess: () => {
      toast.success('Salary band saved');
      qc.invalidateQueries({ queryKey: ['bc-sanctions', propertyId] });
      qc.invalidateQueries({ queryKey: ['budget-control'] });
      setEdits({}); setAdd({ job_title_id: '', min: '', max: '' });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const bandedIds = new Set(roles.map((r: any) => r.job_title_id));
  const addable = jobTitles.filter((j: any) => !bandedIds.has(j.id));
  const bandsDirty = Object.keys(edits).length > 0 || !!add.job_title_id || !!add.min || !!add.max;
  useUnsavedChangesWarning(bandsDirty);
  if (isLoading) return <p className="text-xs text-secondary">Loading salary bands…</p>;

  return (
    <div className="space-y-2">
      <p className="text-[11px] uppercase tracking-wide text-secondary">
        Salary bands (monthly CTC) by role
        {bandsDirty && <span className="ml-2 normal-case tracking-normal font-medium text-amber-600">· Unsaved changes</span>}
      </p>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-border/60">
          {roles.length === 0 && <tr><td className="py-2 text-secondary text-xs">No role bands yet — add one below.</td></tr>}
          {roles.map((r: any) => {
            const e = edits[r.id];
            const min = e ? e.min : String(r.band_min);
            const max = e ? e.max : String(r.band_max);
            return (
              <tr key={r.id}>
                <td className="py-2 pr-3 font-medium text-foreground">{r.job_title}</td>
                <td className="py-2 pr-2"><input type="number" min="0" value={min} onChange={ev => setEdits(p => ({ ...p, [r.id]: { min: ev.target.value, max: p[r.id]?.max ?? String(r.band_max) } }))} className="w-28 px-2 py-1 border border-border rounded-lg bg-background text-sm" placeholder="min" /></td>
                <td className="py-2 pr-2"><input type="number" min="0" value={max} onChange={ev => setEdits(p => ({ ...p, [r.id]: { min: p[r.id]?.min ?? String(r.band_min), max: ev.target.value } }))} className="w-28 px-2 py-1 border border-border rounded-lg bg-background text-sm" placeholder="max" /></td>
                <td className="py-2 text-right">
                  <button disabled={!e || saveBand.isPending} onClick={() => saveBand.mutate({ property_id: propertyId, job_title_id: r.job_title_id, band_min: Number(min), band_max: Number(max) })}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-primary text-white rounded-lg text-xs font-medium disabled:opacity-40"><Save size={12} /> Save</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {addable.length > 0 && (
        <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-border/60">
          <label className="block"><span className="block text-xs text-secondary mb-1">Add role band</span>
            <select value={add.job_title_id} onChange={e => setAdd(a => ({ ...a, job_title_id: e.target.value }))} className="px-2 py-1 border border-border rounded-lg bg-background text-sm">
              <option value="">Select role</option>
              {addable.map((j: any) => <option key={j.id} value={j.id}>{j.title}</option>)}
            </select>
          </label>
          <input type="number" min="0" placeholder="Band min" value={add.min} onChange={e => setAdd(a => ({ ...a, min: e.target.value }))} className="w-28 px-2 py-1 border border-border rounded-lg bg-background text-sm" />
          <input type="number" min="0" placeholder="Band max" value={add.max} onChange={e => setAdd(a => ({ ...a, max: e.target.value }))} className="w-28 px-2 py-1 border border-border rounded-lg bg-background text-sm" />
          <button disabled={!add.job_title_id || !add.min || !add.max || saveBand.isPending}
            onClick={() => saveBand.mutate({ property_id: propertyId, job_title_id: Number(add.job_title_id), band_min: Number(add.min), band_max: Number(add.max) })}
            className="px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium disabled:opacity-40">Add band</button>
        </div>
      )}
    </div>
  );
}

function Metric({ icon, label, value, sub, danger }: { icon: React.ReactNode; label: string; value: string; sub?: string; danger?: boolean }) {
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center gap-1.5 text-secondary text-[11px] uppercase tracking-wide">{icon}<span className="truncate">{label}</span></div>
      <p className={`text-2xl font-bold mt-1.5 ${danger ? 'text-red-600' : 'text-foreground'}`}>{value}</p>
      {sub && <p className="text-xs text-secondary mt-0.5">{sub}</p>}
    </div>
  );
}
