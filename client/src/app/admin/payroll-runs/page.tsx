'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  ArrowLeft, Play, Lock, LockOpen, Loader2, CheckCircle2, AlertTriangle,
} from 'lucide-react';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const inr = (n: any) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

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

  const { data: runs = [], isLoading } = useQuery({
    queryKey: ['payroll-runs'],
    queryFn: () => api.get('/payroll/runs').then(r => r.data),
    enabled: canManage,
  });

  const runMutation = useMutation({
    mutationFn: () => api.post('/payroll/runs', { month, year }).then(r => r.data),
    onSuccess: (data) => {
      setLastRun(data);
      queryClient.invalidateQueries({ queryKey: ['payroll-runs'] });
      toast.success(`Payroll run: ${data.generated} payslip(s) generated`);
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Payroll run failed'),
  });

  const lockMutation = useMutation({
    mutationFn: (vars: { month: number; year: number; lock: boolean }) =>
      api.post(`/payroll/runs/${vars.lock ? 'lock' : 'unlock'}`, { month: vars.month, year: vars.year }).then(r => r.data),
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ['payroll-runs'] });
      toast.success(vars.lock ? 'Payroll locked' : 'Payroll unlocked');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Action failed'),
  });

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
          <button
            onClick={() => router.push('/admin')}
            className="flex items-center gap-2 text-secondary hover:text-foreground text-sm transition-colors mb-2"
          >
            <ArrowLeft size={16} /> Back to Admin
          </button>
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
                <span>Total Net: <span className="font-medium text-foreground">{inr(lastRun.total_net)}</span></span>
                <span>Total CTC: <span className="font-medium text-foreground">{inr(lastRun.total_ctc)}</span></span>
              </div>
              {lastRun.skipped?.length > 0 && (
                <p className="text-xs text-amber-600 mt-2">
                  Skipped {lastRun.skipped.length} employee(s) without salary setup:{' '}
                  {lastRun.skipped.slice(0, 5).map((s: any) => s.employee_code).join(', ')}
                  {lastRun.skipped.length > 5 ? '…' : ''}
                </p>
              )}
            </div>
          )}
        </div>

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
                        <td className="px-4 py-3 text-sm text-right text-foreground">{inr(r.total_net)}</td>
                        <td className="px-4 py-3 text-sm text-right text-foreground">{inr(r.total_ctc)}</td>
                        <td className="px-6 py-3 text-right">
                          {locked ? (
                            canUnlock ? (
                              <button
                                onClick={() => {
                                  if (confirm(`Unlock payroll for ${MONTHS[r.month - 1]} ${r.year}? This allows regeneration.`))
                                    lockMutation.mutate({ month: r.month, year: r.year, lock: false });
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
    </AppShell>
  );
}
