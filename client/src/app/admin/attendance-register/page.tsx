'use client';

import { Fragment, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import Breadcrumb from '@/components/ui/Breadcrumb';
import LoadError from '@/components/ui/LoadError';
import Pagination from '@/components/ui/Pagination';
import api from '@/lib/api';
import { errorFromBlob } from '@/lib/utils';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { ATTENDANCE_CODES, CODE_BY_STATUS } from '@/lib/attendanceCodes';
import {
  Search, Download, ChevronDown, ChevronRight, Table2, CalendarDays, Loader2, Info,
} from 'lucide-react';

const PAGE_SIZE = 25;
const selectCls = 'px-3 py-2 border border-border rounded-lg bg-background text-sm';

/** Sticky columns need an opaque background on EVERY cell or scrolled columns bleed through. */
const STICKY = 'sticky left-0 z-10';

const thisMonth = () => new Date().toISOString().slice(0, 7);
const prevMonth = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
};
const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
};

export default function AttendanceRegisterPage() {
  const [month, setMonth] = useState(thisMonth());
  const [view, setView] = useState<'summary' | 'grid'>('summary');
  const [search, setSearch] = useState('');
  const [property, setProperty] = useState('');
  const [branchUnit, setBranchUnit] = useState('');
  const [department, setDepartment] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const debounced = useDebouncedValue(search, 300);

  // The three catalogues behind the dropdowns. Options are NAMES, not ids — employees are tied to
  // all three by plain text, so the value has to be what is stored on the row.
  const { data: properties = [] } = useQuery({
    queryKey: ['properties'], queryFn: () => api.get('/admin/properties').then(r => r.data),
  });
  const { data: departments = [] } = useQuery({
    queryKey: ['departments'], queryFn: () => api.get('/admin/departments').then(r => r.data),
  });
  const { data: branches = [] } = useQuery({
    queryKey: ['branches'], queryFn: () => api.get('/admin/branches').then(r => r.data).catch(() => []),
  });

  /** One builder for the query and the export, so the file always matches the screen. */
  const listParams = () => {
    const p = new URLSearchParams({ month });
    if (debounced) p.set('search', debounced);
    if (property) p.set('property', property);
    // `branch_unit`, not `branch` — every other filter named `branch` in this system means the
    // property, and reusing that word would point this at the wrong column.
    if (branchUnit) p.set('branch_unit', branchUnit);
    if (department) p.set('department', department);
    return p;
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['attendance-register', view, month, debounced, property, branchUnit, department, page],
    queryFn: () => {
      const p = listParams();
      p.set('page', String(page));
      p.set('pageSize', String(PAGE_SIZE));
      const path = view === 'grid' ? 'register/grid' : 'register';
      return api.get(`/attendance/admin/${path}?${p}`).then(r => r.data);
    },
    placeholderData: (prev) => prev,
  });

  // Any filter change resets to page 1, so you never land on an empty page.
  useEffect(() => { setPage(1); setExpanded(null); }, [month, debounced, property, branchUnit, department, view]);

  const rows: any[] = data?.data ?? [];
  const total: number = data?.total ?? 0;
  const totals: Record<string, number> = data?.totals ?? {};
  const dates: string[] = data?.dates ?? [];

  async function handleExport() {
    setExporting(true);
    try {
      const res = await api.get(`/attendance/admin/register/export?${listParams()}`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `Attendance_Register_${month}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Register downloaded');
    } catch (err: any) {
      toast.error((await errorFromBlob(err)) || 'Could not export the register');
    } finally {
      setExporting(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <Breadcrumb items={[{ label: 'Admin', href: '/admin' }, { label: 'Attendance Register' }]} className="mb-2" />

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Attendance Register</h1>
            <p className="text-secondary mt-1 text-sm">
              Every employee&apos;s {monthLabel(month)} at a glance — counts per code, with the day-by-day behind each row.
            </p>
          </div>
          <button
            onClick={handleExport}
            disabled={exporting || total === 0}
            className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            Export CSV
          </button>
        </div>

        {/* Month + view */}
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="month" value={month} onChange={(e) => setMonth(e.target.value || thisMonth())}
            className={selectCls}
          />
          {month !== prevMonth() && (
            <button onClick={() => setMonth(prevMonth())}
              className="text-sm text-primary hover:underline">
              Last month
            </button>
          )}
          <div className="flex rounded-lg border border-border overflow-hidden ml-auto">
            {([['summary', 'Summary', Table2], ['grid', 'Day Grid', CalendarDays]] as const).map(([key, label, Icon]) => (
              <button
                key={key} onClick={() => setView(key)}
                className={`flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors ${
                  view === key ? 'bg-primary text-white' : 'bg-background text-secondary hover:text-foreground'
                }`}
              >
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
            <input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or employee code..."
              className="w-full pl-9 pr-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <select className={selectCls} value={property} onChange={(e) => setProperty(e.target.value)}>
            <option value="">All Properties</option>
            {properties.map((p: any) => <option key={p.id} value={p.name}>{p.name}</option>)}
          </select>
          <select
            className={selectCls} value={branchUnit} onChange={(e) => setBranchUnit(e.target.value)}
            disabled={branches.length === 0}
            title={branches.length === 0 ? 'No branches recorded yet' : 'The business unit someone reports into'}
          >
            <option value="">{branches.length === 0 ? 'No branches set up' : 'All Branches'}</option>
            {branches.map((b: any) => <option key={b.id} value={b.name}>{b.name}</option>)}
          </select>
          <select className={selectCls} value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">All Departments</option>
            {departments.map((d: any) => <option key={d.id} value={d.name}>{d.name}</option>)}
          </select>
        </div>

        {isError ? (
          <LoadError message="Couldn't load the attendance register." onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : total === 0 ? (
          <div className="bg-card rounded-xl border border-border p-10 text-center">
            <p className="text-sm font-medium text-foreground">No employees match these filters</p>
            <p className="text-sm text-secondary mt-1">Try clearing a filter or changing the month.</p>
          </div>
        ) : view === 'summary' ? (
          <SummaryTable
            rows={rows} totals={totals} month={month}
            expanded={expanded} onToggle={(id) => setExpanded(expanded === id ? null : id)}
          />
        ) : (
          <DayGrid rows={rows} dates={dates} />
        )}

        {!isLoading && !isError && total > 0 && (
          <Pagination
            total={total} page={page} pageSize={PAGE_SIZE}
            shown={rows.length} itemLabel="employees" onPageChange={setPage}
          />
        )}
      </div>
    </AppShell>
  );
}

/** One row per employee, one column per code, and a footer that sums the whole filtered set. */
function SummaryTable({ rows, totals, month, expanded, onToggle }: {
  rows: any[]; totals: Record<string, number>; month: string;
  expanded: number | null; onToggle: (id: number) => void;
}) {
  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className={`${STICKY} bg-muted/40 text-left px-4 py-3 text-xs font-semibold text-secondary uppercase min-w-[240px]`}>
                Employee
              </th>
              <th className="text-left px-3 py-3 text-xs font-semibold text-secondary uppercase whitespace-nowrap">Property</th>
              <th className="text-left px-3 py-3 text-xs font-semibold text-secondary uppercase whitespace-nowrap">Dept</th>
              {ATTENDANCE_CODES.map((c) => (
                <th key={c.code} title={c.hint ?? c.label}
                  className="px-3 py-3 text-center text-xs font-semibold text-secondary uppercase whitespace-nowrap">
                  {c.badge}
                </th>
              ))}
              <th className="px-3 py-3 text-center text-xs font-semibold text-secondary uppercase whitespace-nowrap">Recorded</th>
              <th className="px-3 py-3 text-center text-xs font-semibold text-secondary uppercase whitespace-nowrap">Avg hrs</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.id}>
                <tr onClick={() => onToggle(r.id)} className="border-b border-border hover:bg-muted/20 cursor-pointer">
                  <td className={`${STICKY} bg-card px-4 py-2.5`}>
                    <div className="flex items-center gap-1.5">
                      {expanded === r.id
                        ? <ChevronDown size={14} className="text-secondary shrink-0" />
                        : <ChevronRight size={14} className="text-secondary shrink-0" />}
                      <div className="min-w-0">
                        <p className="font-medium text-foreground truncate">
                          {`${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || '—'}
                        </p>
                        <p className="text-xs text-secondary">{r.employee_code}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-secondary whitespace-nowrap">{r.branch_name || '—'}</td>
                  <td className="px-3 py-2.5 text-secondary whitespace-nowrap">{r.dept_name || '—'}</td>
                  {ATTENDANCE_CODES.map((c) => {
                    const v = Number(r[c.code] ?? 0);
                    return (
                      <td key={c.code} className={`px-3 py-2.5 text-center font-semibold ${v > 0 ? c.tone : 'text-secondary/30'}`}>
                        {v}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2.5 text-center font-semibold text-foreground">{Number(r.recorded ?? 0)}</td>
                  <td className="px-3 py-2.5 text-center text-secondary">{r.avg_hours ?? '—'}</td>
                </tr>
                {expanded === r.id && (
                  <tr>
                    <td colSpan={ATTENDANCE_CODES.length + 5} className="bg-muted/20 px-4 py-4 border-b border-border">
                      <EmployeeMonth employeeId={r.id} month={month}
                        name={`${r.first_name ?? ''} ${r.last_name ?? ''}`.trim()} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-muted/40 font-semibold">
              <td className={`${STICKY} bg-muted/40 px-4 py-3 text-foreground`}>
                All {rows.length > 0 ? 'filtered employees' : ''}
              </td>
              <td /><td />
              {ATTENDANCE_CODES.map((c) => (
                <td key={c.code} className={`px-3 py-3 text-center ${Number(totals[c.code] ?? 0) > 0 ? c.tone : 'text-secondary/30'}`}>
                  {Number(totals[c.code] ?? 0)}
                </td>
              ))}
              <td className="px-3 py-3 text-center text-foreground">{Number(totals.recorded ?? 0)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="px-4 py-2.5 border-t border-border text-xs text-secondary">
        Totals cover every employee the filters select, not only this page. Click a row for the day-by-day.
      </div>
    </div>
  );
}

/** The wall of code letters — one column per day of the month. */
function DayGrid({ rows, dates }: { rows: any[]; dates: string[] }) {
  const isWeekend = (d: string) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="overflow-auto max-h-[70vh]">
        <table className="border-collapse text-sm">
          <thead>
            <tr className="bg-muted/40">
              {/* The corner outranks both axes, or it renders under the row that scrolls past it. */}
              <th className="sticky left-0 top-0 z-30 bg-muted/40 text-left px-4 py-2 text-xs font-semibold text-secondary uppercase min-w-[220px] border-b border-r border-border">
                Employee
              </th>
              {dates.map((d) => (
                <th key={d}
                  className={`sticky top-0 z-20 px-1 py-2 text-[11px] font-semibold text-secondary text-center border-b border-border min-w-[30px] ${
                    isWeekend(d) ? 'bg-muted/70' : 'bg-muted/40'
                  }`}
                >
                  {Number(d.slice(-2))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-muted/10">
                <td className={`${STICKY} bg-card px-4 py-1.5 border-b border-r border-border`}>
                  <p className="font-medium text-foreground text-xs truncate">
                    {`${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || '—'}
                  </p>
                  <p className="text-[11px] text-secondary">{r.employee_code}</p>
                </td>
                {dates.map((d) => {
                  const cell = r.days?.[d];
                  const meta = cell ? CODE_BY_STATUS[cell.status] : null;
                  return (
                    <td key={d}
                      title={cell ? `${d} — ${meta?.label ?? cell.status}${cell.regularised ? ' (regularised)' : ''}` : `${d} — nothing recorded`}
                      className={`px-1 py-1.5 text-center border-b border-border ${isWeekend(d) ? 'bg-muted/30' : ''}`}
                    >
                      {meta ? (
                        <span className={`inline-block w-full text-[10px] font-bold rounded px-0.5 py-0.5 ${meta.badgeBg} ${meta.badgeText}`}>
                          {meta.badge}
                        </span>
                      ) : (
                        <span className="text-secondary/25 text-[10px]">·</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 border-t border-border">
        {ATTENDANCE_CODES.map((c) => (
          <span key={c.code} className="flex items-center gap-1.5">
            <span className={`px-1.5 rounded text-[10px] font-bold ${c.badgeBg} ${c.badgeText}`}>{c.badge}</span>
            <span className="text-xs text-secondary">{c.label}</span>
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="text-secondary/40 text-xs px-1">·</span>
          {/* Honest about what a blank means: this view has no work calendar, so it cannot tell a
              weekly off from a genuine gap. The drill-down can, and does. */}
          <span className="text-xs text-secondary">Nothing recorded — open the row in Summary to see whether it was a day off</span>
        </span>
      </div>
    </div>
  );
}

/** One employee's month, day by day — fetched only when a row is opened. */
function EmployeeMonth({ employeeId, month, name }: { employeeId: number; month: string; name: string }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['employee-month', employeeId, month],
    queryFn: () => api.get(`/attendance/admin/employee-month?employeeId=${employeeId}&month=${month}`).then(r => r.data),
    enabled: !!employeeId,
  });

  if (isLoading) {
    return <div className="flex items-center gap-2 text-sm text-secondary py-3">
      <Loader2 size={14} className="animate-spin" /> Loading {name}&apos;s month…
    </div>;
  }
  if (isError || !data) return <LoadError message="Couldn't load this month." onRetry={() => refetch()} compact />;

  const byDate = new Map<string, any>((data.records ?? []).map((r: any) => [String(r.date).slice(0, 10), r]));
  const days: any[] = data.days ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-secondary">
        <Info size={13} />
        <span>
          Days marked <strong className="text-foreground">Weekly off</strong> or{' '}
          <strong className="text-foreground">Holiday</strong> are not expected to have attendance.
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
        {days.map((d) => {
          const rec = byDate.get(d.date);
          const meta = rec ? CODE_BY_STATUS[rec.status] : null;
          const offDay = d.kind === 'weekly_off' || d.kind === 'holiday' || d.kind === 'not_employed';
          return (
            <div key={d.date}
              className={`rounded-lg border p-2 ${offDay && !rec ? 'border-border/50 bg-muted/30' : 'border-border bg-card'}`}
            >
              <p className="text-[11px] text-secondary">
                {new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', weekday: 'short' })}
              </p>
              {meta ? (
                <>
                  <span className={`inline-block mt-1 px-1.5 rounded text-[10px] font-bold ${meta.badgeBg} ${meta.badgeText}`}>
                    {meta.badge}
                  </span>
                  <p className="text-[11px] text-foreground mt-1 leading-tight">{meta.label}</p>
                  {rec.working_hours ? <p className="text-[10px] text-secondary">{rec.working_hours}h</p> : null}
                  {rec.is_regularised ? <p className="text-[10px] text-indigo-600">Regularised</p> : null}
                </>
              ) : (
                <p className="text-[11px] text-secondary mt-1 leading-tight">
                  {d.kind === 'weekly_off' ? 'Weekly off'
                    : d.kind === 'holiday' ? (d.holiday_name || 'Holiday')
                      : d.kind === 'not_employed' ? 'Not employed'
                        : 'Not marked'}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
