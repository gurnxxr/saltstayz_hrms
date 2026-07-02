'use client';

import { useState, useEffect, useRef, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import LoadError from '@/components/ui/LoadError';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import {
  Search, Users, Filter, Eye, ChevronDown, ChevronLeft, ChevronRight, Upload, X, History, Copy,
} from 'lucide-react';

const PAGE_SIZE = 10;

export default function EmployeeDetailsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canEditStatus = user?.roleName === 'admin' || user?.roleName === 'hr' || user?.roleName === 'chro';
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [statusFilter, setStatusFilter] = useState('active');
  const [page, setPage] = useState(1);
  const [deactivateTarget, setDeactivateTarget] = useState<any>(null);
  const [showBulk, setShowBulk] = useState(false);
  const [bulkResult, setBulkResult] = useState<any>(null);
  const bulkFileRef = useRef<HTMLInputElement>(null);

  const bulkUpload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.post('/employees/bulk-upload', fd).then(r => r.data);
    },
    onSuccess: (data) => {
      setBulkResult(data);
      queryClient.invalidateQueries({ queryKey: ['employees-list'] });
      queryClient.invalidateQueries({ queryKey: ['employee-upload-logs'] });
      toast.success(`${data.created} added, ${data.updated} updated`);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Bulk upload failed'),
  });

  function handleBulkFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) { setBulkResult(null); bulkUpload.mutate(file); }
    if (bulkFileRef.current) bulkFileRef.current.value = '';
  }

  const toggleStatusMutation = useMutation({
    mutationFn: ({ empId, active }: { empId: number; active: boolean }) =>
      api.put(`/employees/${empId}`, { is_active: active }).then(r => r.data),
    onSuccess: (_data, { active }) => {
      queryClient.invalidateQueries({ queryKey: ['employees-list'] });
      toast.success(`Employee marked as ${active ? 'Active' : 'Inactive'}`);
      setDeactivateTarget(null);
    },
    onError: (err: any) => { toast.error(err.response?.data?.error || 'Status update failed'); setDeactivateTarget(null); },
  });

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: ['employees-list', debouncedSearch, statusFilter, page],
    queryFn: () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (statusFilter) params.set('status', statusFilter);
      params.set('page', String(page));
      params.set('pageSize', String(PAGE_SIZE));
      return api.get(`/employees?${params}`).then(r => r.data);
    },
    placeholderData: (prev) => prev,
  });

  // Reset to first page whenever the filters change
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter]);

  const pageEmployees = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const currentPage = data?.page ?? page;
  const startIdx = (currentPage - 1) * PAGE_SIZE;

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Employee Details</h1>
            <p className="text-secondary mt-1">View and manage all employees</p>
          </div>
          {canEditStatus && (
            <button
              onClick={() => { setBulkResult(null); setShowBulk(true); }}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90"
            >
              <Upload size={16} /> Bulk Upload
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, code, or email..."
              className="w-full pl-9 pr-3 py-2.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div className="relative">
            <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="pl-8 pr-8 py-2.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none"
            >
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-secondary pointer-events-none" />
          </div>
        </div>

        {/* Table */}
        {isLoading ? (
          <TableSkeleton />
        ) : isError ? (
          <div className="bg-card rounded-xl border border-border">
            <LoadError message="Couldn't load employees." onRetry={() => refetch()} />
          </div>
        ) : total === 0 ? (
          <div className="bg-card rounded-xl border border-border p-12 text-center">
            <Users size={40} className="mx-auto text-secondary/30 mb-3" />
            <p className="text-secondary">No employees found</p>
          </div>
        ) : (
          <div className={`bg-card rounded-xl border border-border overflow-hidden transition-opacity ${isFetching ? 'opacity-60' : 'opacity-100'}`}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Emp Code</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Emp Name</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Dept Name</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Designation</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Branch Name</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Reporting Manager</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Phone Number</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Email Address</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Status</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-secondary uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pageEmployees.map((emp: any) => {
                    const manager = [emp.manager_first_name, emp.manager_last_name].filter(Boolean).join(' ');
                    return (
                      <tr key={emp.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 text-sm font-medium text-foreground">{emp.employee_code}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">
                              {emp.first_name[0]}{emp.last_name[0]}
                            </div>
                            <span className="text-sm font-medium text-foreground">{emp.first_name} {emp.last_name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">{emp.dept_name || '—'}</td>
                        <td className="px-4 py-3 text-sm text-foreground">{emp.designation_name || '—'}</td>
                        <td className="px-4 py-3 text-sm text-foreground">{emp.branch_name || '—'}</td>
                        <td className="px-4 py-3 text-sm text-foreground">{manager || '—'}</td>
                        <td className="px-4 py-3 text-sm text-foreground">{emp.phone || '—'}</td>
                        <td className="px-4 py-3 text-sm text-foreground">{emp.email || '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {canEditStatus && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (emp.is_active) setDeactivateTarget(emp);
                                  else toggleStatusMutation.mutate({ empId: emp.id, active: true });
                                }}
                                disabled={toggleStatusMutation.isPending}
                                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${emp.is_active ? 'bg-green-500' : 'bg-gray-400'} ${toggleStatusMutation.isPending ? 'opacity-50' : 'cursor-pointer'}`}
                                title={`Click to mark ${emp.is_active ? 'Inactive' : 'Active'}`}
                              >
                                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${emp.is_active ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                              </button>
                            )}
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${emp.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                              {emp.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => router.push(`/employees/${emp.id}`)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5 rounded-lg transition-colors"
                          >
                            <Eye size={14} /> View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-border bg-muted/30">
              <p className="text-xs text-secondary">
                Showing <span className="font-medium text-foreground">{startIdx + 1}</span>–
                <span className="font-medium text-foreground">{startIdx + pageEmployees.length}</span> of{' '}
                <span className="font-medium text-foreground">{total}</span> employees
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-foreground border border-border rounded-lg hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft size={14} /> Prev
                </button>
                {getPageNumbers(currentPage, totalPages).map((p, i) =>
                  p === '...' ? (
                    <span key={`ellipsis-${i}`} className="px-2 text-xs text-secondary">…</span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setPage(p as number)}
                      className={`min-w-[32px] px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                        currentPage === p
                          ? 'bg-primary text-white'
                          : 'text-foreground border border-border hover:bg-muted'
                      }`}
                    >
                      {p}
                    </button>
                  )
                )}
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-foreground border border-border rounded-lg hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </div>
        )}

        {canEditStatus && <UploadHistory />}
      </div>
      <ConfirmDialog
        open={!!deactivateTarget}
        title="Mark employee inactive?"
        message={<><strong className="text-foreground">{deactivateTarget?.first_name} {deactivateTarget?.last_name}</strong> will be moved to Inactive and excluded from active rosters, payroll, and headcount.</>}
        confirmLabel="Mark inactive"
        loading={toggleStatusMutation.isPending}
        onConfirm={() => deactivateTarget && toggleStatusMutation.mutate({ empId: deactivateTarget.id, active: false })}
        onCancel={() => setDeactivateTarget(null)}
      />

      {showBulk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowBulk(false)}>
          <div className="bg-card rounded-xl border border-border w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
              <h3 className="font-semibold text-foreground">Bulk Upload Employees</h3>
              <button onClick={() => setShowBulk(false)} className="p-1 rounded-lg hover:bg-muted"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-secondary">
                Upload a CSV to add or update employees. Existing rows are matched by <span className="font-medium text-foreground">Employee Code</span> and updated; new codes are created.
              </p>
              <div className="rounded-lg bg-muted/50 border border-border p-3">
                <p className="text-xs font-medium text-foreground mb-1">Columns</p>
                <p className="text-xs text-secondary leading-relaxed">
                  <span className="font-medium">Required:</span> Employee Code, First Name.{' '}
                  <span className="font-medium">Optional:</span> Last Name, Email, Phone, Date of Joining (dd-mm-yyyy or yyyy-mm-dd),
                  Date of Birth, Father Name, Aadhaar Number, Department, Branch, Designation (job title), Reporting Manager Code, Status (active/inactive).
                </p>
              </div>

              <input ref={bulkFileRef} type="file" accept=".csv" onChange={handleBulkFile} className="hidden" />
              <button
                onClick={() => bulkFileRef.current?.click()}
                disabled={bulkUpload.isPending}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                <Upload size={16} /> {bulkUpload.isPending ? 'Processing…' : 'Choose CSV file'}
              </button>

              {bulkResult && (
                <div className="rounded-lg border border-border p-3 text-sm space-y-2">
                  <p className="font-medium text-foreground">{bulkResult.total} rows processed</p>
                  <div className="flex flex-wrap gap-4 text-xs">
                    <span className="text-green-600">{bulkResult.created} created</span>
                    <span className="text-blue-600">{bulkResult.updated} updated</span>
                    {bulkResult.skipped > 0 && <span className="text-yellow-600">{bulkResult.skipped} skipped</span>}
                  </div>
                  {bulkResult.errors?.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-secondary">{bulkResult.errors.length} row error(s)</span>
                        <button onClick={() => copyErrors(bulkResult.errors)} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"><Copy size={12} /> Copy errors</button>
                      </div>
                      <div className="max-h-40 overflow-y-auto rounded bg-red-50 border border-red-200 p-2">
                        {bulkResult.errors.map((err: string, i: number) => (
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
      )}
    </AppShell>
  );
}

function getPageNumbers(current: number, total: number): (number | string)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, '...', total];
  if (current >= total - 3) return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
  return [1, '...', current - 1, current, current + 1, '...', total];
}

function fmtDateTime(s?: string) {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? s : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function copyErrors(errors: string[]) {
  navigator.clipboard.writeText((errors || []).join('\n')).then(
    () => toast.success('Errors copied to clipboard'),
    () => toast.error('Copy failed'),
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

// Persisted bulk-upload history — durable record of every run + its skipped-row errors.
function UploadHistory() {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const { data: logs = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['employee-upload-logs'],
    queryFn: () => api.get('/employees/upload-logs').then(r => r.data),
    enabled: open,
  });

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center gap-3 px-5 py-4 hover:bg-muted/30 transition-colors">
        {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        <History size={18} className="text-primary" />
        <span className="text-sm font-semibold text-foreground flex-1 text-left">Upload History</span>
        <span className="text-xs text-secondary">Bulk employee uploads</span>
      </button>
      {open && (
        <div className="border-t border-border">
          {isLoading ? (
            <div className="flex items-center justify-center py-10"><div className="animate-spin rounded-full h-7 w-7 border-b-2 border-primary" /></div>
          ) : isError ? (
            <LoadError compact message="Couldn't load upload history." onRetry={() => refetch()} />
          ) : logs.length === 0 ? (
            <p className="px-5 py-8 text-center text-secondary text-sm">No bulk uploads yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/20">
                    <th className="text-left px-5 py-2.5 text-xs font-medium text-secondary uppercase">Uploaded At</th>
                    <th className="text-left px-5 py-2.5 text-xs font-medium text-secondary uppercase">By</th>
                    <th className="text-left px-5 py-2.5 text-xs font-medium text-secondary uppercase">File</th>
                    <th className="text-left px-5 py-2.5 text-xs font-medium text-secondary uppercase">Rows</th>
                    <th className="text-left px-5 py-2.5 text-xs font-medium text-secondary uppercase">Status</th>
                    <th className="px-5 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {logs.map((log: any) => {
                    const hasErrors = (log.errors?.length ?? 0) > 0 || !!log.error_note;
                    const isOpen = expanded === log.id;
                    return (
                      <Fragment key={log.id}>
                        <tr className="hover:bg-muted/20">
                          <td className="px-5 py-2.5 text-sm font-medium text-foreground whitespace-nowrap">{fmtDateTime(log.created_at)}</td>
                          <td className="px-5 py-2.5 text-sm text-secondary">{log.uploaded_by_email || '—'}</td>
                          <td className="px-5 py-2.5 text-sm text-secondary">{log.file_name || '—'}</td>
                          <td className="px-5 py-2.5 text-sm text-secondary whitespace-nowrap">
                            <span className="text-green-600">{log.rows_created} new</span>{', '}
                            <span className="text-blue-600">{log.rows_updated} upd</span>
                            {log.rows_skipped > 0 && <>{', '}<span className="text-yellow-600">{log.rows_skipped} skip</span></>}
                          </td>
                          <td className="px-5 py-2.5"><UploadStatusBadge status={log.status} /></td>
                          <td className="px-5 py-2.5 text-right">
                            {hasErrors && (
                              <button onClick={() => setExpanded(isOpen ? null : log.id)} className="text-xs font-medium text-primary hover:underline">
                                {isOpen ? 'Hide' : 'View'} errors
                              </button>
                            )}
                          </td>
                        </tr>
                        {isOpen && hasErrors && (
                          <tr>
                            <td colSpan={6} className="px-5 pb-3 bg-muted/10">
                              <div className="flex items-center justify-between mb-1.5">
                                <span className="text-xs font-medium text-secondary">{log.errors?.length || 0} row error(s){log.error_note ? ' · file rejected' : ''}</span>
                                {log.errors?.length > 0 && (
                                  <button onClick={() => copyErrors(log.errors)} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"><Copy size={12} /> Copy errors</button>
                                )}
                              </div>
                              <div className="max-h-48 overflow-y-auto rounded bg-red-50 border border-red-200 p-2">
                                {log.error_note && <p className="text-xs text-red-700 font-medium">{log.error_note}</p>}
                                {(log.errors || []).map((err: string, i: number) => <p key={i} className="text-xs text-red-700">{err}</p>)}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="border-b border-border bg-muted/50 px-4 py-3">
        <div className="h-3 w-32 bg-secondary/15 rounded animate-pulse" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: PAGE_SIZE }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3.5">
            <div className="h-8 w-8 rounded-full bg-secondary/15 animate-pulse shrink-0" />
            <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="h-3 bg-secondary/15 rounded animate-pulse" />
              <div className="h-3 bg-secondary/15 rounded animate-pulse" />
              <div className="h-3 bg-secondary/15 rounded animate-pulse hidden sm:block" />
              <div className="h-3 bg-secondary/15 rounded animate-pulse hidden sm:block" />
            </div>
            <div className="h-6 w-16 bg-secondary/15 rounded-full animate-pulse shrink-0" />
            <div className="h-6 w-14 bg-secondary/15 rounded-lg animate-pulse shrink-0" />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/30">
        <div className="h-3 w-40 bg-secondary/15 rounded animate-pulse" />
        <div className="h-7 w-48 bg-secondary/15 rounded-lg animate-pulse" />
      </div>
    </div>
  );
}
