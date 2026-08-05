'use client';

import { Fragment, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import AppShell from '@/components/layout/AppShell';
import Breadcrumb from '@/components/ui/Breadcrumb';
import LoadError from '@/components/ui/LoadError';
import Pagination, { pageSlice } from '@/components/ui/Pagination';
import api from '@/lib/api';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import EmptyState from '@/components/ui/EmptyState';
import { btnCls, inputCls, table } from '@/components/ui/styles';
import { cn, formatDate } from '@/lib/utils';
import { Search, Filter, ChevronDown, ChevronRight, Download, Loader2, Users } from 'lucide-react';

const PAGE_SIZE = 25;

/**
 * Every employee's leave balance, by leave type, for one period.
 *
 * "Available" is the number the apply screen actually gates on. It is NOT always
 * allocated − taken − pending: for an employee with an explicit allocation the server
 * counts only APPROVED days (a stored used_days counter), so their pending days do
 * not reserve balance. Pending is therefore its own column rather than folded in.
 */
export default function LeaveBalancesPage() {
  const [periodId, setPeriodId] = useState('');
  const [branch, setBranch] = useState('');
  const [dept, setDept] = useState('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search, 300);

  const { data: periods = [] } = useQuery({
    queryKey: ['leave-periods'],
    queryFn: () => api.get('/leave/periods').then(r => r.data),
  });
  const { data: properties = [] } = useQuery({
    queryKey: ['properties'],
    queryFn: () => api.get('/admin/properties').then(r => r.data),
  });
  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: () => api.get('/admin/departments').then(r => r.data),
  });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['leave-balances-overview', periodId, branch, dept, debouncedSearch],
    queryFn: () => api.get('/leave/balances/overview', {
      params: {
        period_id: periodId || undefined,
        branch: branch || undefined,
        dept: dept || undefined,
        search: debouncedSearch || undefined,
      },
    }).then(r => r.data),
  });

  // Unpaid types (Loss of Pay) allocate 365 days to mean "no limit", so a column reading 365/365
  // for every employee reports nothing. Filtering here also drops them from the CSV, which walks
  // this same list. The types themselves are untouched — see Leaves → Control Panel.
  const leaveTypes = (data?.leave_types ?? []).filter((lt: any) => lt.is_paid);
  const employees = data?.employees ?? [];        // full filtered set (all pages) — CSV/summary read this
  const balanceOf = (emp: any, typeId: number) => emp.balances.find((b: any) => b.leave_type_id === typeId);

  // Client-side pagination over the rows. `visible` is what the table renders.
  const totalPages = Math.max(1, Math.ceil(employees.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages); // clamp when the filtered set shrinks past the current page
  const visible = pageSlice(employees, currentPage, PAGE_SIZE);

  // Reset to page 1 when the filtered set changes.
  useEffect(() => { setPage(1); }, [periodId, branch, dept, debouncedSearch]);

  // Flatten the grid to one row per employee, exactly as displayed (plus the
  // taken/pending/source values behind each cell's tooltip).
  function exportCsv() {
    if (!employees.length) return;
    const rows = employees.map((e: any) => {
      const row: Record<string, any> = {
        Code: e.employee_code,
        Name: `${e.first_name} ${e.last_name}`,
        Designation: e.designation ?? '',
        Property: e.branch_name ?? '',
        Department: e.dept_name ?? '',
      };
      for (const lt of leaveTypes) {
        const b = balanceOf(e, lt.id);
        const na = !b || !b.applicable;
        row[`${lt.name} Available`] = na ? 'N/A' : b.available;
        row[`${lt.name} Allocated`] = na ? 'N/A' : b.allocated;
        row[`${lt.name} Taken`] = b ? b.taken : 0;
        row[`${lt.name} Pending`] = b ? b.pending : 0;
        row[`${lt.name} Source`] = na ? 'not applicable' : b.source;
      }
      return row;
    });
    const keys = Object.keys(rows[0]);
    const cell = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`; // names may contain , or "
    const csv = [keys.join(','), ...rows.map((r: any) => keys.map(k => cell(r[k])).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `leave_balances_${data?.period?.name ?? 'period'}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <Breadcrumb className="mb-2" items={[{ label: 'Leaves', href: '/leaves/my' }, { label: 'Balances' }]} />
          <h1 className="text-2xl font-bold text-foreground">Leave Balances</h1>
          <p className="text-secondary mt-1">
            Every employee&apos;s balance by leave type{data?.period ? ` — ${data.period.name}` : ''}
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or code..."
              // tailwind-merge keeps px-3's right padding and lets pl-9 win on the left — the room
              // the search icon needs. A raw template literal would leave both and let source
              // order decide.
              className={cn(inputCls, 'pl-9')}
            />
          </div>
          {/* These were `selectCls`, a local constant that had quietly lost the focus ring every
              other field in the module has. */}
          <select className={cn(inputCls, 'w-auto')} value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            <option value="">Current Period</option>
            {periods.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className={cn(inputCls, 'w-auto')} value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="">All Properties</option>
            {properties.map((p: any) => <option key={p.id} value={p.name}>{p.name}</option>)}
          </select>
          <div className="relative">
            <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
            <select
              value={dept}
              onChange={(e) => setDept(e.target.value)}
              className="pl-8 pr-8 py-2 border border-border rounded-lg bg-background text-sm appearance-none"
            >
              <option value="">All Departments</option>
              {departments.map((d: any) => <option key={d.id} value={d.name}>{d.name}</option>)}
            </select>
            <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-secondary pointer-events-none" />
          </div>
          <button
            onClick={exportCsv}
            disabled={!employees.length}
            className={btnCls('secondary')}
            title="Export CSV"
          >
            <Download size={15} /> Export
          </button>
        </div>

        {/* Grid */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">
              {employees.length} employee{employees.length === 1 ? '' : 's'}
            </h2>
            <p className="text-xs text-secondary">Available / allocated · click a row for detail</p>
          </div>
          {isError ? (
            <LoadError message="Couldn't load leave balances." onRetry={() => refetch()} />
          ) : isLoading ? (
            <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-secondary" /></div>
          ) : employees.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No employees match these filters"
              body="Try a different property, department or search term."
            />
          ) : (
            <>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className={table.head}>
                    {/* The sticky cell carries its own background — a sticky <th> does not take
                        the row's, so without it the scrolled columns show through. */}
                    <th className={cn(table.th, 'sticky left-0 bg-muted/40 min-w-48')}>Employee</th>
                    {leaveTypes.map((lt: any) => (
                      <th key={lt.id} className={cn(table.th, 'px-2 text-center min-w-32')}>{lt.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visible.map((e: any) => (
                    <Fragment key={e.id}>
                      <tr
                        onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                        className="hover:bg-muted/20 cursor-pointer"
                      >
                        <td className="px-4 py-2 sticky left-0 bg-card">
                          <div className="flex items-center gap-1.5">
                            {expanded === e.id
                              ? <ChevronDown size={14} className="text-secondary shrink-0" />
                              : <ChevronRight size={14} className="text-secondary shrink-0" />}
                            <div className="min-w-0">
                              <p className="font-medium text-foreground truncate">{e.first_name} {e.last_name}</p>
                              <p className="text-xs text-secondary truncate">
                                {e.employee_code}{e.dept_name ? ` · ${e.dept_name}` : ''}
                              </p>
                            </div>
                          </div>
                        </td>
                        {leaveTypes.map((lt: any) => {
                          const b = balanceOf(e, lt.id);
                          if (!b || !b.applicable) {
                            // Historical taken/pending days can exist if the type was restricted
                            // after they were booked — surface them rather than hide them.
                            const history = b && (b.taken > 0 || b.pending > 0)
                              ? ` (${b.taken} taken · ${b.pending} pending before it was restricted)` : '';
                            return (
                              <td key={lt.id} className="px-2 py-2 text-center text-secondary"
                                title={`${lt.name} does not apply to this employee's department${history}`}>
                                —
                              </td>
                            );
                          }
                          return (
                            <td
                              key={lt.id}
                              className="px-2 py-2 text-center"
                              title={`${b.taken} taken · ${b.pending} pending${
                                b.source === 'default' ? ' · from default days (no allocation)' : ''
                              }${b.source === 'accrual'
                                ? ` · earned ${Number(b.accrued ?? 0).toFixed(2)} day(s) so far${
                                  b.next_credit_on ? `, next credit ${formatDate(b.next_credit_on)}` : ''}`
                                : ''}`}
                            >
                              <span className={`font-medium ${b.available <= 0 ? 'text-red-600' : 'text-foreground'}`}>{b.available}</span>
                              <span className="text-secondary"> / {b.allocated}</span>
                              {b.source === 'default' && <span className="text-amber-600" title="From default days">*</span>}
                              {b.source === 'accrual' && <span className="text-blue-600" title="Earned monthly">†</span>}
                              {b.pending > 0 && (
                                <span className="block text-[11px] text-blue-600">{b.pending} pending</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                      {expanded === e.id && (
                        <tr className="bg-muted">
                          {/* sticky cell needs an opaque bg or scrolled columns bleed through */}
                          <td className="px-4 py-2 sticky left-0 bg-muted text-xs text-secondary">
                            {e.designation ?? '—'}{e.branch_name ? ` · ${e.branch_name}` : ''}
                          </td>
                          {leaveTypes.map((lt: any) => {
                            const b = balanceOf(e, lt.id);
                            if (!b || !b.applicable) {
                              return (
                                <td key={lt.id} className="px-2 py-2 text-center text-[11px] text-secondary space-y-0.5">
                                  <p>not applicable</p>
                                  {b && (b.taken > 0 || b.pending > 0) && <p>{b.taken} taken · {b.pending} pending</p>}
                                </td>
                              );
                            }
                            return (
                              <td key={lt.id} className="px-2 py-2 text-center text-[11px] text-secondary space-y-0.5">
                                <p>{b.taken} taken</p>
                                <p>{b.pending} pending</p>
                                <p className={b.source === 'default' ? 'text-amber-600' : b.source === 'accrual' ? 'text-blue-600' : ''}>
                                  {b.source === 'default' ? 'default days' : b.source === 'accrual' ? 'earned monthly' : 'allocated'}
                                </p>
                                {b.source === 'accrual' && (
                                  <>
                                    <p>{Number(b.accrued ?? 0).toFixed(2)} earned</p>
                                    {b.next_credit_on && <p>next {formatDate(b.next_credit_on)}</p>}
                                  </>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              total={employees.length}
              page={currentPage}
              pageSize={PAGE_SIZE}
              shown={visible.length}
              onPageChange={setPage}
              itemLabel="employees"
            />
            </>
          )}
        </div>

        <div className="text-xs text-secondary space-y-1">
          <p><span className="text-amber-600">*</span> Balance comes from the leave type&apos;s default days — this employee has no explicit allocation for the period.</p>
          <p>
            <span className="text-blue-600">†</span> This leave is <em>earned</em>: a share of the
            annual figure is credited on each joining anniversary, so the allocation grows through
            the year rather than starting full. Expand a row to see the exact days earned and when
            the next credit lands.
          </p>
          <p><span className="text-foreground">—</span> The leave type is restricted to departments this employee isn&apos;t in, so it cannot be applied for.</p>
          <p>
            Pending days are shown separately because they don&apos;t reduce <em>available</em> for employees with an
            explicit allocation — only approved days do.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
