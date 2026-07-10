'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useAuth } from '@/lib/auth';
import Pagination, { pageSlice } from '@/components/ui/Pagination';
import {
  Search, Plus, Pencil, Trash2, X, Landmark, Users, CircleDollarSign,
  AlertCircle, Download, Eye, EyeOff,
} from 'lucide-react';

const PAYMENT_MODES = ['Bank Transfer', 'Cheque', 'Cash', 'UPI'];
const PAGE_SIZE = 25;

// Masks a sensitive value with password-style dots, mirroring its length.
const DOTS = (s: any) => '•'.repeat(Math.min(Math.max(String(s ?? '').length, 6), 16));

export default function FinancePage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = ['admin', 'chro', 'hr', 'finance'].includes(user?.roleName || '');

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [branchFilter, setBranchFilter] = useState('');
  const [page, setPage] = useState(1);
  // Sensitive financial columns (account no., PAN, IFSC) are masked by default.
  const [reveal, setReveal] = useState(false);

  // Auto-hide whenever the tab/window loses focus, so revealed PII never lingers.
  useEffect(() => {
    const onVisibility = () => { if (document.hidden) setReveal(false); };
    const onBlur = () => setReveal(false);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
  const [editingEmployeeId, setEditingEmployeeId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    employee_id: '',
    account_name: '',
    name_as_per_uid: '',
    bank_account_number: '',
    pan_card: '',
    ifsc_code: '',
    branch_name: '',
    payment_mode: 'Bank Transfer',
  });

  const { data: records = [], isLoading } = useQuery({
    queryKey: ['finance-bank-details', debouncedSearch, branchFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (branchFilter) params.set('branch_name', branchFilter);
      return api.get(`/finance/bank-details?${params}`).then(r => r.data);
    },
  });

  const { data: stats } = useQuery({
    queryKey: ['finance-stats'],
    queryFn: () => api.get('/finance/bank-details/stats').then(r => r.data),
  });

  const { data: employees = [] } = useQuery({
    queryKey: ['employees-list-for-finance'],
    queryFn: () => api.get('/employees').then(r => r.data),
    enabled: showForm && !editingEmployeeId,
  });

  const saveMutation = useMutation({
    mutationFn: (data: { employeeId: number; body: any }) =>
      api.put(`/finance/bank-details/${data.employeeId}`, data.body),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['finance-bank-details'] });
      queryClient.invalidateQueries({ queryKey: ['finance-stats'] });
      toast.success(editingEmployeeId ? 'Bank details updated' : 'Bank details added');
      closeForm();
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to save'),
  });

  const deleteMutation = useMutation({
    mutationFn: (employeeId: number) => api.delete(`/finance/bank-details/${employeeId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance-bank-details'] });
      queryClient.invalidateQueries({ queryKey: ['finance-stats'] });
      toast.success('Bank details deleted');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to delete'),
  });

  function openEdit(record: any) {
    setEditingEmployeeId(record.employee_id);
    setForm({
      employee_id: String(record.employee_id),
      account_name: record.account_name,
      name_as_per_uid: record.name_as_per_uid,
      bank_account_number: record.bank_account_number,
      pan_card: record.pan_card,
      ifsc_code: record.ifsc_code,
      branch_name: record.branch_name,
      payment_mode: record.payment_mode,
    });
    setShowForm(true);
  }

  function openAddForEmployee(r: any) {
    const name = `${r.first_name} ${r.last_name}`.trim();
    setEditingEmployeeId(r.employee_id);
    setForm({
      employee_id: String(r.employee_id),
      account_name: name,
      name_as_per_uid: name,
      bank_account_number: '', pan_card: '', ifsc_code: '',
      branch_name: '', payment_mode: 'Bank Transfer',
    });
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingEmployeeId(null);
    setForm({
      employee_id: '', account_name: '', name_as_per_uid: '',
      bank_account_number: '', pan_card: '', ifsc_code: '',
      branch_name: '', payment_mode: 'Bank Transfer',
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const employeeId = editingEmployeeId || Number(form.employee_id);
    if (!employeeId) {
      toast.error('Select an employee');
      return;
    }
    saveMutation.mutate({
      employeeId,
      body: {
        account_name: form.account_name,
        name_as_per_uid: form.name_as_per_uid,
        bank_account_number: form.bank_account_number,
        pan_card: form.pan_card,
        ifsc_code: form.ifsc_code,
        branch_name: form.branch_name,
        payment_mode: form.payment_mode,
      },
    });
  }

  const branches = [...new Set(records.map((r: any) => r.employee_branch).filter(Boolean))] as string[];

  // Client-side pagination — presentation only. Filters/search/stats/branches all
  // keep operating on the full `records` set; only the rendered slice is paged.
  const totalPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  // Reset to page 1 whenever the search or branch filter changes.
  useEffect(() => { setPage(1); }, [debouncedSearch, branchFilter]);
  // Clamp: if the list shrinks (e.g. after a delete) past the current page, step back.
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  const safePage = Math.min(page, totalPages);
  const pagedRecords = pageSlice(records, safePage, PAGE_SIZE);

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Financial Details</h1>
            <p className="text-secondary mt-1">Employee bank account and payment information</p>
          </div>
          {isAdmin && (
            <button
              onClick={() => { closeForm(); setShowForm(true); }}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus size={16} />
              Add Bank Details
            </button>
          )}
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-card rounded-xl border border-border p-5">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg text-blue-600 bg-blue-50">
                  <Users size={20} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{stats.totalEmployees}</p>
                  <p className="text-sm text-secondary">Total Employees</p>
                </div>
              </div>
            </div>
            <div className="bg-card rounded-xl border border-border p-5">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg text-green-600 bg-green-50">
                  <CircleDollarSign size={20} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-green-600">{stats.withBankDetails}</p>
                  <p className="text-sm text-secondary">With Bank Details</p>
                </div>
              </div>
            </div>
            <div className="bg-card rounded-xl border border-border p-5">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg text-red-600 bg-red-50">
                  <AlertCircle size={20} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-red-600">{stats.withoutBankDetails}</p>
                  <p className="text-sm text-secondary">Missing Bank Details</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Add/Edit Form */}
        {showForm && (
          <div className="bg-card rounded-xl border border-border p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">
                {editingEmployeeId ? 'Edit Bank Details' : 'Add Bank Details'}
              </h2>
              <button onClick={closeForm} className="p-1 text-secondary hover:text-foreground">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {!editingEmployeeId && (
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-foreground mb-1.5">Employee *</label>
                  <select
                    required
                    value={form.employee_id}
                    onChange={(e) => {
                      const emp = employees.find((emp: any) => String(emp.id) === e.target.value);
                      setForm(p => ({
                        ...p,
                        employee_id: e.target.value,
                        name_as_per_uid: emp ? `${emp.first_name} ${emp.last_name}` : '',
                      }));
                    }}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    <option value="">Select employee</option>
                    {employees.map((e: any) => (
                      <option key={e.id} value={e.id}>
                        {e.employee_code} — {e.first_name} {e.last_name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Account Name *</label>
                <input
                  required
                  value={form.account_name}
                  onChange={(e) => setForm(p => ({ ...p, account_name: e.target.value }))}
                  placeholder="Account holder name"
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Name (As per UID) *</label>
                <input
                  required
                  value={form.name_as_per_uid}
                  onChange={(e) => setForm(p => ({ ...p, name_as_per_uid: e.target.value }))}
                  placeholder="Name as per Aadhaar"
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Bank Account Number *</label>
                <input
                  required
                  value={form.bank_account_number}
                  onChange={(e) => setForm(p => ({ ...p, bank_account_number: e.target.value }))}
                  placeholder="Account number"
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">PAN Card *</label>
                <input
                  required
                  value={form.pan_card}
                  onChange={(e) => setForm(p => ({ ...p, pan_card: e.target.value.toUpperCase() }))}
                  placeholder="ABCDE1234F"
                  maxLength={10}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">IFSC Code *</label>
                <input
                  required
                  value={form.ifsc_code}
                  onChange={(e) => setForm(p => ({ ...p, ifsc_code: e.target.value.toUpperCase() }))}
                  placeholder="SBIN0001234"
                  maxLength={11}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Branch Name *</label>
                <input
                  required
                  value={form.branch_name}
                  onChange={(e) => setForm(p => ({ ...p, branch_name: e.target.value }))}
                  placeholder="Bank branch"
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Payment Mode</label>
                <select
                  value={form.payment_mode}
                  onChange={(e) => setForm(p => ({ ...p, payment_mode: e.target.value }))}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  {PAYMENT_MODES.map(mode => (
                    <option key={mode} value={mode}>{mode}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2 lg:col-span-4 flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={saveMutation.isPending}
                  className="px-5 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {saveMutation.isPending ? 'Saving...' : editingEmployeeId ? 'Update' : 'Save'}
                </button>
                <button type="button" onClick={closeForm} className="px-5 py-2 border border-border rounded-lg text-sm">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by code, name, PAN..."
              className="w-full pl-9 pr-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          {branches.length > 0 && (
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="px-3 py-2 border border-border rounded-lg bg-background text-sm"
            >
              <option value="">All Branches</option>
              {branches.map((b: string) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          )}
          <button
            onClick={() => setReveal((v) => !v)}
            title={reveal ? 'Hide sensitive details' : 'Show sensitive details'}
            className={`flex items-center gap-2 px-3 py-2 border rounded-lg text-sm font-medium transition-colors ${
              reveal ? 'border-primary text-primary bg-primary/5' : 'border-border text-secondary hover:bg-muted'
            }`}
          >
            {reveal ? <EyeOff size={16} /> : <Eye size={16} />}
            {reveal ? 'Hide details' : 'Show details'}
          </button>
        </div>

        {/* Table */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
            </div>
          ) : records.length === 0 ? (
            <div className="p-8 text-center text-secondary">
              <Landmark size={32} className="mx-auto mb-2 opacity-40" />
              <p>No bank details found.</p>
              {isAdmin && <p className="text-xs mt-1">Click &quot;Add Bank Details&quot; to get started.</p>}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Emp Code</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Account Name</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Name (UID)</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Account No.</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">PAN</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">IFSC</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Branch</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Mode</th>
                    {isAdmin && <th className="text-right px-4 py-3 text-xs font-medium text-secondary uppercase">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pagedRecords.map((r: any) => {
                    const missing = r.detail_status === 'missing';
                    return (
                      <tr key={r.employee_id} className={`transition-colors ${missing ? 'bg-amber-50/60 hover:bg-amber-50' : 'hover:bg-muted/30'}`}>
                        <td className="px-4 py-3">
                          <div>
                            <p className="text-sm font-medium text-foreground">{r.employee_code}</p>
                            <p className="text-xs text-secondary">{r.first_name} {r.last_name}</p>
                          </div>
                        </td>
                        {missing ? (
                          <td className="px-4 py-3" colSpan={7}>
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                              <AlertCircle size={12} /> Bank details pending — newly onboarded
                            </span>
                          </td>
                        ) : (
                          <>
                            <td className="px-4 py-3 text-sm text-foreground">{r.account_name}</td>
                            <td className="px-4 py-3 text-sm text-foreground">{r.name_as_per_uid}</td>
                            <td className="px-4 py-3 text-sm text-foreground font-mono tracking-tight">
                              {reveal
                                ? ((r.bank_account_number || '').replace(/(.{4})/g, '$1 ').trim() || '—')
                                : DOTS(r.bank_account_number)}
                            </td>
                            <td className="px-4 py-3 text-sm text-foreground font-mono tracking-tight">
                              {reveal ? r.pan_card : DOTS(r.pan_card)}
                            </td>
                            <td className="px-4 py-3 text-sm text-foreground font-mono tracking-tight">
                              {reveal ? r.ifsc_code : DOTS(r.ifsc_code)}
                            </td>
                            <td className="px-4 py-3 text-sm text-secondary">{r.branch_name}</td>
                            <td className="px-4 py-3">
                              <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                                {r.payment_mode}
                              </span>
                            </td>
                          </>
                        )}
                        {isAdmin && (
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1 justify-end">
                              {missing ? (
                                <button
                                  onClick={() => openAddForEmployee(r)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/5 rounded-lg transition-colors"
                                >
                                  <Plus size={13} /> Add details
                                </button>
                              ) : (
                                <>
                                  <button
                                    onClick={() => openEdit(r)}
                                    className="p-1.5 rounded-lg text-secondary hover:text-foreground hover:bg-muted transition-colors"
                                    title="Edit"
                                  >
                                    <Pencil size={14} />
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (confirm('Delete bank details for ' + r.employee_code + '?')) {
                                        deleteMutation.mutate(r.employee_id);
                                      }
                                    }}
                                    className="p-1.5 rounded-lg text-secondary hover:text-red-600 hover:bg-red-50 transition-colors"
                                    title="Delete"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Pagination
                total={records.length}
                page={safePage}
                pageSize={PAGE_SIZE}
                shown={pagedRecords.length}
                onPageChange={setPage}
                itemLabel="employees"
              />
            </div>
          )}
        </div>

        <p className="text-xs text-secondary text-center">
          {records.length} record{records.length !== 1 ? 's' : ''} shown
        </p>
      </div>
    </AppShell>
  );
}
