'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, Cell,
} from 'recharts';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import LoadError from '@/components/ui/LoadError';
import { formatINR, formatINRShort } from '@/lib/utils';
import {
  Building2, IndianRupee, Users, TrendingDown, AlertTriangle, RefreshCw, UserMinus,
} from 'lucide-react';


export default function PropertyAnalyticsPage() {
  const [clusterId, setClusterId] = useState('');
  const [propertyId, setPropertyId] = useState('');

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (clusterId) p.set('cluster_id', clusterId);
    if (propertyId) p.set('property_id', propertyId);
    const s = p.toString();
    return s ? `?${s}` : '';
  }, [clusterId, propertyId]);

  const { data: clusters = [] } = useQuery({ queryKey: ['pa-clusters'], queryFn: () => api.get('/manpower/clusters').then(r => r.data).catch(() => []) });
  const { data: budget, isError: budgetError, refetch: refetchBudget } = useQuery({ queryKey: ['pa-budget', qs], queryFn: () => api.get(`/property-analytics/budget${qs}`).then(r => r.data) });
  const { data: headcount = [] } = useQuery({ queryKey: ['pa-headcount', qs], queryFn: () => api.get(`/property-analytics/headcount${qs}`).then(r => r.data) });
  const { data: variance } = useQuery({ queryKey: ['pa-variance', qs], queryFn: () => api.get(`/property-analytics/salary-variance${qs}`).then(r => r.data) });
  const { data: attrition } = useQuery({ queryKey: ['pa-attrition', qs], queryFn: () => api.get(`/property-analytics/attrition${qs}`).then(r => r.data) });
  const { data: backfill } = useQuery({ queryKey: ['pa-backfill', qs], queryFn: () => api.get(`/property-analytics/backfill${qs}`).then(r => r.data) });
  const { data: exceptions } = useQuery({ queryKey: ['pa-exceptions', qs], queryFn: () => api.get(`/property-analytics/exceptions${qs}`).then(r => r.data) });

  const t = budget?.totals;
  const propertiesForCluster = useMemo(() => {
    const all = clusters.flatMap((c: any) => (c.properties || []).map((p: any) => ({ ...p, cluster_id: c.id })));
    return clusterId ? all.filter((p: any) => String(p.cluster_id) === clusterId) : all;
  }, [clusters, clusterId]);

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><Building2 className="text-primary" size={20} /></div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Property Analytics</h1>
              <p className="text-secondary text-sm">Sanctioned vs committed budget &amp; headcount, salary variance, attrition.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <select value={clusterId} onChange={e => { setClusterId(e.target.value); setPropertyId(''); }} className="px-3 py-2 border border-border rounded-lg bg-background text-sm">
              <option value="">All clusters</option>
              {clusters.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={propertyId} onChange={e => setPropertyId(e.target.value)} className="px-3 py-2 border border-border rounded-lg bg-background text-sm">
              <option value="">All properties</option>
              {propertiesForCluster.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>

        {budgetError && (
          <div className="bg-card rounded-xl border border-border">
            <LoadError message="Couldn't load property analytics — figures below may be missing." onRetry={() => refetchBudget()} />
          </div>
        )}

        {/* KPI strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi icon={<IndianRupee size={16} />} label="Manpower Amount Sanctioned" value={formatINR(t?.sanctioned_amount || 0)} sub="monthly CTC" />
          <Kpi icon={<TrendingDown size={16} />} label="Committed" value={formatINR(t?.committed_amount || 0)} sub={`${t?.utilization_pct || 0}% utilised`} danger={t?.over_budget} />
          <Kpi icon={<IndianRupee size={16} />} label="Remaining Budget" value={formatINR(t?.remaining_amount || 0)} danger={(t?.remaining_amount || 0) < 0} />
          <Kpi icon={<Users size={16} />} label="Count of Manpower Sanctioned" value={String(t?.sanctioned_headcount || 0)} sub={`${t?.filled || 0} filled · ${t?.open || 0} open`} />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi icon={<UserMinus size={16} />} label="Attrition (12 mo)" value={`${attrition?.attrition_rate_pct || 0}%`} sub={`${attrition?.left_count || 0} exits`} />
          <Kpi icon={<AlertTriangle size={16} />} label="Short-notice exits" value={String(attrition?.short_notice_count || 0)} sub={`avg tenure ${attrition?.avg_tenure_months || 0} mo`} />
          <Kpi icon={<AlertTriangle size={16} />} label="Salary variance (over band)" value={formatINR(variance?.total_variance || 0)} sub={`${variance?.count || 0} hire(s)`} danger={(variance?.total_variance || 0) > 0} />
          <Kpi icon={<RefreshCw size={16} />} label="Open to backfill" value={String(backfill?.open_count || 0)} sub={`avg ${backfill?.avg_days_open || 0} days open`} />
        </div>

        {/* Budget by property */}
        <Section title="Budget — sanctioned vs committed, by property">
          {budget?.byProperty?.length ? (
            <div className="space-y-3">
              {budget.byProperty.map((p: any) => (
                <div key={p.property} className="grid grid-cols-12 items-center gap-3">
                  <div className="col-span-4 lg:col-span-3 min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">{p.property}</div>
                    <div className="text-[11px] text-secondary truncate">{p.cluster}</div>
                  </div>
                  <div className="col-span-5 lg:col-span-6">
                    <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                      <div className={`h-full ${p.over_budget ? 'bg-red-500' : p.utilization_pct > 85 ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${Math.min(100, p.utilization_pct)}%` }} />
                    </div>
                  </div>
                  <div className="col-span-3 text-right text-xs">
                    <span className={p.over_budget ? 'text-red-600 font-medium' : 'text-foreground'}>{formatINRShort(p.committed_amount)}</span>
                    <span className="text-secondary"> / {formatINRShort(p.sanctioned_amount)}</span>
                    <div className="text-[11px] text-secondary">{p.filled}/{p.sanctioned_headcount} heads · {p.open} open</div>
                  </div>
                </div>
              ))}
            </div>
          ) : <Empty />}
        </Section>

        {/* Headcount by role */}
        <Section title="Headcount — sanctioned / filled / open, by role">
          {headcount.length ? (
            <ResponsiveContainer width="100%" height={Math.max(220, headcount.length * 52)}>
              <BarChart data={headcount} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
                <XAxis type="number" tick={{ fontSize: 12 }} />
                <YAxis type="category" dataKey="role" width={150} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="filled" name="Filled" stackId="a" fill="#16a34a" radius={[0, 0, 0, 0]} />
                <Bar dataKey="open" name="Open" stackId="a" fill="#cbd5e1" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </Section>

        {/* Salary variance */}
        <div className="grid lg:grid-cols-2 gap-4">
          <Section title="Salary variance — by HR (who drove it)">
            {variance?.byHr?.length ? (
              <table className="w-full text-sm">
                <thead className="text-secondary text-left"><tr><th className="py-1.5 font-medium">HR</th><th className="py-1.5 font-medium text-right">Hires</th><th className="py-1.5 font-medium text-right">Variance / mo</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {variance.byHr.map((h: any) => (
                    <tr key={h.hired_by}><td className="py-2 truncate">{h.hired_by}</td><td className="py-2 text-right">{h.count}</td><td className="py-2 text-right text-red-600 font-medium">+{formatINR(h.total_variance)}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : <Empty msg="No over-band hires — all within sanction." />}
          </Section>
          <Section title="Salary variance — by hire">
            {variance?.byHire?.length ? (
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="text-secondary text-left sticky top-0 bg-card"><tr><th className="py-1.5 font-medium">Hire</th><th className="py-1.5 font-medium text-right">CTC</th><th className="py-1.5 font-medium text-right">Over band</th></tr></thead>
                  <tbody className="divide-y divide-border">
                    {variance.byHire.map((h: any) => (
                      <tr key={h.id}>
                        <td className="py-2"><div className="font-medium text-foreground">{h.first_name} {h.last_name}</div><div className="text-[11px] text-secondary">{h.job_title} @ {h.branch_name}</div></td>
                        <td className="py-2 text-right">{formatINR(h.monthly_ctc)}</td>
                        <td className="py-2 text-right text-red-600 font-medium">+{formatINR(h.variance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty msg="No over-band hires." />}
          </Section>
        </div>

        {/* Backfill + Exceptions */}
        <div className="grid lg:grid-cols-2 gap-4">
          <Section title="Backfill — open positions (exits & PIP)">
            {backfill?.positions?.length ? (
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="text-secondary text-left sticky top-0 bg-card"><tr><th className="py-1.5 font-medium">Role / Property</th><th className="py-1.5 font-medium text-right">Days open</th></tr></thead>
                  <tbody className="divide-y divide-border">
                    {backfill.positions.map((p: any) => (
                      <tr key={p.id}><td className="py-2"><div className="font-medium text-foreground">{p.job_title}</div><div className="text-[11px] text-secondary">{p.branch_name}</div></td><td className="py-2 text-right">{p.days_open ?? '—'}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty msg="No open backfill positions." />}
          </Section>
          <Section title="Exception log">
            {exceptions ? (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <MiniStat label="Pending" value={String(exceptions.summary.pending.count)} tone="amber" />
                  <MiniStat label="Approved" value={String(exceptions.summary.approved.count)} sub={formatINR(exceptions.summary.approved.value)} tone="green" />
                  <MiniStat label="Rejected" value={String(exceptions.summary.rejected.count)} tone="gray" />
                </div>
                <div className="max-h-56 overflow-y-auto divide-y divide-border">
                  {exceptions.recent?.length ? exceptions.recent.map((x: any) => (
                    <div key={x.id} className="py-2 text-sm flex items-center justify-between gap-2">
                      <div className="min-w-0"><div className="font-medium text-foreground truncate">{x.candidate_name} · {x.job_title}</div><div className="text-[11px] text-secondary truncate">{x.property_name} · +{formatINR(x.variance_amount)}</div></div>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${x.status === 'approved' ? 'bg-green-100 text-green-700' : x.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>{x.status}</span>
                    </div>
                  )) : <p className="text-secondary text-sm py-2">No exceptions raised.</p>}
                </div>
              </div>
            ) : <Empty />}
          </Section>
        </div>
      </div>
    </AppShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <h3 className="text-sm font-semibold text-foreground mb-4">{title}</h3>
      {children}
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

function MiniStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: 'amber' | 'green' | 'gray' }) {
  const cls = tone === 'amber' ? 'bg-amber-50 text-amber-700' : tone === 'green' ? 'bg-green-50 text-green-700' : 'bg-muted text-secondary';
  return (
    <div className={`rounded-lg p-2.5 ${cls}`}>
      <p className="text-[11px] uppercase tracking-wide opacity-80">{label}</p>
      <p className="text-lg font-bold">{value}</p>
      {sub && <p className="text-[11px] opacity-80">{sub}</p>}
    </div>
  );
}

function Empty({ msg = 'No data.' }: { msg?: string }) {
  return <p className="text-sm text-secondary py-4 text-center">{msg}</p>;
}
