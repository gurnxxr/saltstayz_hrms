'use client';

import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import AppShell from '@/components/layout/AppShell';
import Breadcrumb from '@/components/ui/Breadcrumb';
import LoadError from '@/components/ui/LoadError';
import Pagination, { pageSlice } from '@/components/ui/Pagination';
import api from '@/lib/api';
import { formatINR } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { Search, Download, Coins, AlertTriangle } from 'lucide-react';

const PAGE_SIZE = 20;

type Col = { key: string; label: string; group: string };

const GROUP_LABEL: Record<string, string> = {
  earning: 'Earnings', subtotal: '', deduction: 'Deductions',
  employer: 'Employer Cost', reimbursement: 'Reimbursements', total: 'CTC',
};
const GROUP_TINT: Record<string, string> = {
  earning: 'text-emerald-700', deduction: 'text-rose-700', employer: 'text-violet-700',
  reimbursement: 'text-sky-700', subtotal: 'text-secondary', total: 'text-primary',
};

export default function SalaryOverviewPage() {
  const { user } = useAuth();
  const isAdmin = user?.roleName === 'admin';
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['salary-overview'],
    queryFn: () => api.get('/admin/salary-overview').then(r => r.data),
    enabled: isAdmin,
  });

  const columns: Col[] = data?.columns ?? [];
  const rows: any[] = data?.rows ?? [];
  const totals: Record<string, number> = data?.totals ?? {};

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return rows;
    return rows.filter((r: any) =>
      r.name.toLowerCase().includes(q) ||
      r.employee_code?.toLowerCase().includes(q) ||
      (r.dept_name || '').toLowerCase().includes(q) ||
      (r.branch_name || '').toLowerCase().includes(q));
  }, [rows, search]);

  useEffect(() => { setPage(1); }, [search]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visible = pageSlice(filtered, currentPage, PAGE_SIZE);

  // Contiguous group runs for the top header row.
  const groupRuns = useMemo(() => {
    const runs: { group: string; span: number }[] = [];
    for (const c of columns) {
      const last = runs[runs.length - 1];
      if (last && last.group === c.group) last.span++;
      else runs.push({ group: c.group, span: 1 });
    }
    return runs;
  }, [columns]);

  const money = (v: any) => (v == null || v === 0 ? '—' : formatINR(v));

  // Export EVERY employee (whole org), not just the filtered/visible page.
  function exportCsv() {
    if (!rows.length) return;
    const cell = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Emp Code', 'Employee Name', 'Property', 'Department', 'Designation', ...columns.map(c => c.label)];
    const lines = rows.map((r: any) => [
      r.employee_code, r.name, r.branch_name || '', r.dept_name || '', r.designation || '',
      ...columns.map(c => (r.configured ? (r.values[c.key] ?? 0) : '')),
    ]);
    const csv = [header, ...lines].map(cols => cols.map(cell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'salary_details_overview.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Breadcrumb className="mb-2" items={[{ label: 'Admin', href: '/admin' }, { label: 'Salary Details' }]} />
            <h1 className="text-2xl font-bold text-foreground">Salary Details</h1>
            <p className="text-secondary mt-1">Every employee’s salary components, statutory deductions, employer cost and CTC — one row each.</p>
          </div>
          <button onClick={exportCsv} disabled={!rows.length}
            className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted disabled:opacity-50 transition-colors"
            title="Download all employees (CSV)">
            <Download size={15} /> Export CSV
          </button>
        </div>

        {!isAdmin ? (
          <div className="bg-card rounded-xl border border-border p-12 text-center text-secondary">
            <Coins size={40} className="mx-auto text-secondary/30 mb-3" />
            <p>This page is available to administrators only.</p>
          </div>
        ) : isLoading ? (
          <div className="bg-card rounded-xl border border-border p-12 flex justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : isError ? (
          <div className="bg-card rounded-xl border border-border">
            <LoadError message="Couldn't load salary details." onRetry={() => refetch()} />
          </div>
        ) : (
          <>
            {/* Summary */}
            <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
              <span className="text-secondary">Employees: <span className="font-semibold text-foreground">{data.total_employees}</span></span>
              <span className="text-secondary">With a salary structure: <span className="font-semibold text-foreground">{data.configured}</span></span>
              <span className="text-secondary">Total monthly CTC: <span className="font-semibold text-foreground">{formatINR(totals.ctc || 0)}</span></span>
              {data.out_of_band > 0 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                  <AlertTriangle size={12} /> {data.out_of_band} outside their pay grade
                </span>
              )}
              {data.ungraded > 0 && (
                <span className="text-secondary/70 text-xs" title="Their role has no pay grade, so there is no band to check them against.">
                  {data.ungraded} on a role with no pay grade
                </span>
              )}
            </div>

            <div className="relative max-w-sm">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, code, department, property…"
                className="w-full pl-9 pr-3 py-2.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>

            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th rowSpan={2} className="sticky left-0 z-10 bg-muted/50 text-left px-4 py-2 text-xs font-semibold text-secondary uppercase min-w-56">Employee</th>
                      {groupRuns.map((g, i) => (
                        <th key={i} colSpan={g.span} className={`px-2 py-2 text-center text-[11px] font-semibold uppercase border-l border-border ${GROUP_TINT[g.group] || 'text-secondary'}`}>
                          {GROUP_LABEL[g.group] || ''}
                        </th>
                      ))}
                    </tr>
                    <tr className="border-b border-border bg-muted/30">
                      {columns.map((c) => (
                        <th key={c.key} className={`px-3 py-2 text-right text-xs whitespace-nowrap ${c.group === 'total' ? 'font-bold text-primary' : 'font-medium text-secondary'}`}>
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {visible.map((r: any) => {
                      // Outside the band their role's pay grade allows — either direction.
                      const outOfBand = r.band_status === 'above' || r.band_status === 'below';
                      return (
                      <tr key={r.employee_id} className={outOfBand ? 'bg-amber-50/60 hover:bg-amber-50' : 'hover:bg-muted/20'}>
                        <td className={`sticky left-0 z-10 px-4 py-2.5 ${outOfBand ? 'bg-amber-50/60' : 'bg-card'}`}>
                          <p className="font-medium text-foreground whitespace-nowrap">{r.name}</p>
                          <p className="text-xs text-secondary whitespace-nowrap">{r.employee_code} · {r.dept_name || '—'}</p>
                          {!r.configured && <p className="text-[11px] text-amber-600 whitespace-nowrap">No salary structure</p>}
                          {outOfBand && (
                            <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 whitespace-nowrap"
                              title={`${r.pay_grade_name}: ${formatINR(r.pay_grade_min)} – ${formatINR(r.pay_grade_max)}. The band comes from the role's pay grade — change it in Admin → Organization → Job Titles.`}>
                              <AlertTriangle size={11} className="shrink-0" />
                              {r.band_status === 'above' ? 'Above' : 'Below'} {r.pay_grade_name} by {formatINR(r.band_variance)}
                            </p>
                          )}
                          {r.configured && r.band_status === 'ungraded' && (
                            <p className="text-[11px] text-secondary/70 whitespace-nowrap" title="This role has no pay grade, so their salary can't be checked against a band. Assign one in Admin → Organization → Job Titles.">
                              No pay grade on this role
                            </p>
                          )}
                        </td>
                        {columns.map((c) => (
                          <td key={c.key} className={`px-3 py-2.5 text-right whitespace-nowrap ${c.group === 'total' ? 'font-semibold text-foreground' : 'text-secondary'}`}>
                            {r.configured ? money(r.values[c.key]) : <span className="text-secondary/40">—</span>}
                          </td>
                        ))}
                      </tr>
                      );
                    })}
                    {filtered.length === 0 && (
                      <tr><td colSpan={columns.length + 1} className="text-center py-10 text-secondary">No employees match your search.</td></tr>
                    )}
                  </tbody>
                  {filtered.length > 0 && (
                    <tfoot>
                      <tr className="border-t-2 border-border bg-muted/40">
                        <td className="sticky left-0 z-10 bg-muted/40 px-4 py-2.5 text-sm font-semibold text-foreground whitespace-nowrap">Total ({data.configured})</td>
                        {columns.map((c) => (
                          <td key={c.key} className="px-3 py-2.5 text-right text-sm font-semibold text-foreground whitespace-nowrap">{money(totals[c.key])}</td>
                        ))}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              <Pagination
                total={filtered.length}
                page={currentPage}
                pageSize={PAGE_SIZE}
                shown={visible.length}
                onPageChange={setPage}
                itemLabel="employees"
              />
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
