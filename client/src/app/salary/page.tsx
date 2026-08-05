'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, errorFromBlob, formatDate, formatINR } from '@/lib/utils';
import { statutoryLines } from '@/lib/payslip';
import LoadError from '@/components/ui/LoadError';
import EmptyState from '@/components/ui/EmptyState';
import { btnCls, inputCls, labelSmCls, table } from '@/components/ui/styles';
import PayslipPreview from '@/components/payroll/PayslipPreview';
import { FileText, Download, Loader2, Wallet, AlertTriangle } from 'lucide-react';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function SalaryPage() {
  const { user } = useAuth();
  const now = new Date();

  // Self-service only: this page shows the signed-in user their own salary
  // structure and their own (published) payslips. Downloading anyone else's slip
  // lives under Admin → Salary Slips.
  const hasProfile = !!user?.employeeId;

  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [result, setResult] = useState<any>(null);

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);
  const isFutureMonth = (m: number, y: number) =>
    y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth() + 1);
  const selectedIsFuture = isFutureMonth(month, year);

  const { data: history = [], isLoading: historyLoading, isError: historyError, refetch: refetchHistory } = useQuery({
    queryKey: ['my-payslip-history'],
    queryFn: () => api.get('/payroll/me/history').then(r => r.data),
    enabled: hasProfile,
  });

  const {
    data: myStructure, isLoading: structureLoading, isError: structureError, refetch: refetchStructure,
  } = useQuery({
    queryKey: ['my-salary-structure'],
    queryFn: () => api.get('/payroll/me/structure').then(r => r.data),
    enabled: hasProfile,
  });

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
    } catch (err) {
      // A blob request hands the error body back as a Blob, so `err.response.data.error` is always
      // undefined and every failure read "Failed to download PDF" — including "this month isn't
      // locked yet", which is the one an employee could act on. errorFromBlob reads it back.
      toast.error((await errorFromBlob(err)) || 'Failed to download PDF');
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Salary</h1>
          <p className="text-secondary mt-1">Your salary structure and payslips</p>
        </div>

        {!hasProfile ? (
          <div className="bg-card rounded-xl border border-border">
            <EmptyState
              icon={FileText}
              title="No salary on this account"
              body="Your login isn't linked to an employee profile, so there's no personal salary to show."
            />
          </div>
        ) : (
          <>
            {/* My Salary Structure — read-only.
                This used to be `{myStructure?.breakdown && …}` and nothing else, so a failed request
                rendered as silence: the card simply wasn't there, which reads as "you have no salary
                structure" rather than "we couldn't fetch it". */}
            {structureError ? (
              <LoadError message="Couldn't load your salary structure." onRetry={() => refetchStructure()} />
            ) : structureLoading ? (
              <div className="bg-card rounded-xl border border-border p-10 flex justify-center">
                <Loader2 className="animate-spin text-secondary" />
              </div>
            ) : myStructure?.breakdown ? (
              <MySalaryStructure data={myStructure} />
            ) : null}

            {/* Viewer — published (locked) months only */}
            <div className="bg-card rounded-xl border border-border p-6">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-1">
                <Wallet size={16} className="text-primary" /> View Payslip
              </h2>
              <p className="text-xs text-secondary mb-4">Your payslip becomes available once HR finalises (locks) that month&apos;s payroll.</p>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className={labelSmCls}>Month</label>
                  {/* Was py-2.5, which made these two the tallest fields in the app. */}
                  <select
                    value={month}
                    onChange={(e) => { setMonth(Number(e.target.value)); setResult(null); }}
                    className={cn(inputCls, 'w-auto min-w-[140px]')}
                  >
                    {MONTHS.map((m, i) => (
                      <option key={m} value={i + 1} disabled={isFutureMonth(i + 1, year)}>{m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelSmCls}>Year</label>
                  <select
                    value={year}
                    onChange={(e) => { setYear(Number(e.target.value)); setResult(null); }}
                    className={cn(inputCls, 'w-auto')}
                  >
                    {years.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <button
                  onClick={() => viewMutation.mutate()}
                  disabled={viewMutation.isPending || selectedIsFuture}
                  className={btnCls('primary', 'lg')}
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

            {/* Result preview (my own payslip) */}
            {result && result.breakdown && (
              <PayslipPreview
                result={result}
                downloadHref={`/payroll/me/payslip/pdf?month=${result.month}&year=${result.year}`}
                download={download}
              />
            )}

            {/* History */}
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="px-6 py-4 border-b border-border">
                <h2 className="text-sm font-semibold text-foreground">Payslip History</h2>
              </div>
              {/* Error before loading. On a background refetch failure react-query reports isError
                  while isLoading is already false, so loading-first can hand a failure straight to
                  the empty state — and "No payslips generated yet" is a claim about somebody's pay
                  that must never be made on their behalf by a network error. */}
              {historyError ? (
                <LoadError message="Couldn't load your payslip history." onRetry={() => refetchHistory()} />
              ) : historyLoading ? (
                <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-secondary" /></div>
              ) : history.length === 0 ? (
                <EmptyState
                  icon={FileText}
                  title="No payslips yet"
                  body="A payslip appears here once HR finalises that month's payroll."
                />
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className={table.head}>
                      <th className={table.th}>Period</th>
                      <th className={table.th}>Pay Date</th>
                      <th className={cn(table.th, 'text-right')}>Net Pay</th>
                      <th className={cn(table.th, 'text-right')}>CTC</th>
                      <th className={cn(table.th, 'text-right')}>Action</th>
                    </tr>
                  </thead>
                  <tbody className={table.body}>
                    {history.map((h: any) => (
                      <tr key={h.id} className={table.row}>
                        <td className={cn(table.td, 'text-sm font-medium text-foreground')}>{MONTHS[h.month - 1]} {h.year}</td>
                        {/* formatDate, not a raw toLocaleDateString: it pins Asia/Kolkata and returns
                            "—" for a null, which this cell was hand-rolling either side of. */}
                        <td className={cn(table.td, 'text-sm text-secondary')}>{formatDate(h.pay_date)}</td>
                        <td className={cn(table.td, 'text-sm text-right font-medium text-green-700')}>{formatINR(h.net_pay)}</td>
                        <td className={cn(table.td, 'text-sm text-right text-foreground')}>{formatINR(h.ctc)}</td>
                        <td className={cn(table.td, 'text-right')}>
                          <button
                            onClick={() => download(`/payroll/me/history/${h.id}/pdf`, `${MONTHS[h.month - 1]}_${h.year}`)}
                            className={btnCls('secondary', 'sm')}
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
          </>
        )}
      </div>
    </AppShell>
  );
}

function SalRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-secondary">{label}</span>
      <span className="text-foreground font-medium">{formatINR(value)}</span>
    </div>
  );
}

// Read-only view of the employee's own salary structure.
function MySalaryStructure({ data }: { data: any }) {
  const b = data.breakdown;
  const earnings = (b.earnings ?? []).filter((l: any) => l.amount);
  const componentDeductions = (b.other_deductions ?? []).filter((l: any) => l.amount);
  // Shared with the payslip preview below, which had its own list in its own order under its own
  // names — so the same deduction was "Provident Fund" on this card and "Employee PF" one scroll
  // down. Zeroes are dropped here: this is a summary of what to expect, not a record of what
  // happened, and a row of ₹0 is noise.
  const statutory = statutoryLines(b);
  const hasDeductions = statutory.length > 0 || componentDeductions.length > 0;

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="px-6 py-4 border-b border-border flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2"><Wallet size={16} className="text-primary" /> My Salary Structure</h2>
          <p className="text-xs text-secondary mt-0.5">
            Your fixed monthly structure — a payslip prorates this by attendance.{data.configured ? '' : ' (Not yet finalised by HR.)'}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-secondary">Monthly CTC</p>
          <p className="text-lg font-bold text-foreground">{formatINR(b.ctc)}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border">
        <div className="bg-card p-5">
          <p className="text-xs font-semibold text-secondary uppercase mb-2.5">Earnings</p>
          <div className="space-y-1.5 text-sm">
            {earnings.map((l: any) => <SalRow key={l.name} label={l.name} value={l.amount} />)}
          </div>
          <div className="flex items-center justify-between text-sm font-semibold border-t border-border mt-2.5 pt-2.5">
            <span>Gross</span><span>{formatINR(b.gross_earnings)}</span>
          </div>
        </div>
        <div className="bg-card p-5">
          <p className="text-xs font-semibold text-secondary uppercase mb-2.5">Deductions</p>
          <div className="space-y-1.5 text-sm">
            {statutory.map(([label, v]) => <SalRow key={label} label={label} value={v} />)}
            {componentDeductions.map((l: any) => <SalRow key={l.name} label={l.name} value={l.amount} />)}
            {!hasDeductions && <p className="text-xs text-secondary">No deductions.</p>}
          </div>
          <div className="flex items-center justify-between text-sm font-semibold border-t border-border mt-2.5 pt-2.5">
            <span>Net (full month)</span><span className="text-green-700">{formatINR(b.net_pay)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
