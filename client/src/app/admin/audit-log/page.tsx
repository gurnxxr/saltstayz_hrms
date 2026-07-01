'use client';

import { useState, Fragment } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import {
  ArrowLeft, Search, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  ScrollText, ShieldAlert, User,
} from 'lucide-react';

const ACTION_COLORS: Record<string, string> = {
  create: 'bg-green-100 text-green-700',
  update: 'bg-blue-100 text-blue-700',
  delete: 'bg-red-100 text-red-700',
  approve: 'bg-green-100 text-green-700',
  reject: 'bg-red-100 text-red-700',
  login: 'bg-gray-100 text-gray-600',
  logout: 'bg-gray-100 text-gray-600',
  'change-password': 'bg-amber-100 text-amber-700',
  'reset-password': 'bg-amber-100 text-amber-700',
};

export default function AuditLogPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [module, setModule] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data: meta } = useQuery({
    queryKey: ['audit-meta'],
    queryFn: () => api.get('/admin/audit-logs/meta').then(r => r.data),
  });

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['audit-logs', search, module, action, from, to, page],
    queryFn: () => {
      const p = new URLSearchParams();
      if (search) p.set('search', search);
      if (module) p.set('module', module);
      if (action) p.set('action', action);
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      p.set('page', String(page));
      return api.get(`/admin/audit-logs?${p.toString()}`).then(r => r.data);
    },
    placeholderData: keepPreviousData,
  });

  const rows = data?.data ?? [];
  const reset = (fn: (v: any) => void) => (v: any) => { fn(v); setPage(1); };

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <button onClick={() => router.push('/admin')} className="flex items-center gap-2 text-secondary hover:text-foreground text-sm transition-colors mb-2">
            <ArrowLeft size={16} /> Back to Admin
          </button>
          <div className="flex items-center gap-2">
            <ScrollText className="text-primary" size={22} />
            <h1 className="text-2xl font-bold text-foreground">Audit Log</h1>
          </div>
          <p className="text-secondary mt-1">Every change to employees, salary, leave, access and more — who did it, when, and the outcome. Sensitive fields (Aadhaar, PAN, passwords, bank details) are redacted.</p>
        </div>

        {/* Filters */}
        <div className="bg-card rounded-xl border border-border p-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-secondary mb-1">Search</label>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
              <input value={search} onChange={(e) => reset(setSearch)(e.target.value)} placeholder="Actor email, summary, record id…"
                className="w-full pl-9 pr-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">Module</label>
            <select value={module} onChange={(e) => reset(setModule)(e.target.value)} className="px-3 py-2 border border-border rounded-lg bg-background text-sm">
              <option value="">All</option>
              {(meta?.modules ?? []).map((m: string) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">Action</label>
            <select value={action} onChange={(e) => reset(setAction)(e.target.value)} className="px-3 py-2 border border-border rounded-lg bg-background text-sm">
              <option value="">All</option>
              {(meta?.actions ?? []).map((a: string) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">From</label>
            <input type="date" value={from} onChange={(e) => reset(setFrom)(e.target.value)} className="px-3 py-2 border border-border rounded-lg bg-background text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">To</label>
            <input type="date" value={to} onChange={(e) => reset(setTo)(e.target.value)} className="px-3 py-2 border border-border rounded-lg bg-background text-sm" />
          </div>
          {(search || module || action || from || to) && (
            <button onClick={() => { setSearch(''); setModule(''); setAction(''); setFrom(''); setTo(''); setPage(1); }}
              className="px-3 py-2 text-sm text-secondary hover:text-foreground border border-border rounded-lg">Clear</button>
          )}
        </div>

        {/* Table */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <table className="w-full">
            <thead><tr className="border-b border-border bg-muted/50">
              <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">When</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Actor</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Action</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Details</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Status</th>
              <th className="w-8"></th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i}><td colSpan={6} className="px-4 py-3"><div className="h-5 bg-muted rounded animate-pulse" /></td></tr>
                ))
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-12 text-secondary text-sm">No audit entries match these filters.</td></tr>
              ) : rows.map((r: any) => {
                const denied = r.status_code >= 400;
                const open = expanded === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr className={`hover:bg-muted/30 cursor-pointer ${denied ? 'bg-red-50/40' : ''}`} onClick={() => setExpanded(open ? null : r.id)}>
                      <td className="px-4 py-3 text-sm text-secondary whitespace-nowrap">{formatDateTime(r.created_at)}</td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex items-center gap-1.5">
                          <User size={13} className="text-secondary shrink-0" />
                          <span className="text-foreground">{r.actor_email || 'system'}</span>
                        </div>
                        {r.actor_role && <span className="text-[11px] text-secondary ml-5">{r.actor_role}</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ACTION_COLORS[r.action] || 'bg-gray-100 text-gray-600'}`}>{r.action}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground">
                        {r.summary}
                        <span className="text-[11px] text-secondary ml-2">{r.module}</span>
                      </td>
                      <td className="px-4 py-3">
                        {denied ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600"><ShieldAlert size={13} /> {r.status_code} denied</span>
                        ) : (
                          <span className="text-xs text-green-600 font-medium">{r.status_code} ok</span>
                        )}
                      </td>
                      <td className="px-2 text-secondary">{open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</td>
                    </tr>
                    {open && (
                      <tr className="bg-muted/20">
                        <td colSpan={6} className="px-6 py-3">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1 text-xs">
                            <div><span className="text-secondary">Method &amp; path: </span><code className="text-foreground">{r.method} /{r.path}</code></div>
                            <div><span className="text-secondary">Target id: </span><span className="text-foreground">{r.target_id || '—'}</span></div>
                            <div><span className="text-secondary">IP: </span><span className="text-foreground">{r.ip_address || '—'}</span></div>
                            <div><span className="text-secondary">Entity: </span><span className="text-foreground">{r.entity || '—'}</span></div>
                          </div>
                          {r.metadata && (
                            <div className="mt-2">
                              <span className="text-secondary text-xs">Payload (redacted):</span>
                              <pre className="mt-1 text-[11px] bg-background border border-border rounded-lg p-2 overflow-x-auto text-foreground">{JSON.stringify(r.metadata, null, 2)}</pre>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-secondary">
              {((data.page - 1) * data.limit) + 1}–{Math.min(data.page * data.limit, data.total)} of {data.total}
              {isFetching && <span className="ml-2 opacity-60">updating…</span>}
            </p>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={data.page <= 1}
                className="flex items-center gap-1 px-3 py-1.5 border border-border rounded-lg text-sm disabled:opacity-40 hover:bg-muted"><ChevronLeft size={15} /> Prev</button>
              <span className="text-sm text-secondary">Page {data.page} / {data.totalPages}</span>
              <button onClick={() => setPage(p => p + 1)} disabled={data.page >= data.totalPages}
                className="flex items-center gap-1 px-3 py-1.5 border border-border rounded-lg text-sm disabled:opacity-40 hover:bg-muted">Next <ChevronRight size={15} /></button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
