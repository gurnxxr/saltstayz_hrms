'use client';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import AppShell from '@/components/layout/AppShell';
import {
  Upload, FileSpreadsheet, ChevronDown, ChevronRight,
  Users, CheckCircle, XCircle, Clock, ArrowLeft, History,
} from 'lucide-react';

const fmtDateTime = (s?: string) => {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? s : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

type StatusFilter = '' | 'present' | 'absent' | 'half_day' | 'on_leave' | 'unmarked';

export default function AdminAttendancePage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [expandedProperty, setExpandedProperty] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [showHistory, setShowHistory] = useState(false);

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

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.post('/attendance/upload', fd).then(r => r.data);
    },
    onSuccess: (data) => {
      setUploadResult(data);
      qc.invalidateQueries({ queryKey: ['attendance-property-summary'] });
      qc.invalidateQueries({ queryKey: ['attendance-property-employees'] });
      qc.invalidateQueries({ queryKey: ['attendance-dates'] });
      qc.invalidateQueries({ queryKey: ['attendance-upload-logs'] });
      toast.success(`${data.created + data.updated} records processed`);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Upload failed'),
  });

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) { setUploadResult(null); uploadMutation.mutate(file); }
    if (fileRef.current) fileRef.current.value = '';
  }

  const properties = summary?.properties || [];

  const grandTotal = properties.reduce((a: any, p: any) => ({
    total: a.total + p.total,
    present: a.present + p.present,
    absent: a.absent + p.absent,
    half_day: a.half_day + p.half_day,
    on_leave: a.on_leave + p.on_leave,
  }), { total: 0, present: 0, absent: 0, half_day: 0, on_leave: 0 });

  return (
    <AppShell>
      <div className="space-y-6">
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
                  CSV: Emp Code, Access Date (dd-mm-yy), First_In_time (hh:mm), Last_Out_time (hh:mm), Location (optional — property/site)
                </p>
              </div>
            </div>
            <div>
              <input ref={fileRef} type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploadMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                <Upload size={16} />
                {uploadMutation.isPending ? 'Processing...' : 'Upload CSV'}
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
                <p className="text-xs text-red-600">Unmatched codes: {uploadResult.unmatched.join(', ')}</p>
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

        {/* Grand Total Cards */}
        {properties.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="bg-card rounded-xl border border-border p-4 flex items-center gap-3">
              <Users size={20} className="text-primary" />
              <div>
                <p className="text-xs font-medium text-secondary">Total Marked</p>
                <p className="text-xl font-bold text-foreground">{grandTotal.total}</p>
              </div>
            </div>
            <div className="bg-card rounded-xl border border-border p-4 flex items-center gap-3">
              <CheckCircle size={20} className="text-green-600" />
              <div>
                <p className="text-xs font-medium text-secondary">Present</p>
                <p className="text-xl font-bold text-green-600">{grandTotal.present}</p>
              </div>
            </div>
            <div className="bg-card rounded-xl border border-border p-4 flex items-center gap-3">
              <XCircle size={20} className="text-red-600" />
              <div>
                <p className="text-xs font-medium text-secondary">Absent</p>
                <p className="text-xl font-bold text-red-600">{grandTotal.absent}</p>
              </div>
            </div>
            <div className="bg-card rounded-xl border border-border p-4 flex items-center gap-3">
              <Clock size={20} className="text-yellow-600" />
              <div>
                <p className="text-xs font-medium text-secondary">Half Day</p>
                <p className="text-xl font-bold text-yellow-600">{grandTotal.half_day}</p>
              </div>
            </div>
            <div className="bg-card rounded-xl border border-border p-4 flex items-center gap-3">
              <ArrowLeft size={20} className="text-blue-600" />
              <div>
                <p className="text-xs font-medium text-secondary">On Leave</p>
                <p className="text-xl font-bold text-blue-600">{grandTotal.on_leave}</p>
              </div>
            </div>
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
                    <div className="flex items-center gap-5 text-xs">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-green-500" />
                        <span className="font-medium">{prop.present}</span>
                        <span className="text-secondary">P</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-red-500" />
                        <span className="font-medium">{prop.absent}</span>
                        <span className="text-secondary">A</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-yellow-500" />
                        <span className="font-medium">{prop.half_day}</span>
                        <span className="text-secondary">HD</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-blue-500" />
                        <span className="font-medium">{prop.on_leave}</span>
                        <span className="text-secondary">L</span>
                      </span>
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
                          { value: 'present' as StatusFilter, label: 'Present' },
                          { value: 'absent' as StatusFilter, label: 'Absent' },
                          { value: 'half_day' as StatusFilter, label: 'Half Day' },
                          { value: 'on_leave' as StatusFilter, label: 'On Leave' },
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
  const map: Record<string, string> = {
    present: 'bg-green-100 text-green-700',
    absent: 'bg-red-100 text-red-700',
    half_day: 'bg-yellow-100 text-yellow-700',
    on_leave: 'bg-blue-100 text-blue-700',
  };
  const labels: Record<string, string> = {
    present: 'Present',
    absent: 'Absent',
    half_day: 'Half Day',
    on_leave: 'On Leave',
  };
  return (
    <span className={`text-xs px-2 py-1 rounded-full ${map[status] || 'bg-gray-100 text-gray-500'}`}>
      {labels[status] || status}
    </span>
  );
}
