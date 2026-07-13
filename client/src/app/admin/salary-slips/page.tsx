'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import Breadcrumb from '@/components/ui/Breadcrumb';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatINR } from '@/lib/utils';
import PayslipPreview from '@/components/payroll/PayslipPreview';
import { FileText, Loader2, Users, AlertTriangle, CheckCircle2 } from 'lucide-react';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function AdminSalarySlipsPage() {
  const { user } = useAuth();
  const isAdmin = user?.roleName === 'admin';
  const now = new Date();

  const [bulkMonth, setBulkMonth] = useState(now.getMonth() + 1);
  const [bulkYear, setBulkYear] = useState(now.getFullYear());
  const [bulkResult, setBulkResult] = useState<any>(null);

  const [indivEmpId, setIndivEmpId] = useState<number | ''>('');
  const [indivMonth, setIndivMonth] = useState(now.getMonth() + 1);
  const [indivYear, setIndivYear] = useState(now.getFullYear());
  const [indivResult, setIndivResult] = useState<any>(null);

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);
  const isFutureMonth = (m: number, y: number) =>
    y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth() + 1);

  const { data: staffEmployees = [] } = useQuery({
    queryKey: ['payroll-employees'],
    queryFn: () => api.get('/payroll/employees').then(r => r.data),
    enabled: isAdmin,
  });

  const bulkMutation = useMutation({
    mutationFn: () => api.post('/payroll/runs', { month: bulkMonth, year: bulkYear }).then(r => r.data),
    onSuccess: (data) => { setBulkResult(data); toast.success(`${data.generated} payslip(s) generated`); },
    onError: (err: any) => { setBulkResult(null); toast.error(err.response?.data?.error || 'Bulk generation failed'); },
  });

  const indivMutation = useMutation({
    mutationFn: () => api.get(`/payroll/employees/${indivEmpId}/payslip?month=${indivMonth}&year=${indivYear}`).then(r => r.data),
    onSuccess: (data) => setIndivResult(data),
    onError: (err: any) => { setIndivResult(null); toast.error(err.response?.data?.error || "Could not generate this employee's payslip"); },
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
          <Breadcrumb className="mb-2" items={[{ label: 'Admin', href: '/admin' }, { label: 'Salary Slips' }]} />
          <h1 className="text-2xl font-bold text-foreground">Salary Slips</h1>
          <p className="text-secondary mt-1">Generate and download the salary slip of any employee, or run payroll for everyone.</p>
        </div>

        {!isAdmin ? (
          <div className="bg-card rounded-xl border border-border p-12 text-center text-secondary">
            <FileText size={40} className="mx-auto text-secondary/30 mb-3" />
            <p>This page is available to administrators only.</p>
          </div>
        ) : (
          <>
            {/* Bulk generate */}
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

            {/* Individual salary slip — any employee */}
            <div className="bg-card rounded-xl border border-border p-6">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-1">
                <FileText size={16} className="text-primary" /> Generate Individual Salary Slip
              </h2>
              <p className="text-xs text-secondary mb-4">Select an employee and month to generate, preview and download their salary slip.</p>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1">Employee</label>
                  <select value={indivEmpId} onChange={(e) => { setIndivEmpId(e.target.value ? Number(e.target.value) : ''); setIndivResult(null); }}
                    className="px-3 py-2.5 border border-border rounded-lg bg-background text-sm min-w-[260px] focus:outline-none focus:ring-2 focus:ring-primary/50">
                    <option value="">Select an employee…</option>
                    {staffEmployees.map((e: any) => (
                      <option key={e.id} value={e.id}>{e.employee_code} — {e.first_name} {e.last_name}{e.designation ? ` (${e.designation})` : ''}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1">Month</label>
                  <select value={indivMonth} onChange={(e) => { setIndivMonth(Number(e.target.value)); setIndivResult(null); }}
                    className="px-3 py-2.5 border border-border rounded-lg bg-background text-sm min-w-[140px] focus:outline-none focus:ring-2 focus:ring-primary/50">
                    {MONTHS.map((m, i) => <option key={m} value={i + 1} disabled={isFutureMonth(i + 1, indivYear)}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1">Year</label>
                  <select value={indivYear} onChange={(e) => { setIndivYear(Number(e.target.value)); setIndivResult(null); }}
                    className="px-3 py-2.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                    {years.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <button onClick={() => indivMutation.mutate()} disabled={indivMutation.isPending || !indivEmpId || isFutureMonth(indivMonth, indivYear)}
                  className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                  {indivMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
                  Generate
                </button>
              </div>
              {isFutureMonth(indivMonth, indivYear) && (
                <p className="text-xs text-amber-600 mt-3 flex items-center gap-1"><AlertTriangle size={13} /> A payslip for a future month isn&apos;t available.</p>
              )}
              {indivResult && indivResult.breakdown && (
                <div className="mt-5">
                  <PayslipPreview
                    result={indivResult}
                    downloadHref={`/payroll/employees/${indivEmpId}/payslip/pdf?month=${indivResult.month}&year=${indivResult.year}`}
                    download={download}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
