'use client';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import AppShell from '@/components/layout/AppShell';
import {
  FileSpreadsheet, ChevronDown, ChevronRight, Download,
  Users, CheckCircle, XCircle, Clock, ArrowLeft, History,
} from 'lucide-react';
import Breadcrumb from '@/components/ui/Breadcrumb';
import { ATTENDANCE_CODES, ATTENDANCE_STATUSES, CODE_BY_STATUS } from '@/lib/attendanceCodes';
import { errorFromBlob } from '@/lib/utils';

const fmtDateTime = (s?: string) => {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? s : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// '' is "all"; 'unmarked' is a day with no record at all, not a stored status. Everything between
// comes from the shared code list, so this can't drift from what the server buckets.
type StatusFilter = '' | (typeof ATTENDANCE_STATUSES)[number] | 'unmarked';

export default function AdminAttendancePage() {
  const qc = useQueryClient();
  const gridRef = useRef<HTMLInputElement>(null);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [expandedProperty, setExpandedProperty] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [showHistory, setShowHistory] = useState(false);

  /**
   * Fetch the blank marked grid for the selected month and save it.
   *
   * Goes through `api` rather than a plain link so the session cookie and the API base URL are
   * applied — a bare href would hit the Next.js origin unauthenticated and download the login page.
   */
  async function downloadTemplate() {
    const month = selectedDate.slice(0, 7);
    try {
      const res = await api.get(`/attendance/admin/template/marked-grid?month=${month}`, { responseType: 'blob' });
      const href = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `attendance_grid_${month}.csv`;
      a.click();
      URL.revokeObjectURL(href);
    } catch (err: any) {
      toast.error((await errorFromBlob(err)) || 'Could not download the template');
    }
  }

  const { data: uploadLogs = [] } = useQuery({
    queryKey: ['attendance-upload-logs'],
    queryFn: () => api.get('/attendance/admin/upload-logs').then(r => r.data),
    enabled: showHistory,
  });

  const { data: dates = [] } = useQuery({
    queryKey: ['attendance-dates'],
    queryFn: () => api.get('/attendance/admin/dates').then(r => r.data),
  });

  const { data: summary, isLoading } = useQuery({
    queryKey: ['attendance-property-summary', selectedDate],
    queryFn: () => api.get(`/attendance/admin/property-summary?date=${selectedDate}`).then(r => r.data),
    enabled: !!selectedDate,
  });

  const { data: employees = [], isLoading: empLoading } = useQuery({
    queryKey: ['attendance-property-employees', selectedDate, expandedProperty, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams({ date: selectedDate, property: expandedProperty! });
      if (statusFilter) params.set('status', statusFilter);
      return api.get(`/attendance/admin/property-employees?${params}`).then(r => r.data);
    },
    enabled: !!expandedProperty,
  });

  // Marked-grid dashboard upload (wide sheet of day-codes). The month for bare
  // day-number headers comes from the selected date, so HR uploads the sheet as-is.
  const gridMutation = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('month', selectedDate.slice(0, 7));
      return api.post('/attendance/upload-grid', fd).then(r => r.data);
    },
    onSuccess: (data) => {
      setUploadResult(data);
      qc.invalidateQueries({ queryKey: ['attendance-property-summary'] });
      qc.invalidateQueries({ queryKey: ['attendance-property-employees'] });
      qc.invalidateQueries({ queryKey: ['attendance-dates'] });
      qc.invalidateQueries({ queryKey: ['attendance-upload-logs'] });
      toast.success(`${data.created + data.updated} day-marks processed`);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Grid upload failed'),
  });

  function handleGridUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) { setUploadResult(null); gridMutation.mutate(file); }
    if (gridRef.current) gridRef.current.value = '';
  }

  const properties = summary?.properties || [];

  // Summed over the shared code list, so a code added there is totalled here without an edit.
  const grandTotal: Record<string, number> = properties.reduce((a: any, p: any) => {
    const next: any = { total: a.total + Number(p.total || 0) };
    for (const s of ATTENDANCE_STATUSES) next[s] = a[s] + Number(p[s] || 0);
    return next;
  }, { total: 0, ...Object.fromEntries(ATTENDANCE_STATUSES.map((s) => [s, 0])) });

  return (
    <AppShell>
      <div className="space-y-6">
        <Breadcrumb items={[{ label: 'Admin', href: '/admin' }, { label: 'Attendance' }]} />
        <div>
          <h1 className="text-2xl font-bold text-foreground">Attendance Admin</h1>
          <p className="text-secondary mt-1">Property-level attendance overview</p>
        </div>

        {/* Upload Section */}
        <div className="bg-card rounded-xl border border-border p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileSpreadsheet size={20} className="text-primary" />
              <div>
                <h3 className="text-sm font-semibold text-foreground">Upload Attendance File</h3>
                <p className="text-xs text-secondary mt-0.5">
                  <span className="font-medium">Marked grid (.xlsx/.csv):</span> one row per employee, one column per date, cells coded P / NP / A / HD / SP / MP / HHD — imported for <span className="font-medium">{selectedDate.slice(0, 7)}</span>
                </p>
                <p className="text-xs text-secondary mt-0.5">
                  Weekly offs, holidays and approved leave come from the calendar — leave those cells blank.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* One importer left, so one template — a menu offering a single choice is just an
                  extra click. */}
              <button
                onClick={() => downloadTemplate()}
                title="Download a blank grid for the selected month, pre-filled with the employee list"
                className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
              >
                <Download size={15} /> Template
              </button>
              <input ref={gridRef} type="file" accept=".xlsx,.xlsm,.csv" onChange={handleGridUpload} className="hidden" />
              <button
                onClick={() => gridRef.current?.click()}
                disabled={gridMutation.isPending}
                title="Import HR's marked attendance dashboard for the selected month"
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                <FileSpreadsheet size={16} />
                {gridMutation.isPending ? 'Importing…' : 'Upload Marked Grid'}
              </button>
            </div>
          </div>

          {uploadResult && (
            <div className="mt-4 p-3 bg-muted rounded-lg text-sm space-y-1">
              <p className="font-medium text-foreground">
                Upload complete: {uploadResult.total} rows processed
              </p>
              <div className="flex flex-wrap gap-4 text-xs text-secondary">
                <span className="text-green-600">{uploadResult.created} created</span>
                <span className="text-blue-600">{uploadResult.updated} updated</span>
                {uploadResult.skipped > 0 && <span className="text-yellow-600">{uploadResult.skipped} skipped</span>}
              </div>
              {uploadResult.unmatched?.length > 0 && (
                <p className="text-xs text-red-600">Unmatched employee codes: {uploadResult.unmatched.join(', ')}</p>
              )}
              {uploadResult.unrecognized?.length > 0 && (
                <p className="text-xs text-amber-600">Unrecognised marks (ignored): {uploadResult.unrecognized.join(', ')}</p>
              )}
              {uploadResult.locked_months?.length > 0 && (
                <p className="text-xs text-yellow-600">Skipped locked month(s): {uploadResult.locked_months.join(', ')}</p>
              )}
            </div>
          )}
        </div>

        {/* Upload History */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <button
            onClick={() => setShowHistory(v => !v)}
            className="w-full flex items-center gap-3 px-5 py-4 hover:bg-muted/30 transition-colors"
          >
            {showHistory ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
            <History size={18} className="text-primary" />
            <span className="text-sm font-semibold text-foreground flex-1 text-left">Upload History</span>
            <span className="text-xs text-secondary">Attendance upload log</span>
          </button>

          {showHistory && (
            <div className="border-t border-border overflow-x-auto">
              {uploadLogs.length === 0 ? (
                <p className="text-center py-8 text-sm text-secondary">No attendance uploads recorded yet.</p>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/20">
                      <th className="text-left px-5 py-2.5 text-xs font-medium text-secondary uppercase">Uploaded At</th>
                      <th className="text-left px-5 py-2.5 text-xs font-medium text-secondary uppercase">By</th>
                      <th className="text-left px-5 py-2.5 text-xs font-medium text-secondary uppercase">File</th>
                      <th className="text-left px-5 py-2.5 text-xs font-medium text-secondary uppercase">Attendance Dates</th>
                      <th className="text-left px-5 py-2.5 text-xs font-medium text-secondary uppercase">Rows</th>
                      <th className="text-left px-5 py-2.5 text-xs font-medium text-secondary uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {uploadLogs.map((log: any) => (
                      <tr key={log.id} className="hover:bg-muted/20">
                        <td className="px-5 py-2.5 text-sm font-medium text-foreground whitespace-nowrap">{fmtDateTime(log.created_at)}</td>
                        <td className="px-5 py-2.5 text-sm text-secondary">{log.uploaded_by_email || '—'}</td>
                        <td className="px-5 py-2.5 text-sm text-secondary">{log.file_name || '—'}</td>
                        <td className="px-5 py-2.5 text-sm text-secondary whitespace-nowrap">
                          {log.dates_count > 0
                            ? (log.date_from === log.date_to ? log.date_from : `${log.date_from} → ${log.date_to}`)
                            : '—'}
                          {log.dates_count > 1 && <span className="text-xs text-secondary"> ({log.dates_count} days)</span>}
                        </td>
                        <td className="px-5 py-2.5 text-sm text-secondary">
                          <span className="text-green-600">{log.rows_created} new</span>
                          {', '}<span className="text-blue-600">{log.rows_updated} upd</span>
                          {log.rows_skipped > 0 && <>{', '}<span className="text-yellow-600">{log.rows_skipped} skip</span></>}
                        </td>
                        <td className="px-5 py-2.5"><UploadStatusBadge status={log.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">Date</label>
            <input
              type="date"
              value={selectedDate}
              onChange={e => { setSelectedDate(e.target.value); setExpandedProperty(null); }}
              className="px-3 py-2 border border-border rounded-lg bg-background text-sm"
            />
          </div>
          {summary && (
            <div className="ml-auto text-right">
              <p className="text-xs text-secondary">Attendance marked</p>
              <p className="text-lg font-bold text-foreground">{summary.total_marked} / {summary.total_active}</p>
            </div>
          )}
        </div>

        {/* Grand totals — all eight codes, so the strip adds up to Total Marked. It used to show
            four, which meant HHD, SP, MP and NP days were counted in the total and nowhere else. */}
        {properties.length > 0 && (
          <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-3">
            <div className="bg-card rounded-xl border border-border p-4 flex items-center gap-3">
              <Users size={20} className="text-primary shrink-0" />
              <div>
                <p className="text-xs font-medium text-secondary">Total Marked</p>
                <p className="text-xl font-bold text-foreground">{grandTotal.total}</p>
              </div>
            </div>
            {ATTENDANCE_CODES.map((c) => (
              <div key={c.code} className="bg-card rounded-xl border border-border p-4">
                <p className="text-xs font-medium text-secondary">{c.label}</p>
                <p className={`text-xl font-bold ${grandTotal[c.code] > 0 ? c.tone : 'text-secondary/40'}`}>
                  {grandTotal[c.code]}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Property Breakdown */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : properties.length === 0 ? (
          <div className="bg-card rounded-xl border border-border p-12 text-center">
            <p className="text-secondary">No attendance data for {selectedDate}</p>
            <p className="text-xs text-secondary mt-1">Upload a CSV to populate attendance records</p>
          </div>
        ) : (
          <div className="space-y-3">
            {properties.map((prop: any) => {
              const isExpanded = expandedProperty === prop.branch_name;
              return (
                <div key={prop.branch_name} className="bg-card rounded-xl border border-border overflow-hidden">
                  {/* Property Header */}
                  <button
                    onClick={() => {
                      setExpandedProperty(isExpanded ? null : prop.branch_name);
                      setStatusFilter('');
                    }}
                    className="w-full flex items-center gap-4 px-5 py-4 hover:bg-muted/30 transition-colors"
                  >
                    {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    <span className="text-sm font-semibold text-foreground flex-1 text-left">
                      {prop.branch_name || 'Unassigned'}
                    </span>
                    {/* All eight codes. HHD and NP had no dot at all, so a property could show
                        six numbers that did not reach its own total. */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                      {ATTENDANCE_CODES.map((c) => (
                        <span key={c.code} className="flex items-center gap-1">
                          <span className={`w-2 h-2 rounded-full ${c.dot}`} />
                          <span className="font-medium">{Number(prop[c.code] || 0)}</span>
                          <span className="text-secondary">{c.badge}</span>
                        </span>
                      ))}
                      <span className="text-secondary font-medium">
                        {prop.total} total &middot; {prop.avg_hours || 0}h avg
                      </span>
                    </div>
                  </button>

                  {/* Expanded Employee List */}
                  {isExpanded && (
                    <div className="border-t border-border">
                      {/* Status Filter */}
                      <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center gap-2">
                        <span className="text-xs text-secondary mr-1">Filter:</span>
                        {([
                          { value: '' as StatusFilter, label: 'All' },
                          ...ATTENDANCE_CODES.map((c) => ({ value: c.code as StatusFilter, label: c.label })),
                          // Not a status — a day with no record at all, resolved by the pay
                          // schedule's unmarked_day_policy rather than stored on the row.
                          { value: 'unmarked' as StatusFilter, label: 'Unmarked' },
                        ]).map(opt => (
                          <button
                            key={opt.value}
                            onClick={() => setStatusFilter(opt.value)}
                            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                              statusFilter === opt.value
                                ? 'bg-primary text-white'
                                : 'bg-background border border-border text-secondary hover:text-foreground'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>

                      {empLoading ? (
                        <div className="flex justify-center py-8">
                          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                        </div>
                      ) : employees.length === 0 ? (
                        <p className="text-center py-6 text-sm text-secondary">No employees match this filter</p>
                      ) : (
                        <table className="w-full">
                          <thead>
                            <tr className="border-b border-border bg-muted/20">
                              <th className="text-left px-5 py-2.5 text-xs font-medium text-secondary uppercase">Emp Code</th>
                              <th className="text-left px-5 py-2.5 text-xs font-medium text-secondary uppercase">Name</th>
                              <th className="text-left px-5 py-2.5 text-xs font-medium text-secondary uppercase">Department</th>
                              <th className="text-left px-5 py-2.5 text-xs font-medium text-secondary uppercase">Designation</th>
                              <th className="text-left px-5 py-2.5 text-xs font-medium text-secondary uppercase">Location</th>
                              <th className="text-left px-5 py-2.5 text-xs font-medium text-secondary uppercase">Status</th>
                              <th className="text-left px-5 py-2.5 text-xs font-medium text-secondary uppercase">Check In</th>
                              <th className="text-left px-5 py-2.5 text-xs font-medium text-secondary uppercase">Check Out</th>
                              <th className="text-left px-5 py-2.5 text-xs font-medium text-secondary uppercase">Hours</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {employees.map((emp: any) => (
                              <tr key={emp.id} className="hover:bg-muted/20">
                                <td className="px-5 py-2.5 text-sm font-medium text-foreground">{emp.employee_code}</td>
                                <td className="px-5 py-2.5 text-sm text-foreground">{emp.first_name} {emp.last_name}</td>
                                <td className="px-5 py-2.5 text-sm text-secondary">{emp.dept_name || '—'}</td>
                                <td className="px-5 py-2.5 text-sm text-secondary">{emp.designation || '—'}</td>
                                <td className="px-5 py-2.5 text-sm text-secondary">{emp.location || '—'}</td>
                                <td className="px-5 py-2.5">
                                  <StatusBadge status={emp.status} />
                                </td>
                                <td className="px-5 py-2.5 text-sm text-secondary">
                                  {emp.check_in && !emp.check_in.includes('NA') ? emp.check_in.split(' ')[1]?.slice(0, 5) : '—'}
                                </td>
                                <td className="px-5 py-2.5 text-sm text-secondary">
                                  {emp.check_out && !emp.check_out.includes('NA') ? emp.check_out.split(' ')[1]?.slice(0, 5) : '—'}
                                </td>
                                <td className="px-5 py-2.5 text-sm text-secondary">
                                  {emp.working_hours ? `${emp.working_hours}h` : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      <div className="px-5 py-2 border-t border-border bg-muted/20">
                        <p className="text-xs text-secondary">{employees.length} employees shown</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function UploadStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    success: 'bg-green-100 text-green-700',
    partial: 'bg-yellow-100 text-yellow-700',
    failed: 'bg-red-100 text-red-700',
  };
  return <span className={`text-xs px-2 py-1 rounded-full font-medium capitalize ${map[status] || 'bg-gray-100 text-gray-500'}`}>{status}</span>;
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-500">Unmarked</span>;
  // Colours and wording come from the shared definition — this page used to say HHD in lime while
  // the employee's own calendar said the same day in teal, and called it "HHD" rather than naming it.
  const meta = CODE_BY_STATUS[status];
  return (
    <span className={`text-xs px-2 py-1 rounded-full ${meta ? `${meta.badgeBg} ${meta.badgeText}` : 'bg-gray-100 text-gray-500'}`}>
      {meta?.label ?? status}
    </span>
  );
}
