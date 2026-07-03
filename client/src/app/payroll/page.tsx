'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import { formatINR } from '@/lib/utils';
import LoadError from '@/components/ui/LoadError';
import {
  FileText, Download, Loader2, Wallet, Calendar, IndianRupee, AlertTriangle,
} from 'lucide-react';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];


export default function PayrollPage() {
  const queryClient = useQueryClient();
  const now = new Date();

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
  });

  const generateMutation = useMutation({
    mutationFn: () => api.post('/payroll/me/payslip', { month, year }).then(r => r.data),
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ['my-payslip-history'] });
      toast.success('Payslip generated');
    },
    onError: (err: any) => {
      setResult(null);
      toast.error(err.response?.data?.error || 'Failed to generate payslip');
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
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">Payslips</h1>
          <p className="text-secondary mt-1">Generate and download your monthly payslip</p>
        </div>

        {/* Generator */}
        <div className="bg-card rounded-xl border border-border p-6">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4">
            <Wallet size={16} className="text-primary" /> Generate Payslip
          </h2>
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
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending || selectedIsFuture}
              className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {generateMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
              Generate Payslip
            </button>
          </div>
          {selectedIsFuture && (
            <p className="text-xs text-amber-600 mt-3 flex items-center gap-1">
              <AlertTriangle size={13} /> You can't generate a payslip for a future month.
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

            {/* Earnings + Deductions */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border">
              <Section title="Earnings" rows={[
                ['Basic', b.basic],
                ['HRA', b.hra],
                ['Other Allowance', b.other_allowance],
                ['PLI (Variable Pay)', b.pli],
              ]} total={['Gross Earnings', b.gross_earnings]} />
              <Section title="Deductions" rows={[
                ['Employee PF', b.employee_pf],
                ['ESI', b.esi],
                ['LWF', b.lwf],
                ['Meal', b.meal],
                ['Accommodation', b.accommodation],
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
                <CtcLine label="A + B  Gross Earnings" value={b.gross_earnings} bold />
                <CtcLine label="C. Retirals (Employer Contributions)" value={b.retirals} bold />
                <CtcLine label="Employer PF" value={b.employer_pf} indent />
                <CtcLine label="Gratuity" value={b.gratuity} indent />
                <CtcLine label="Employer LWF" value={b.employer_lwf} indent />
                <CtcLine label="D. Benefits" value={b.benefits} bold />
                <CtcLine label="Employer ESI / Medical Benefit" value={b.employer_esi} indent />
                <CtcLine label="Accommodation Allowance" value={b.accommodation_allowance} indent />
              </div>
              <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
                <p className="text-sm font-bold text-primary">Total CTC (A + B + C + D)</p>
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
