'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import Breadcrumb from '@/components/ui/Breadcrumb';
import LoadError from '@/components/ui/LoadError';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Pagination from '@/components/ui/Pagination';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { Search, Clock, Loader2, X, History, UserCog, Moon, Trash2, Download, FileDown, Upload, Copy } from 'lucide-react';

const PAGE_SIZE = 15;

/*
 * The three columns `bulkUploadShiftAssignments` (server/src/services/shift.service.ts) actually
 * reads. Spelled the way it reads them: it lower-cases and turns spaces into underscores before
 * matching, and a column it cannot find aborts the whole upload with a 400 before any row is
 * processed. If those names change there, change them here — and in the Columns note inside
 * BulkUploadDialog below, which states the same contract in prose.
 *
 * Headers only, no example row. There is nothing to delete before typing, and a made-up row
 * would be worse than nothing here: shift_name has to match a shift that actually exists and is
 * active, so a plausible-looking "Morning Shift" would come back rejected on the first attempt.
 */
const SAMPLE_CSV_HEADERS = 'employee_code,shift_name,effective_from';

function copyErrors(errors: string[]) {
  navigator.clipboard.writeText((errors || []).join('\n')).then(
    () => toast.success('Errors copied to clipboard'),
    () => toast.error('Copy failed'),
  );
}

const inputCls =
  'w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';

const todayStr = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function ShiftLabel({ s }: { s: any }) {
  if (!s) return <span className="text-secondary">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-medium text-foreground">{s.shift_name}</span>
      <span className="text-xs text-secondary whitespace-nowrap">
        {(s.start_time ?? '').slice(0, 5)}–{(s.end_time ?? '').slice(0, 5)}
      </span>
      {s.ends_next_day && (
        <span className="inline-flex items-center text-[11px] text-purple-600" title="Ends the next day">
          <Moon size={11} />
        </span>
      )}
    </span>
  );
}

