'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import Breadcrumb from '@/components/ui/Breadcrumb';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatINR } from '@/lib/utils';
import LoadError from '@/components/ui/LoadError';
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

  const { data: myStructure } = useQuery({
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
    } catch {
      toast.error('Failed to download PDF');
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <Breadcrumb className="mb-2" items={[{ label: 'Salary' }]} />
          <h1 className="text-2xl font-bold text-foreground">Salary</h1>
          <p className="text-secondary mt-1">Your salary structure and payslips</p>
        </div>

        {!hasProfile ? (
          <div className="bg-card rounded-xl border border-border p-8 text-center">
            <FileText size={32} className="mx-auto text-secondary/30 mb-2" />
            <p className="text-sm font-medium text-foreground">No salary on this account</p>
            <p className="text-sm text-secondary mt-1">Your login isn&apos;t linked to an employee profile, so there&apos;s no personal salary to show.</p>
          </div>
        ) : (
          <>
            {/* My Salary Structure — read-only */}
            {myStructure?.breakdown && <MySalaryStructure data={myStructure} />}

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
  const statutory: [string, number][] = ([
    ['Provident Fund', b.employee_pf], ['ESI', b.esi], ['Professional Tax', b.pt], ['Labour Welfare Fund', b.lwf],
  ] as [string, number][]).filter(([, v]) => v);
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
