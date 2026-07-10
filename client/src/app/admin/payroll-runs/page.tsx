'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  Play, Lock, LockOpen, Loader2, CheckCircle2, AlertTriangle, Download, Pencil, X, ClipboardList,
} from 'lucide-react';
import Breadcrumb from '@/components/ui/Breadcrumb';
import Pagination, { pageSlice } from '@/components/ui/Pagination';
import { formatINR } from '@/lib/utils';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const PAGE_SIZE = 25;

export default function PayrollRunsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const now = new Date();

  const canManage = ['admin', 'chro', 'hr', 'finance'].includes(user?.roleName || '');
  const canUnlock = ['admin', 'chro', 'hr'].includes(user?.roleName || '');

  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [lastRun, setLastRun] = useState<any>(null);

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);
  const isFutureMonth = (m: number, y: number) =>
    y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth() + 1);

  // Review-step adjust dialog
  const [adjusting, setAdjusting] = useState<any | null>(null);
  const [adjForm, setAdjForm] = useState({ lop_override: '', adjustment_amount: '', adjustment_label: '', note: '' });

  // Client-side pagination for the review grid (presentation only — export/coverage read the full run).
  const [reviewPage, setReviewPage] = useState(1);

  const { data: runs = [], isLoading } = useQuery({
    queryKey: ['payroll-runs'],
    queryFn: () => api.get('/payroll/runs').then(r => r.data),
    enabled: canManage,
  });

  const currentRun = runs.find((r: any) => r.month === month && r.year === year);

  // Reset to the first page whenever the selected month/year/run changes.
  useEffect(() => { setReviewPage(1); }, [month, year, currentRun?.id]);

  // Review grid: per-employee days / LOP / net for the selected period.
  const { data: details } = useQuery({
    queryKey: ['run-details', month, year],
    queryFn: () => api.get(`/payroll/runs/details?month=${month}&year=${year}`).then(r => r.data),
    enabled: canManage && !!currentRun,
  });

  // Clamp the page when the set shrinks so we never render an empty grid with rows available.
  // `details.slips` stays the FULL run — the register export and the coverage gate read it.
  const reviewTotal = details?.slips?.length ?? 0;
  const reviewCurrent = Math.min(reviewPage, Math.max(1, Math.ceil(reviewTotal / PAGE_SIZE)));
  const reviewSlips = pageSlice(details?.slips ?? [], reviewCurrent, PAGE_SIZE);

  const runMutation = useMutation({
    mutationFn: () => api.post('/payroll/runs', { month, year }).then(r => r.data),
    onSuccess: (data) => {
      setLastRun(data);
      queryClient.invalidateQueries({ queryKey: ['payroll-runs'] });
      queryClient.invalidateQueries({ queryKey: ['run-details'] });
      toast.success(`Payroll run: ${data.generated} payslip(s) generated`);
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Payroll run failed'),
  });

  const lockMutation = useMutation({
    mutationFn: (vars: { month: number; year: number; lock: boolean; confirm?: boolean; reason?: string }) =>
      api.post(`/payroll/runs/${vars.lock ? 'lock' : 'unlock'}`, { month: vars.month, year: vars.year, confirm: vars.confirm === true, reason: vars.reason }).then(r => r.data),
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ['payroll-runs'] });
      queryClient.invalidateQueries({ queryKey: ['run-details'] });
      toast.success(vars.lock ? 'Payroll locked' : 'Payroll unlocked');
    },
    onError: (err: any, vars) => {
      // Attendance-coverage gate (409): let the user lock anyway after confirming.
      if (err.response?.status === 409 && vars.lock && !vars.confirm) {
        if (window.confirm(`${err.response?.data?.error}\n\nLock anyway?`)) {
          lockMutation.mutate({ ...vars, confirm: true });
        }
        return;
      }
      toast.error(err.response?.data?.error || 'Action failed');
    },
  });

  const adjustMutation = useMutation({
    mutationFn: (vars: { employeeId: number }) => api.put(`/payroll/runs/adjustments/${vars.employeeId}`, {
      month, year,
      lop_override: adjForm.lop_override === '' ? null : Number(adjForm.lop_override),
      adjustment_amount: Number(adjForm.adjustment_amount) || 0,
      adjustment_label: adjForm.adjustment_label,
      note: adjForm.note,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['run-details'] });
      queryClient.invalidateQueries({ queryKey: ['payroll-runs'] });
      toast.success('Correction saved — payslip regenerated');
      setAdjusting(null);
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to save correction'),
  });

  const openAdjust = (slip: any) => {
    setAdjForm({
      lop_override: slip.adjustment?.lop_override != null ? String(slip.adjustment.lop_override) : '',
      adjustment_amount: slip.adjustment?.adjustment_amount ? String(slip.adjustment.adjustment_amount) : '',
      adjustment_label: slip.adjustment?.adjustment_label || '',
      note: slip.adjustment?.note || '',
    });
    setAdjusting(slip);
  };

  async function downloadRegister() {
    try {
      const res = await api.get(`/payroll/runs/export?month=${month}&year=${year}`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url; a.download = `Salary_Register_${year}_${String(month).padStart(2, '0')}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to export the salary register');
    }
  }

  if (!canManage) {
    return (
      <AppShell>
        <div className="text-center py-20 text-secondary">You do not have access to payroll runs.</div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <Breadcrumb className="mb-2" items={[{ label: 'Admin', href: '/admin' }, { label: 'Payroll Runs' }]} />
          <h1 className="text-2xl font-bold text-foreground">Payroll Runs</h1>
          <p className="text-secondary mt-1">Generate payslips for the whole company, then lock the month</p>
        </div>

        {/* Run control */}
        <div className="bg-card rounded-xl border border-border p-6">
          <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Play size={16} className="text-primary" /> Run Payroll
          </h2>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">Month</label>
              <select value={month} onChange={(e) => { setMonth(Number(e.target.value)); setLastRun(null); }}
                className="px-3 py-2.5 border border-border rounded-lg bg-background text-sm min-w-[140px]">
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1} disabled={isFutureMonth(i + 1, year)}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">Year</label>
              <select value={year} onChange={(e) => { setYear(Number(e.target.value)); setLastRun(null); }}
                className="px-3 py-2.5 border border-border rounded-lg bg-background text-sm">
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <button
              onClick={() => runMutation.mutate()}
              disabled={runMutation.isPending || isFutureMonth(month, year)}
              className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {runMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
              Run for {MONTHS[month - 1]} {year}
            </button>
          </div>

          {isFutureMonth(month, year) && (
            <p className="text-xs text-amber-600 mt-3 flex items-center gap-1">
              <AlertTriangle size={13} /> You can't run payroll for a future month.
            </p>
          )}

          {lastRun && (
            <div className="mt-4 p-4 bg-muted/40 rounded-lg">
              <p className="text-sm font-medium text-foreground flex items-center gap-2">
                <CheckCircle2 size={15} className="text-green-600" />
                {lastRun.generated} payslip(s) generated for {MONTHS[lastRun.month - 1]} {lastRun.year}
              </p>
              <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-xs text-secondary">
                <span>Total Net: <span className="font-medium text-foreground">{formatINR(lastRun.total_net)}</span></span>
                <span>Total CTC: <span className="font-medium text-foreground">{formatINR(lastRun.total_ctc)}</span></span>
              </div>
              {lastRun.skipped?.length > 0 && (
                <p className="text-xs text-amber-600 mt-2">
                  Skipped {lastRun.skipped.length} employee(s) without a salary structure assignment:{' '}
                  {lastRun.skipped.slice(0, 5).map((s: any) => s.employee_code).join(', ')}
                  {lastRun.skipped.length > 5 ? '…' : ''}
                </p>
              )}
              {lastRun.failed?.length > 0 && (
                <p className="text-xs text-red-600 mt-2">
                  {lastRun.failed.length} employee(s) failed and were reported (the run continued):{' '}
                  {lastRun.failed.slice(0, 5).map((s: any) => `${s.employee_code} (${s.reason})`).join('; ')}
                  {lastRun.failed.length > 5 ? '…' : ''}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Review grid — step 2 of the run journey */}
        {currentRun && details && (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <ClipboardList size={15} className="text-primary" /> Review — {MONTHS[month - 1]} {year}
                </h2>
                <p className="text-xs text-secondary mt-0.5">
                  {details.slips.length} payslip(s) · {currentRun.status === 'locked' ? 'locked (read-only)' : 'draft — correct LOP or add adjustments, then lock'}
                </p>
              </div>
              <button onClick={downloadRegister}
                className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors">
                <Download size={14} /> Salary Register (CSV)
              </button>
            </div>

            {/* Attendance-coverage gate (Phase 3) */}
            {details.coverage && details.coverage.working_days > 0 && (
              <div className={`px-6 py-3 border-b border-border flex flex-wrap items-center gap-x-6 gap-y-2 text-xs ${
                details.coverage.over_gate ? 'bg-amber-50 text-amber-800' : 'bg-muted/30 text-secondary'
              }`}>
                <span className="flex items-center gap-1.5 font-medium">
                  {details.coverage.over_gate
                    ? <AlertTriangle size={14} className="text-amber-600" />
                    : <CheckCircle2 size={14} className="text-green-600" />}
                  Attendance coverage: {(100 - details.coverage.unmarked_pct).toFixed(1)}% marked
                  <span className="text-secondary font-normal">
                    ({details.coverage.unmarked_days} of {details.coverage.working_days} working days unmarked · gate {details.coverage.gate_pct}%)
                  </span>
                </span>
                {details.coverage.by_property.filter((p: any) => p.unmarked_pct > 0).slice(0, 4).map((p: any) => (
                  <span key={p.branch} className="text-secondary">
                    {p.branch}: <span className={p.unmarked_pct > details.coverage.gate_pct ? 'text-amber-700 font-medium' : 'text-foreground'}>{p.unmarked_pct}% unmarked</span>
                  </span>
                ))}
                {details.coverage.over_gate && currentRun.status !== 'locked' && (
                  <span className="text-amber-700">Locking will require confirmation.</span>
                )}
              </div>
            )}

            <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border text-left text-secondary">
                    <th className="px-4 py-2.5 font-medium">Employee</th>
                    <th className="px-3 py-2.5 font-medium text-right">Working</th>
                    <th className="px-3 py-2.5 font-medium text-right">LOP</th>
                    <th className="px-3 py-2.5 font-medium text-right">Paid Days</th>
                    <th className="px-3 py-2.5 font-medium text-right">Gross</th>
                    <th className="px-3 py-2.5 font-medium text-right">Net</th>
                    <th className="px-4 py-2.5 font-medium">Flags</th>
                    <th className="px-4 py-2.5 font-medium text-right"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {reviewSlips.map((s: any) => {
                    const unmarked = s.days?.counts?.unmarked ?? 0;
                    const missPunch = s.days?.counts?.miss_punch ?? 0;
                    const shortPunch = s.days?.counts?.short_punch ?? 0;
                    const notEmployed = s.days?.not_employed_days ?? 0;
                    return (
                      <tr key={s.employee_id} className="hover:bg-muted/20">
                        <td className="px-4 py-2">
                          <p className="font-medium text-foreground">{s.name}</p>
                          <p className="text-xs text-secondary">{s.employee_code} · {s.designation || '—'}</p>
                        </td>
                        <td className="px-3 py-2 text-right text-secondary">{s.days?.working_days ?? '—'}</td>
                        <td className={`px-3 py-2 text-right font-medium ${(s.days?.lop_days ?? 0) > 0 ? 'text-red-600' : 'text-secondary'}`}>
                          {s.days?.lop_days ?? '—'}{s.days?.lop_overridden ? '*' : ''}
                        </td>
                        <td className="px-3 py-2 text-right text-foreground">{s.days?.hours != null ? `${s.days.hours}h` : (s.days?.payment_days ?? '—')}</td>
                        <td className="px-3 py-2 text-right text-foreground">{formatINR(s.gross_earnings)}</td>
                        <td className="px-3 py-2 text-right font-medium text-green-700">{formatINR(s.net_pay)}</td>
                        <td className="px-4 py-2">
                          <div className="flex flex-wrap gap-1">
                            {notEmployed > 0 && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700" title="Working days outside the employment span (before joining / after last working day) — in the denominator but not paid">
                                {notEmployed}d not employed
                              </span>
                            )}
                            {unmarked > 0 && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700" title="Working days without an attendance record">
                                {unmarked} unmarked
                              </span>
                            )}
                            {missPunch > 0 && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-100 text-orange-700" title="Days marked once only (missing in or out punch); the first few each month are regularized per the Pay Schedule">
                                {missPunch} miss punch
                              </span>
                            )}
                            {shortPunch > 0 && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700" title="Days the employee left early beyond the grace window">
                                {shortPunch} short punch
                              </span>
                            )}
                            {s.adjustment && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700" title={s.adjustment.note || ''}>
                                adjusted
                              </span>
                            )}
                            {s.below_min_wage && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700"
                                title={`Full-month Basic is below the ${s.work_state || ''} minimum wage${s.min_wage ? ` (₹${s.min_wage})` : ''} — check the salary structure`}>
                                &lt; min wage
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right">
                          {currentRun.status !== 'locked' && (
                            <button onClick={() => openAdjust(s)}
                              className="p-1.5 rounded-lg text-secondary hover:text-foreground hover:bg-muted transition-colors" title="Correct LOP / add adjustment">
                              <Pencil size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              total={reviewTotal}
              page={reviewCurrent}
              pageSize={PAGE_SIZE}
              onPageChange={setReviewPage}
              shown={reviewSlips.length}
              itemLabel="payslips"
            />
            {details.skipped?.length > 0 && (
              <div className="px-6 py-3 border-t border-border text-xs text-amber-700">
                Not generated ({details.skipped.length}): {details.skipped.slice(0, 8).map((s: any) => s.employee_code).join(', ')}{details.skipped.length > 8 ? '…' : ''} — assign a salary structure and re-run.
              </div>
            )}
          </div>
        )}

        {/* Runs table */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Run History</h2>
          </div>
          {isLoading ? (
            <div className="flex justify-center py-10">
              <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-primary" />
            </div>
          ) : runs.length === 0 ? (
            <div className="py-12 text-center text-sm text-secondary">No payroll runs yet</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="text-left px-6 py-2.5 text-xs font-semibold text-secondary uppercase">Period</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-secondary uppercase">Status</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-secondary uppercase">Employees</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-secondary uppercase">Total Net</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-secondary uppercase">Total CTC</th>
                    <th className="text-right px-6 py-2.5 text-xs font-semibold text-secondary uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {runs.map((r: any) => {
                    const locked = r.status === 'locked';
                    return (
                      <tr key={r.id} className="hover:bg-muted/20">
                        <td className="px-6 py-3 text-sm font-medium text-foreground">{MONTHS[r.month - 1]} {r.year}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                            locked ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                          }`}>
                            {locked ? <Lock size={11} /> : <LockOpen size={11} />}
                            {locked ? 'Locked' : 'Draft'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-foreground">{r.employee_count}</td>
                        <td className="px-4 py-3 text-sm text-right text-foreground">{formatINR(r.total_net)}</td>
                        <td className="px-4 py-3 text-sm text-right text-foreground">{formatINR(r.total_ctc)}</td>
                        <td className="px-6 py-3 text-right">
                          {locked ? (
                            canUnlock ? (
                              <button
                                onClick={() => {
                                  const reason = window.prompt(`Unlock payroll for ${MONTHS[r.month - 1]} ${r.year}? This re-opens a finalised month.\n\nEnter a reason (required):`);
                                  if (reason && reason.trim())
                                    lockMutation.mutate({ month: r.month, year: r.year, lock: false, reason: reason.trim() });
                                }}
                                disabled={lockMutation.isPending}
                                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-secondary hover:bg-muted rounded-lg transition-colors"
                              >
                                <LockOpen size={13} /> Unlock
                              </button>
                            ) : (
                              <span className="text-xs text-secondary">—</span>
                            )
                          ) : (
                            <button
                              onClick={() => {
                                if (confirm(`Lock payroll for ${MONTHS[r.month - 1]} ${r.year}? Payslips become read-only.`))
                                  lockMutation.mutate({ month: r.month, year: r.year, lock: true });
                              }}
                              disabled={lockMutation.isPending}
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5 rounded-lg transition-colors"
                            >
                              <Lock size={13} /> Lock
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Adjust dialog — LOP override + manual line, with a mandatory note */}
      {adjusting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={() => setAdjusting(null)} />
          <div className="relative bg-card rounded-xl border border-border shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <h3 className="text-base font-semibold text-foreground">Correct — {adjusting.name}</h3>
                <p className="text-xs text-secondary mt-0.5">
                  Computed: {adjusting.days?.working_days ?? '—'} working · {(adjusting.days?.not_employed_days ?? 0) > 0 ? `${adjusting.days.not_employed_days} not-employed · ` : ''}{adjusting.days?.lop_days ?? '—'} LOP · {adjusting.days?.payment_days ?? '—'} paid
                  {adjusting.days?.counts ? ` (${adjusting.days.counts.absent} absent, ${adjusting.days.counts.half_day} half-day, ${adjusting.days.counts.short_punch ?? 0} short-punch, ${adjusting.days.counts.miss_punch ?? 0} miss-punch, ${adjusting.days.counts.unpaid_leave} unpaid leave, ${adjusting.days.counts.unmarked} unmarked)` : ''}
                </p>
              </div>
              <button onClick={() => setAdjusting(null)} className="p-1 rounded-lg text-secondary hover:text-foreground hover:bg-muted transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">LOP override (days)</label>
                <input type="number" step="0.5" min={0} value={adjForm.lop_override}
                  onChange={(e) => setAdjForm(p => ({ ...p, lop_override: e.target.value }))}
                  placeholder={`computed: ${adjusting.days?.lop_days ?? 0}`}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                <p className="text-xs text-secondary mt-1">Leave blank to keep the computed LOP.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Adjustment ₹ (±)</label>
                  <input type="number" step="any" value={adjForm.adjustment_amount}
                    onChange={(e) => setAdjForm(p => ({ ...p, adjustment_amount: e.target.value }))}
                    placeholder="0"
                    className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Label</label>
                  <input value={adjForm.adjustment_label}
                    onChange={(e) => setAdjForm(p => ({ ...p, adjustment_label: e.target.value }))}
                    placeholder="e.g. Arrears"
                    className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Reason<span className="text-red-600"> *</span></label>
                <textarea rows={2} value={adjForm.note}
                  onChange={(e) => setAdjForm(p => ({ ...p, note: e.target.value }))}
                  placeholder="Why this correction is needed (kept on record)"
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none" />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
              <button onClick={() => setAdjusting(null)} className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors">
                Cancel
              </button>
              <button
                onClick={() => adjustMutation.mutate({ employeeId: adjusting.employee_id })}
                disabled={adjustMutation.isPending || !adjForm.note.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {adjustMutation.isPending && <Loader2 size={14} className="animate-spin" />} Save & regenerate
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