/** Put one employee on a shift from a date, and show what they've been on before. */
function AssignDialog({ employee, onClose }: { employee: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [shiftTypeId, setShiftTypeId] = useState(employee.current?.shift_type_id ? String(employee.current.shift_type_id) : '');
  const [effectiveFrom, setEffectiveFrom] = useState(todayStr());
  // Blank = open-ended, which is the normal case and the behaviour every assignment had before.
  const [effectiveTo, setEffectiveTo] = useState('');
  const [confirmDel, setConfirmDel] = useState<any | null>(null);

  const { data: shiftTypes = [] } = useQuery({
    queryKey: ['shift-types'],
    queryFn: () => api.get('/shifts/types').then((r) => r.data),
  });
  const activeShifts = shiftTypes.filter((s: any) => s.is_active);

  const { data: history = [], isLoading: histLoading } = useQuery({
    queryKey: ['shift-assignment-history', employee.id],
    queryFn: () => api.get(`/shifts/assignments/employees/${employee.id}`).then((r) => r.data),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['shift-assignments'] });
    qc.invalidateQueries({ queryKey: ['shift-assignment-history', employee.id] });
    // Both employee-facing views of "my shift" — the dashboard card and the My Shift page. They
    // are separate cache entries, so refreshing one leaves the other showing the old answer.
    qc.invalidateQueries({ queryKey: ['my-shift'] });
    qc.invalidateQueries({ queryKey: ['my-shift-overview'] });
  };

  const assign = useMutation({
    mutationFn: () => api.post('/shifts/assignments', {
      employee_id: employee.id,
      shift_type_id: Number(shiftTypeId),
      effective_from: effectiveFrom,
      // Sent even when blank: re-saving the same start date with the field cleared is how an
      // end date gets REMOVED, so omitting it would make an open-ended assignment unreachable.
      effective_to: effectiveTo || null,
    }).then((r) => r.data),
    onSuccess: () => { invalidate(); toast.success('Shift assigned'); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to assign the shift'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/shifts/assignments/${id}`),
    onSuccess: () => { invalidate(); toast.success('Assignment removed'); setConfirmDel(null); },
    onError: (e: any) => { toast.error(e.response?.data?.error || 'Failed to remove'); setConfirmDel(null); },
  });

  const selected = activeShifts.find((s: any) => String(s.id) === shiftTypeId);
  const canSubmit = !!shiftTypeId && !!effectiveFrom;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card rounded-xl border border-border shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h3 className="text-base font-semibold text-foreground">
              {employee.first_name} {employee.last_name}
            </h3>
            <p className="text-xs text-secondary">
              {employee.employee_code} · {employee.designation || 'No designation'} · {employee.branch_name || 'No property'}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-secondary hover:text-foreground hover:bg-muted transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Shift<span className="text-red-600"> *</span></label>
              <select className={inputCls} value={shiftTypeId} onChange={(e) => setShiftTypeId(e.target.value)}>
                <option value="">Select a shift…</option>
                {activeShifts.map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({(s.start_time ?? '').slice(0, 5)}–{(s.end_time ?? '').slice(0, 5)})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">From<span className="text-red-600"> *</span></label>
              <input type="date" className={inputCls} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-foreground">
                To <span className="text-xs font-normal text-secondary">(optional)</span>
              </label>
              {effectiveTo && (
                <button type="button" onClick={() => setEffectiveTo('')} className="text-xs text-secondary hover:text-foreground">
                  Clear
                </button>
              )}
            </div>
            <input
              type="date" className={inputCls} value={effectiveTo} min={effectiveFrom || undefined}
              onChange={(e) => setEffectiveTo(e.target.value)}
            />
            <p className="text-xs text-secondary mt-1">
              {effectiveTo
                ? <>On this shift up to and including <span className="text-foreground font-medium">{effectiveTo}</span>. After that they fall back to whichever assignment covers the date, or to their leave plan&apos;s work week if none does.</>
                : <>Leave blank to stay on this shift until another assignment replaces it.</>}
            </p>
          </div>

          {selected && (
            <div className="rounded-lg bg-muted/40 px-3 py-2.5 text-sm space-y-1">
              <p className="text-secondary">
                Full day at <span className="text-foreground font-medium">{Number(selected.full_day_hours) || 0}h</span>,
                {' '}half day below <span className="text-foreground font-medium">{Number(selected.half_day_hours) || 0}h</span>,
                {' '}absent below <span className="text-foreground font-medium">{Number(selected.absent_hours) || 0}h</span>
              </p>
              {selected.ends_next_day && <p className="text-purple-600 text-xs">This shift ends the next day.</p>}
            </div>
          )}

          <p className="text-xs text-secondary">
            Timings, grace and hour thresholds all follow from the shift; off days come from the employee&apos;s
            leave template. Assigning from a date keeps past months resolving to the shift the person was
            actually on.
          </p>

          <div className="pt-2 border-t border-border">
            <h4 className="flex items-center gap-1.5 text-sm font-medium text-foreground mb-2">
              <History size={14} /> Shift history
            </h4>
            {histLoading ? (
              <p className="text-sm text-secondary">Loading…</p>
            ) : history.length === 0 ? (
              <p className="text-sm text-secondary">No shift has been assigned yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {history.map((h: any) => (
                  <li key={h.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="text-secondary tabular-nums">
                        {String(h.effective_from).slice(0, 10)}
                        {/* An end date that only appeared in the form would be invisible the moment
                            it was saved, so the window is spelled out here too. */}
                        {h.effective_to ? ` → ${String(h.effective_to).slice(0, 10)}` : ' →'}
                      </span>
                      <span className="font-medium text-foreground">{h.shift_name}</span>
                      <span className="text-xs text-secondary">
                        {(h.start_time ?? '').slice(0, 5)}–{(h.end_time ?? '').slice(0, 5)}
                      </span>
                      {h.effective_to && (
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-secondary">Ends</span>
                      )}
                    </span>
                    <button
                      onClick={() => setConfirmDel(h)}
                      className="p-1 rounded text-secondary hover:text-red-600 hover:bg-red-50 transition-colors"
                      title="Remove this assignment"
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors">
            Close
          </button>
          <button
            onClick={() => assign.mutate()}
            disabled={!canSubmit || assign.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {assign.isPending && <Loader2 size={14} className="animate-spin" />} Assign shift
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmDel}
        title="Remove this assignment?"
        message={confirmDel ? (
          <>Remove <span className="font-medium text-foreground">{confirmDel.shift_name}</span> from{' '}
            {String(confirmDel.effective_from).slice(0, 10)}? The employee keeps whichever earlier assignment remains.</>
        ) : undefined}
        confirmLabel="Remove"
        danger
        loading={remove.isPending}
        onConfirm={() => confirmDel && remove.mutate(confirmDel.id)}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  );
}

export default function ShiftAssignmentsPage() {
  const { can } = useAuth();
  const canAssign = can('shifts', 'create');
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search, 300);
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [property, setProperty] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<any | null>(null);
  const [showBulk, setShowBulk] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Properties for the filter dropdown; the option value is the property NAME, since employees
  // belong to a property by their plain-text branch_name (same as the Employees page).
  const { data: properties = [] } = useQuery({
    queryKey: ['properties-lookup'],
    queryFn: () => api.get('/admin/properties').then((r) => r.data).catch(() => []),
  });

  const listParams = () => {
    const p = new URLSearchParams();
    if (debounced) p.set('search', debounced);
    if (property) p.set('property', property);
    if (unassignedOnly) p.set('unassigned', 'true');
    return p;
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['shift-assignments', debounced, unassignedOnly, property, page],
    queryFn: () => {
      const p = listParams();
      p.set('page', String(page));
      p.set('pageSize', String(PAGE_SIZE));
      return api.get(`/shifts/assignments?${p}`).then((r) => r.data);
    },
    placeholderData: (prev) => prev,
  });
  const rows: any[] = data?.data ?? [];
  const total: number = data?.total ?? 0;

  // Accurate "N without a shift" across ALL pages (not just the current one).
  const { data: unassignedData } = useQuery({
    queryKey: ['shift-assignments-unassigned-count', debounced, property],
    queryFn: () => {
      const p = listParams();
      p.set('unassigned', 'true');
      p.set('page', '1');
      p.set('pageSize', '1');
      return api.get(`/shifts/assignments?${p}`).then((r) => r.data);
    },
  });
  const unassignedCount: number = unassignedData?.total ?? 0;

  // Any filter or search change resets to page 1, so you never land on an empty page.
  useEffect(() => { setPage(1); }, [debounced, unassignedOnly, property]);

  // No network call, so nothing to fail and no loading state — unlike handleExport below.
  function downloadSample() {
    const url = URL.createObjectURL(new Blob([`${SAMPLE_CSV_HEADERS}\n`], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Shift_Assignments_Sample.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleExport() {
    setExporting(true);
    try {
      const res = await api.get(`/shifts/assignments/export?${listParams()}`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `Shift_Assignments_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Export downloaded');
    } catch {
      toast.error('Failed to export shift assignments');
    } finally {
      setExporting(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <Breadcrumb items={[{ label: 'Shift Management' }, { label: 'Shift Assignments' }]} />

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Shift Assignments</h1>
            <p className="text-secondary mt-1">
              Put each employee on a shift. Their timings and hour thresholds follow from it; their off days come from their leave template.
            </p>
          </div>
          {/* Left to right, the order the job runs in: get a blank file, get today's data, upload.
              The sample is behind canAssign because a blank import template is no use to someone
              who cannot import; Export stays open, since reading the data is its own reason. */}
          <div className="flex items-center gap-2">
            {canAssign && (
              <button
                onClick={downloadSample}
                title="Download a blank CSV with the columns the upload requires"
                className="inline-flex items-center gap-2 px-4 py-2 bg-card border border-border text-foreground rounded-lg text-sm font-medium hover:bg-muted"
              >
                <FileDown size={16} /> Download Sample
              </button>
            )}
            <button
              onClick={handleExport}
              disabled={exporting}
              className="inline-flex items-center gap-2 px-4 py-2 bg-card border border-border text-foreground rounded-lg text-sm font-medium hover:bg-muted disabled:opacity-60"
            >
              <Download size={16} /> {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
            {canAssign && (
              <button
                onClick={() => setShowBulk(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90"
              >
                <Upload size={16} /> Bulk Upload
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or code…"
              className={`${inputCls} pl-9`}
            />
          </div>
          <select
            value={property}
            onChange={(e) => setProperty(e.target.value)}
            className="px-3 py-2 border border-border rounded-lg bg-background text-sm"
          >
            <option value="">All properties</option>
            {properties.map((p: any) => (
              <option key={p.id} value={p.name}>{p.name}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 px-3 py-2 text-sm text-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={unassignedOnly}
              onChange={(e) => setUnassignedOnly(e.target.checked)}
              className="rounded border-border"
            />
            Only those without a shift
          </label>
          {!unassignedOnly && unassignedCount > 0 && (
            <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
              {unassignedCount} without a shift
            </span>
          )}
        </div>

        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {isError ? (
            <LoadError message="Couldn't load shift assignments." onRetry={() => refetch()} />
          ) : isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                <Clock className="w-6 h-6 text-primary" />
              </div>
              <p className="text-sm font-medium text-foreground">No employees found</p>
              <p className="text-sm text-secondary mt-1">
                {unassignedOnly ? 'Everyone has a shift assigned.' : 'Try a different search.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-secondary">
                    <th className="px-4 py-3 font-medium">Employee</th>
                    <th className="px-4 py-3 font-medium">Property</th>
                    <th className="px-4 py-3 font-medium">Shift</th>
                    <th className="px-4 py-3 font-medium">From</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r: any) => (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{r.first_name} {r.last_name}</p>
                        <p className="text-xs text-secondary">{r.employee_code} · {r.designation || '—'}</p>
                      </td>
                      <td className="px-4 py-3 text-secondary">{r.branch_name || '—'}</td>
                      <td className="px-4 py-3">
                        {r.current ? <ShiftLabel s={r.current} /> : (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                            No shift
                          </span>
                        )}
                        {r.upcoming && (
                          <p className="text-xs text-secondary mt-0.5">
                            → {r.upcoming.shift_name} from {String(r.upcoming.effective_from).slice(0, 10)}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-secondary tabular-nums">
                        {r.current ? String(r.current.effective_from).slice(0, 10) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end">
                          {canAssign && (
                            <button
                              onClick={() => setEditing(r)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/5 rounded-lg transition-colors"
                            >
                              <UserCog size={13} /> {r.current ? 'Change' : 'Assign'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!isLoading && !isError && total > 0 && (
          <Pagination
            total={total}
            page={page}
            pageSize={PAGE_SIZE}
            shown={rows.length}
            itemLabel="employees"
            onPageChange={setPage}
          />
        )}
      </div>

      {editing && <AssignDialog employee={editing} onClose={() => setEditing(null)} />}
      {showBulk && <BulkUploadDialog onClose={() => setShowBulk(false)} />}
    </AppShell>
  );
}

/** Bulk-assign employees to shifts from a CSV. Mirrors the Employees bulk-upload dialog. */
function BulkUploadDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<any | null>(null);

  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.post('/shifts/assignments/bulk-upload', fd).then((r) => r.data);
    },
    onSuccess: (data) => {
      setResult(data);
      qc.invalidateQueries({ queryKey: ['shift-assignments'] });
      qc.invalidateQueries({ queryKey: ['shift-assignments-unassigned-count'] });
      toast.success(`${data.created} assigned, ${data.updated} updated${data.skipped ? `, ${data.skipped} skipped` : ''}`);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Bulk upload failed'),
  });

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setResult(null); upload.mutate(file); }
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-card rounded-xl border border-border w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <h3 className="font-semibold text-foreground">Bulk assign shifts</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          {/* Two files, two jobs — they used to compete, because the export was called "the
              template" and was the only thing on offer. */}
          <p className="text-sm text-secondary">
            Upload a CSV to put employees on shifts. Each row is matched by{' '}
            <span className="font-medium text-foreground">Employee Code</span> and assigned from the effective date.
            Start from <span className="font-medium text-foreground">Download Sample</span> for an empty file with
            just these columns, or <span className="font-medium text-foreground">Export CSV</span> to work from who
            is on what today.
          </p>
          <div className="rounded-lg bg-muted/50 border border-border p-3">
            <p className="text-xs font-medium text-foreground mb-1">Columns</p>
            <p className="text-xs text-secondary leading-relaxed">
              <span className="font-medium">Required:</span> Employee Code, Shift (name), Effective From (yyyy-mm-dd).
              A row with a blank date, an unknown shift, or one that would change a locked payroll month is skipped and reported.
            </p>
          </div>

          <input ref={fileRef} type="file" accept=".csv" onChange={onFile} className="hidden" />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={upload.isPending}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {upload.isPending ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {upload.isPending ? 'Processing…' : 'Choose CSV file'}
          </button>

          {result && (
            <div className="rounded-lg border border-border p-3 text-sm space-y-2">
              <p className="font-medium text-foreground">{result.total} rows processed</p>
              <div className="flex flex-wrap gap-4 text-xs">
                <span className="text-green-600">{result.created} assigned</span>
                <span className="text-blue-600">{result.updated} updated</span>
                {result.skipped > 0 && <span className="text-yellow-600">{result.skipped} skipped</span>}
              </div>
              {result.errors?.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-secondary">{result.errors.length} row error(s)</span>
                    <button onClick={() => copyErrors(result.errors)} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"><Copy size={12} /> Copy errors</button>
                  </div>
                  <div className="max-h-40 overflow-y-auto rounded bg-red-50 border border-red-200 p-2">
                    {result.errors.map((err: string, i: number) => (
                      <p key={i} className="text-xs text-red-700">{err}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
