'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import LoadError from '@/components/ui/LoadError';
import api from '@/lib/api';
import { ChevronLeft, ChevronRight, Copy, Save, CheckCircle2, Lock, Loader2, CalendarClock } from 'lucide-react';

// ── Week helpers (Monday-start) ──
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function mondayOf(d: Date): string {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // 0 = Monday
  x.setDate(x.getDate() - day);
  return iso(x);
}
function addDays(dateIso: string, n: number): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  const x = new Date(y, m - 1, d);
  x.setDate(x.getDate() + n);
  return iso(x);
}
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const shortDate = (dateIso: string) => {
  const [y, m, d] = dateIso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

const STATUS_BADGE: Record<string, string> = {
  published: 'bg-green-100 text-green-700',
  draft: 'bg-yellow-100 text-yellow-700',
  partial: 'bg-orange-100 text-orange-700',
  empty: 'bg-gray-100 text-gray-500',
};

type Edit = { day_type: 'working' | 'weekly_off' | 'clear'; shift_type_id?: number };

export default function RosterPage() {
  const queryClient = useQueryClient();
  const [propertyId, setPropertyId] = useState<number | null>(null);
  const [weekStart, setWeekStart] = useState<string>(() => mondayOf(new Date()));
  const [edits, setEdits] = useState<Record<string, Edit>>({}); // `${empId}|${date}` → Edit
  const [selected, setSelected] = useState<Set<number>>(new Set()); // employees ticked for copy
  const [deptFilter, setDeptFilter] = useState(''); // '' = all departments

  const weekEnd = addDays(weekStart, 6);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const dirty = Object.keys(edits).length > 0;

  const { data: properties = [] } = useQuery({
    queryKey: ['properties'],
    queryFn: () => api.get('/admin/properties').then(r => r.data),
  });
  // Default to the first property once loaded.
  const activePropertyId = propertyId ?? properties[0]?.id ?? null;

  // Shared key with the Shift Types page (both read /shifts/types). staleTime 0 +
  // refetchOnMount 'always' guarantee the dropdown reloads the latest types every
  // time the roster opens or regains focus — so a shift type added on the Shift
  // Types tab always shows up here, with no stale-cache gap.
  const { data: shiftTypes = [] } = useQuery({
    queryKey: ['shift-types'],
    queryFn: () => api.get('/shifts/types').then(r => r.data),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
  const activeShifts = shiftTypes.filter((s: any) => s.is_active);

  const { data: roster, isError, refetch, isFetching } = useQuery({
    queryKey: ['roster', activePropertyId, weekStart],
    queryFn: () => api.get(`/shifts/roster?property_id=${activePropertyId}&week_start=${weekStart}&week_end=${weekEnd}`).then(r => r.data),
    enabled: !!activePropertyId,
  });

  const allEmployees: any[] = roster?.employees ?? [];
  const status: string = roster?.status ?? 'empty';
  // Any published cells (fully or partially) lock editing — you must unpublish first.
  const hasPublished = status === 'published' || status === 'partial';

  // ── Department filter ──
  // The server hands us the real department names for this property's filter — the
  // official catalog unioned with the department names its staff actually carry —
  // so a department created in Admin appears here immediately, even before anyone
  // is assigned to it, and off-catalog names already on staff never disappear.
  // We only add the "No department" bucket ourselves, for staff with a blank
  // dept_name (the server list carries real names only).
  const NO_DEPT = '__none__';
  const departments = useMemo(() => {
    const list: string[] = roster?.departments ?? [];
    const hasBlank = allEmployees.some((e) => !e.dept_name?.trim());
    return hasBlank ? [...list, NO_DEPT] : list;
  }, [roster?.departments, allEmployees]);

  const employees = useMemo(
    () => (deptFilter ? allEmployees.filter((e) => (e.dept_name?.trim() || NO_DEPT) === deptFilter) : allEmployees),
    [allEmployees, deptFilter],
  );

  // ── Employee selection (for "copy last week" of chosen employees) ──
  // Selection is scoped to what's visible: ticking "all" while filtered to Housekeeping
  // must not copy the whole property, and a hidden row must never ride along on Copy.
  const visibleIds = useMemo(() => new Set(employees.map((e) => e.id)), [employees]);
  const selectedVisible = useMemo(() => [...selected].filter((id) => visibleIds.has(id)), [selected, visibleIds]);
  const allSelected = employees.length > 0 && employees.every((e) => selected.has(e.id));
  const toggleOne = (id: number) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const toggleAll = () => setSelected((prev) => {
    const next = new Set(prev);
    if (allSelected) employees.forEach((e) => next.delete(e.id));
    else employees.forEach((e) => next.add(e.id));
    return next;
  });

  function guardDiscard(): boolean {
    if (!dirty) return true;
    if (confirm('You have unsaved changes. Discard them?')) { setEdits({}); return true; }
    return false;
  }

  const changeWeek = (delta: number) => { if (guardDiscard()) setWeekStart(addDays(weekStart, delta * 7)); };
  const changeProperty = (id: number) => {
    if (guardDiscard()) { setPropertyId(id); setSelected(new Set()); setDeptFilter(''); }
  };
  // Copy only what the user can see — a selection hidden by the filter is not consent.
  const copySelected = () => {
    if (selectedVisible.length && guardDiscard()) copyMutation.mutate({ employeeIds: selectedVisible });
  };

  // Current select value for a cell: pending edit wins over the fetched cell.
  const cellValue = (empId: number, date: string, cell: any): string => {
    const e = edits[`${empId}|${date}`];
    if (e) return e.day_type === 'clear' ? '' : e.day_type === 'weekly_off' ? 'off' : String(e.shift_type_id);
    if (!cell) return '';
    if (cell.day_type === 'weekly_off') return 'off';
    return cell.shift_type_id ? String(cell.shift_type_id) : '';
  };

  const setCell = (empId: number, date: string, value: string) => {
    const edit: Edit = value === '' ? { day_type: 'clear' }
      : value === 'off' ? { day_type: 'weekly_off' }
        : { day_type: 'working', shift_type_id: Number(value) };
    setEdits(prev => ({ ...prev, [`${empId}|${date}`]: edit }));
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const submitted = Object.keys(edits);
      const cells = submitted.map((k) => {
        const e = edits[k];
        const [employee_id, date] = k.split('|');
        return { employee_id: Number(employee_id), date, day_type: e.day_type, shift_type_id: e.shift_type_id };
      });
      const res = await api.post('/shifts/roster/save', { property_id: activePropertyId, cells }).then(r => r.data);
      return { res, submitted };
    },
    onSuccess: ({ res, submitted }) => {
      // Clear only the keys we actually sent, so edits made during the in-flight save survive.
      setEdits((prev) => { const next = { ...prev }; submitted.forEach((k) => delete next[k]); return next; });
      queryClient.invalidateQueries({ queryKey: ['roster', activePropertyId, weekStart] });
      toast.success(`Saved (${res.saved} set, ${res.cleared} cleared)`);
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to save'),
  });

  const copyMutation = useMutation({
    // No employeeIds → copy the whole property; an array → copy only those employees.
    mutationFn: (vars?: { employeeIds?: number[] }) =>
      api.post('/shifts/roster/copy-previous', {
        property_id: activePropertyId, week_start: weekStart, week_end: weekEnd,
        ...(vars?.employeeIds ? { employee_ids: vars.employeeIds } : {}),
      }).then(r => r.data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['roster', activePropertyId, weekStart] });
      setSelected(new Set());
      toast.success(`Copied ${res.copied} cell(s) from last week (draft)`);
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to copy'),
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      if (dirty) await saveMutation.mutateAsync();
      return api.post('/shifts/roster/publish', { property_id: activePropertyId, week_start: weekStart, week_end: weekEnd }).then(r => r.data);
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['roster', activePropertyId, weekStart] });
      toast.success(`Published — ${res.notified} staff notified`);
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to publish'),
  });

  const unpublishMutation = useMutation({
    mutationFn: () => api.post('/shifts/roster/unpublish', { property_id: activePropertyId, week_start: weekStart, week_end: weekEnd }).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roster', activePropertyId, weekStart] });
      toast.success('Reverted to draft — you can edit again');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to unpublish'),
  });

  const selectCls = 'w-full text-xs px-1.5 py-1 border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary/50';

  return (
    <AppShell>
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Roster</h1>
            <p className="text-secondary mt-1">Plan the week, mark weekly-offs, then publish. Published rosters drive attendance and pay.</p>
          </div>
          <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_BADGE[status]}`}>
            {status === 'empty' ? 'Not started' : status === 'published' ? 'Published' : status === 'partial' ? 'Partly published' : 'Draft'}
          </span>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={activePropertyId ?? ''}
            onChange={(e) => changeProperty(Number(e.target.value))}
            className="px-3 py-2 border border-border rounded-lg bg-background text-sm"
          >
            {properties.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            disabled={departments.length <= 1}
            title={departments.length <= 1 ? 'Only one department to filter by' : 'Filter the roster by department'}
            className="px-3 py-2 border border-border rounded-lg bg-background text-sm disabled:opacity-50"
          >
            <option value="">All Departments{allEmployees.length ? ` (${allEmployees.length})` : ''}</option>
            {departments.map((d) => {
              const n = allEmployees.filter((e) => (e.dept_name?.trim() || NO_DEPT) === d).length;
              return <option key={d} value={d}>{d === NO_DEPT ? 'No department' : d} ({n})</option>;
            })}
          </select>

          <div className="flex items-center gap-1">
            <button onClick={() => changeWeek(-1)} className="p-2 rounded-lg border border-border hover:bg-muted" title="Previous week"><ChevronLeft size={16} /></button>
            <span className="text-sm font-medium text-foreground px-2 min-w-44 text-center inline-flex items-center gap-1.5">
              <CalendarClock size={14} className="text-secondary" /> {shortDate(weekStart)} – {shortDate(weekEnd)}
            </span>
            <button onClick={() => changeWeek(1)} className="p-2 rounded-lg border border-border hover:bg-muted" title="Next week"><ChevronRight size={16} /></button>
            <button onClick={() => { if (guardDiscard()) setWeekStart(mondayOf(new Date())); }} className="ml-1 text-xs px-2.5 py-2 rounded-lg border border-border hover:bg-muted">This week</button>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={copySelected}
              disabled={copyMutation.isPending || hasPublished || selectedVisible.length === 0}
              title={selectedVisible.length === 0
                ? 'Tick employees to copy their last-week shifts'
                : `Copy last week's shifts for ${selectedVisible.length} selected employee(s)`}
              className="flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              {copyMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}
              Copy{selectedVisible.length > 0 ? ` (${selectedVisible.length})` : ''}
            </button>
            {!hasPublished ? (
              <>
                <button
                  onClick={() => saveMutation.mutate()}
                  disabled={!dirty || saveMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted disabled:opacity-50"
                >
                  {saveMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save draft
                </button>
                <button
                  onClick={() => publishMutation.mutate()}
                  disabled={publishMutation.isPending || (status === 'empty' && !dirty)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                >
                  {publishMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Publish
                </button>
              </>
            ) : (
              <button
                onClick={() => unpublishMutation.mutate()}
                disabled={unpublishMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                {unpublishMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />} Unpublish to edit
              </button>
            )}
          </div>
        </div>

        {hasPublished && roster?.published_at && (
          <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 inline-flex items-center gap-1.5">
            <CheckCircle2 size={13} /> Published{roster.published_by_name ? ` by ${roster.published_by_name}` : ''} on {new Date(roster.published_at).toLocaleString('en-IN')}. Staff have been notified. Unpublish to make changes.
          </p>
        )}

        {activeShifts.length === 0 && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
            No shift types yet. Create them under Shift Management → Shift Types before building a roster.
          </p>
        )}

        {/* Grid */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {isError ? (
            <LoadError message="Couldn't load the roster." onRetry={() => refetch()} />
          ) : employees.length === 0 ? (
            <div className="p-8 text-center text-secondary">{isFetching ? 'Loading…' : 'No employees at this property.'}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase sticky left-0 bg-muted/50 min-w-48">
                      <label className="flex items-center gap-2 normal-case">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleAll}
                          disabled={hasPublished || employees.length === 0}
                          title="Select all employees"
                          className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
                        />
                        Employee
                      </label>
                    </th>
                    {days.map((d, i) => (
                      <th key={d} className="px-2 py-3 text-xs font-medium text-secondary text-center min-w-32">
                        {DAY_LABELS[i]}<span className="block font-normal text-[11px] text-secondary/70">{shortDate(d)}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {employees.map((emp) => (
                    <tr key={emp.id} className="hover:bg-muted/20">
                      <td className="px-4 py-2 sticky left-0 bg-card">
                        <label className="flex items-center gap-2.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selected.has(emp.id)}
                            onChange={() => toggleOne(emp.id)}
                            disabled={hasPublished}
                            className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-primary/50 disabled:opacity-50 shrink-0"
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-foreground truncate">{emp.first_name} {emp.last_name}</span>
                            <span className="block text-xs text-secondary">
                              {emp.employee_code}{emp.designation ? ` · ${emp.designation}` : ''}{emp.dept_name ? ` · ${emp.dept_name}` : ''}
                            </span>
                          </span>
                        </label>
                      </td>
                      {days.map((date) => {
                        const cell = emp.cells?.[date];
                        const val = cellValue(emp.id, date, cell);
                        const edited = !!edits[`${emp.id}|${date}`];
                        // If the assigned shift type was later deactivated it isn't in
                        // activeShifts — render it explicitly so the cell never falls back
                        // to a blank "—" (which reads as a rest day).
                        const inactiveAssigned = val && val !== 'off' && !activeShifts.some((s: any) => String(s.id) === val);
                        return (
                          <td key={date} className={`px-1.5 py-1.5 align-middle ${val === 'off' ? 'bg-muted/40' : ''} ${edited ? 'ring-1 ring-inset ring-primary/40' : ''}`}>
                            <select
                              value={val}
                              disabled={hasPublished}
                              onChange={(e) => setCell(emp.id, date, e.target.value)}
                              className={`${selectCls} ${val === 'off' ? 'text-secondary italic' : ''} disabled:opacity-70`}
                            >
                              <option value="">—</option>
                              <option value="off">Weekly Off</option>
                              {inactiveAssigned && <option value={val}>{cell?.shift_name || 'Shift'} (inactive)</option>}
                              {activeShifts.map((s: any) => (
                                <option key={s.id} value={s.id}>{s.name} ({String(s.start_time).slice(0, 5)}–{String(s.end_time).slice(0, 5)})</option>
                              ))}
                            </select>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-xs text-secondary">
          Blank (—) means not scheduled — a paid rest day for payroll, same as Weekly Off. Only <span className="font-medium">published</span> weeks affect attendance and pay; a draft never does.
        </p>
      </div>
    </AppShell>
  );
}
