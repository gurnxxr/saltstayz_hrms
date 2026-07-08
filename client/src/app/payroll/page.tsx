'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import Breadcrumb from '@/components/ui/Breadcrumb';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatINR } from '@/lib/utils';
import LoadError from '@/components/ui/LoadError';
import {
  FileText, Download, Loader2, Wallet, Calendar, IndianRupee, AlertTriangle, Users, CheckCircle2,
} from 'lucide-react';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];


export default function PayrollPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const now = new Date();

  // Personal payslip is only meaningful for accounts linked to an employee.
  // Payroll staff (who may have no employee profile) get bulk generation instead.
  const hasProfile = !!user?.employeeId;
  const isPayrollStaff = ['admin', 'chro', 'hr', 'finance'].includes(user?.roleName || '');

  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [result, setResult] = useState<any>(null);

  const [bulkMonth, setBulkMonth] = useState(now.getMonth() + 1);
  const [bulkYear, setBulkYear] = useState(now.getFullYear());
  const [bulkResult, setBulkResult] = useState<any>(null);

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);
  const isFutureMonth = (m: number, y: number) =>
    y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth() + 1);
  const selectedIsFuture = isFutureMonth(month, year);

  const { data: history = [], isLoading: historyLoading, isError: historyError, refetch: refetchHistory } = useQuery({
    queryKey: ['my-payslip-history'],
    queryFn: () => api.get('/payroll/me/history').then(r => r.data),
    enabled: hasProfile, // avoid the "no employee profile" 400 for staff accounts
  });

  const bulkMutation = useMutation({
    mutationFn: () => api.post('/payroll/runs', { month: bulkMonth, year: bulkYear }).then(r => r.data),
    onSuccess: (data) => { setBulkResult(data); toast.success(`${data.generated} payslip(s) generated`); },
    onError: (err: any) => { setBulkResult(null); toast.error(err.response?.data?.error || 'Bulk generation failed'); },
  });

  // Employees view their own payslip only after the month's payroll is locked
  // (published) — a pure read of the stored snapshot, no self-generation.
  const viewMutation = useMutation({
    mutationFn: () => api.get(`/payroll/me/payslip?month=${month}&year=${year}`).then(r => r.data),
    onSuccess: (data) => { setResult(data); },
    onError: (err: any) => {
      setResult(null);
      toast.error(err.response?.data?.error || 'Payslip not available for this month yet.');
    },
  });

  async function download(url: string, label: string) {
    try {
      const res = await api.get(url, { responseType: 'blob' });
      const blobUrl = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `Payslip_${label}.pdf`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch {
      toast.error('Failed to download PDF');
    }
  }

  const b = result?.breakdown;

  return (
    <AppShell>
      <div className="space-y-6">
        <Breadcrumb items={[{ label: 'Payroll' }, { label: 'Salary Slips' }]} />
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">Salary Slips</h1>
          <p className="text-secondary mt-1">Generate and download salary slips</p>
        </div>

        {/* Bulk generate — payroll staff */}
        {isPayrollStaff && (
          <div className="bg-card rounded-xl border border-border p-6">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-1">
              <Users size={16} className="text-primary" /> Bulk Generate Salary Slips
            </h2>
            <p className="text-xs text-secondary mb-4">
              Generate payslips for every active employee for a month. Review and lock the run in{' '}
              <a href="/admin/payroll-runs" className="underline hover:text-foreground">Payroll Runs</a>.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-medium text-secondary mb-1">Month</label>
                <select value={bulkMonth} onChange={(e) => { setBulkMonth(Number(e.target.value)); setBulkResult(null); }}
                  className="px-3 py-2.5 border border-border rounded-lg bg-background text-sm min-w-[140px] focus:outline-none focus:ring-2 focus:ring-primary/50">
                  {MONTHS.map((m, i) => <option key={m} value={i + 1} disabled={isFutureMonth(i + 1, bulkYear)}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-secondary mb-1">Year</label>
                <select value={bulkYear} onChange={(e) => { setBulkYear(Number(e.target.value)); setBulkResult(null); }}
                  className="px-3 py-2.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                  {years.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <button onClick={() => bulkMutation.mutate()} disabled={bulkMutation.isPending || isFutureMonth(bulkMonth, bulkYear)}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                {bulkMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Users size={15} />}
                Generate All
              </button>
            </div>
            {isFutureMonth(bulkMonth, bulkYear) && (
              <p className="text-xs text-amber-600 mt-3 flex items-center gap-1"><AlertTriangle size={13} /> You can&apos;t run payroll for a future month.</p>
            )}
            {bulkResult && (
              <div className="mt-4 p-4 bg-muted/40 rounded-lg">
                <p className="text-sm font-medium text-foreground flex items-center gap-2">
                  <CheckCircle2 size={15} className="text-green-600" />
                  {bulkResult.generated} payslip(s) generated for {MONTHS[bulkResult.month - 1]} {bulkResult.year}
                </p>
                <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-xs text-secondary">
                  <span>Total Net: <span className="font-medium text-foreground">{formatINR(bulkResult.total_net)}</span></span>
                  <span>Total CTC: <span className="font-medium text-foreground">{formatINR(bulkResult.total_ctc)}</span></span>
                </div>
                {bulkResult.skipped?.length > 0 && (
                  <p className="text-xs text-amber-600 mt-2">
                    Skipped {bulkResult.skipped.length} employee(s) without a salary structure:{' '}
                    {bulkResult.skipped.slice(0, 5).map((s: any) => s.employee_code).join(', ')}{bulkResult.skipped.length > 5 ? '…' : ''}
                  </p>
                )}
                {bulkResult.failed?.length > 0 && (
                  <p className="text-xs text-red-600 mt-2">
                    {bulkResult.failed.length} employee(s) failed and were reported (the run continued) — see{' '}
                    <a href="/admin/payroll-runs" className="underline hover:text-foreground">Payroll Runs</a>.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Staff account with no linked employee — no personal payslip */}
        {!hasProfile && isPayrollStaff && (
          <div className="bg-card rounded-xl border border-border p-8 text-center">
            <FileText size={32} className="mx-auto text-secondary/30 mb-2" />
            <p className="text-sm font-medium text-foreground">No personal payslip on this account</p>
            <p className="text-sm text-secondary mt-1">Your login isn&apos;t linked to an employee profile. Use Bulk Generate above to run payroll for everyone.</p>
          </div>
        )}

        {hasProfile && (<>

        {/* Viewer — published (locked) months only */}
        <div className="bg-card rounded-xl border border-border p-6">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-1">
            <Wallet size={16} className="text-primary" /> View Payslip
          </h2>
          <p className="text-xs text-secondary mb-4">Your payslip becomes available once HR finalises (locks) that month&apos;s payroll.</p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">Month</label>
              <select
                value={month}
                onChange={(e) => { setMonth(Number(e.target.value)); setResult(null); }}
                className="px-3 py-2.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 min-w-[140px]"
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1} disabled={isFutureMonth(i + 1, year)}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">Year</label>
              <select
                value={year}
                onChange={(e) => { setYear(Number(e.target.value)); setResult(null); }}
                className="px-3 py-2.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <button
              onClick={() => viewMutation.mutate()}
              disabled={viewMutation.isPending || selectedIsFuture}
              className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {viewMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
              View Payslip
            </button>
          </div>
          {selectedIsFuture && (
            <p className="text-xs text-amber-600 mt-3 flex items-center gap-1">
              <AlertTriangle size={13} /> A payslip for a future month isn&apos;t available.
            </p>
          )}
        </div>

        {/* Result preview */}
        {result && b && (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            {/* Banner */}
            <div className="bg-primary px-6 py-5 flex items-center justify-between">
              <div>
                <p className="text-white font-semibold text-lg">{result.employee.name}</p>
                <p className="text-blue-200 text-xs mt-0.5">
                  {result.employee.employee_code} · {result.employee.designation}
                </p>
              </div>
              <div className="text-right">
                <p className="text-blue-200 text-xs flex items-center gap-1 justify-end">
                  <Calendar size={12} /> {result.monthLabel}
                </p>
                <button
                  onClick={() => download(
                    `/payroll/me/payslip/pdf?month=${result.month}&year=${result.year}`,
                    `${result.employee.name.replace(/\s+/g, '_')}_${result.monthLabel.replace(/\s+/g, '_')}`,
                  )}
                  className="mt-2 flex items-center gap-2 px-3 py-1.5 bg-white text-primary rounded-lg text-xs font-semibold hover:bg-blue-50 transition-colors ml-auto"
                >
                  <Download size={13} /> Download PDF
                </button>
              </div>
            </div>

            {/* Attendance-driven days strip */}
            {b.days && (
              <div className="px-6 py-3 bg-muted/40 border-b border-border flex flex-wrap gap-x-6 gap-y-1 text-xs">
                <span className="text-secondary">Working days <span className="font-semibold text-foreground">{b.days.working_days}</span></span>
                <span className="text-secondary">Loss of pay <span className={`font-semibold ${b.days.lop_days > 0 ? 'text-red-600' : 'text-foreground'}`}>{b.days.lop_days}</span></span>
                {b.days.hours != null
                  ? <span className="text-secondary">Hours paid <span className="font-semibold text-foreground">{b.days.hours}</span></span>
                  : <span className="text-secondary">Days paid <span className="font-semibold text-foreground">{b.days.payment_days}</span></span>}
              </div>
            )}

            {/* Earnings + Deductions — component lines from the salary structure */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border">
              <Section title="Earnings" rows={(b.earnings ?? []).map((l: any) => [l.name, l.amount] as [string, number])}
                total={['Gross Earnings', b.gross_earnings]} />
              <Section title="Deductions" rows={[
                ['Employee PF', b.employee_pf] as [string, number],
                ['ESI', b.esi] as [string, number],
                ['LWF', b.lwf] as [string, number],
                // PT only where the state levies it
                ...((b.pt ?? 0) > 0 ? [['Professional Tax', b.pt] as [string, number]] : []),
                ...(b.other_deductions ?? []).map((l: any) => [l.name, l.amount] as [string, number]),
              ]} total={['Total Deduction', b.total_deduction]} />
            </div>

            {/* Net pay */}
            <div className="bg-green-50 px-6 py-4 flex items-center justify-between border-t border-border">
              <div>
                <p className="text-sm font-semibold text-green-800 flex items-center gap-1.5">
                  <IndianRupee size={15} /> Net Pay
                </p>
                <p className="text-xs text-green-700/70 mt-0.5">Gross Earnings − Total Deduction</p>
              </div>
              <p className="text-2xl font-bold text-green-700">{formatINR(b.net_pay)}</p>
            </div>

            {/* CTC breakdown */}
            <div className="px-6 py-5 border-t border-border">
              <p className="text-sm font-semibold text-foreground mb-3">Cost to Company (CTC)</p>
              <div className="space-y-1.5 text-sm">
                <CtcLine label="Gross Earnings" value={b.gross_earnings} bold />
                <CtcLine label="Employer Statutory Contributions" value={b.employer_pf + b.employer_esi + b.employer_lwf} bold />
                <CtcLine label="Employer PF" value={b.employer_pf} indent />
                <CtcLine label="Employer ESI / Medical Benefit" value={b.employer_esi} indent />
                <CtcLine label="Employer LWF" value={b.employer_lwf} indent />
                {(b.employer_costs ?? []).length > 0 && (
                  <CtcLine label="Employer Benefits" value={b.employer_costs_total} bold />
                )}
                {(b.employer_costs ?? []).map((l: any) => (
                  <CtcLine key={l.name} label={l.name} value={l.amount} indent />
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
                <p className="text-sm font-bold text-primary">Total CTC</p>
                <p className="text-lg font-bold text-primary">{formatINR(b.ctc)}</p>
              </div>
            </div>
          </div>
        )}

        {/* History */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Payslip History</h2>
          </div>
          {historyLoading ? (
            <div className="flex justify-center py-10">
              <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-primary" />
            </div>
          ) : historyError ? (
            <LoadError message="Couldn't load your payslip history." onRetry={() => refetchHistory()} />
          ) : history.length === 0 ? (
            <div className="py-12 text-center">
              <FileText size={36} className="mx-auto text-secondary/30 mb-2" />
              <p className="text-sm text-secondary">No payslips generated yet</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-6 py-2.5 text-xs font-semibold text-secondary uppercase">Period</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-secondary uppercase">Pay Date</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-secondary uppercase">Net Pay</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-secondary uppercase">CTC</th>
                  <th className="text-right px-6 py-2.5 text-xs font-semibold text-secondary uppercase">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {history.map((h: any) => (
                  <tr key={h.id} className="hover:bg-muted/20">
                    <td className="px-6 py-3 text-sm font-medium text-foreground">{MONTHS[h.month - 1]} {h.year}</td>
                    <td className="px-4 py-3 text-sm text-secondary">
                      {h.pay_date ? new Date(h.pay_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-medium text-green-700">{formatINR(h.net_pay)}</td>
                    <td className="px-4 py-3 text-sm text-right text-foreground">{formatINR(h.ctc)}</td>
                    <td className="px-6 py-3 text-right">
                      <button
                        onClick={() => download(`/payroll/me/history/${h.id}/pdf`, `${MONTHS[h.month - 1]}_${h.year}`)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5 rounded-lg transition-colors"
                      >
                        <Download size={13} /> PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        </>)}
      </div>
    </AppShell>
  );
}

function Section({ title, rows, total }: {
  title: string; rows: [string, number][]; total: [string, number];
}) {
  return (
    <div className="bg-card">
      <div className="px-6 py-2.5 bg-muted/40 border-b border-border">
        <p className="text-xs font-semibold text-secondary uppercase">{title}</p>
      </div>
      <div className="px-6 py-3 space-y-2">
        {rows.map(([label, val]) => (
          <div key={label} className="flex items-center justify-between text-sm">
            <span className="text-secondary">{label}</span>
            <span className="text-foreground font-medium">{formatINR(val)}</span>
          </div>
        ))}
      </div>
      <div className="px-6 py-2.5 bg-muted/30 border-t border-border flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">{total[0]}</span>
        <span className="text-sm font-bold text-foreground">{formatINR(total[1])}</span>
      </div>
    </div>
  );
}

function CtcLine({ label, value, indent, bold }: {
  label: string; value: number; indent?: boolean; bold?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between ${indent ? 'pl-4' : ''}`}>
      <span className={bold ? 'font-medium text-foreground' : 'text-secondary'}>{label}</span>
      <span className={bold ? 'font-medium text-foreground' : 'text-foreground'}>{formatINR(value)}</span>
    </div>
  );
}
