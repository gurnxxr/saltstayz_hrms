'use client';

import { use, useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import { formatDate, formatINR } from '@/lib/utils';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import {
  ArrowLeft, CheckCircle2, Circle, Loader2, UserMinus, ShieldOff,
  IndianRupee, Calendar, Briefcase, Building2,
} from 'lucide-react';


export default function OffboardingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [fnf, setFnf] = useState<any>(null);

  const { data: c, isLoading } = useQuery({
    queryKey: ['offboarding-case', id],
    queryFn: () => api.get(`/offboarding/cases/${id}`).then(r => r.data),
  });

  useEffect(() => {
    if (c) setFnf(c.fnf_details || c.fnf_suggested || null);
  }, [c]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['offboarding-case', id] });
    queryClient.invalidateQueries({ queryKey: ['offboarding-cases'] });
    queryClient.invalidateQueries({ queryKey: ['offboarding-stats'] });
  };

  const toggleItem = useMutation({
    mutationFn: (itemId: number) => api.put(`/offboarding/items/${itemId}/toggle`),
    onSuccess: invalidate,
  });
  const saveFnf = useMutation({
    mutationFn: () => api.put(`/offboarding/cases/${id}/fnf`, fnf),
    onSuccess: () => { invalidate(); toast.success('Settlement saved'); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });
  const completeMutation = useMutation({
    mutationFn: () => api.post(`/offboarding/cases/${id}/complete`),
    onSuccess: () => { invalidate(); setConfirmComplete(false); toast.success('Exit completed — employee deactivated and login revoked'); },
    onError: (e: any) => { toast.error(e.response?.data?.error || 'Failed to complete'); setConfirmComplete(false); },
  });

  if (isLoading || !c) {
    return <AppShell><div className="space-y-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />)}</div></AppShell>;
  }

  const items: any[] = c.items || [];
  const done = items.filter((i) => i.is_completed).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;
  const completed = c.status === 'completed';
  const grouped = items.reduce((acc: Record<string, any[]>, it) => { (acc[it.category] ||= []).push(it); return acc; }, {});

  // Recompute net live as HR edits components
  const net = fnf ? (Number(fnf.prorated_salary || 0) + Number(fnf.leave_encashment || 0) + Number(fnf.gratuity || 0) - Number(fnf.deductions || 0)) : 0;
  const setF = (k: string, v: any) => setFnf((p: any) => ({ ...p, [k]: v === '' ? 0 : Number(v), net_payable: 0 }));

  return (
    <AppShell>
      <div className="space-y-6">
        <button onClick={() => router.push('/offboarding')} className="flex items-center gap-2 text-secondary hover:text-foreground text-sm transition-colors">
          <ArrowLeft size={16} /> Back to Offboarding
        </button>

        {/* Header */}
        <div className="bg-card rounded-xl border border-border p-5">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-xl font-bold text-foreground">{c.first_name} {c.last_name}</h1>
              <p className="text-sm text-secondary">{c.employee_code} · {c.designation || '—'}</p>
              <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-sm">
                <span className="flex items-center gap-1.5 text-secondary"><Briefcase size={14} /> {c.exit_type?.replace(/_/g, ' ')}</span>
                <span className="flex items-center gap-1.5 text-secondary"><Building2 size={14} /> {c.dept_name || '—'} · {c.branch_name || '—'}</span>
                <span className="flex items-center gap-1.5 text-secondary"><Calendar size={14} /> LWD {formatDate(c.last_working_day)}</span>
              </div>
            </div>
            <div className="text-right">
              {completed ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-100 text-green-700 text-sm font-medium"><CheckCircle2 size={15} /> Exit completed</span>
              ) : (
                <button onClick={() => setConfirmComplete(true)} disabled={done < items.length}
                  title={done < items.length ? 'Complete all clearance items first' : 'Finalize exit'}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors">
                  <ShieldOff size={15} /> Complete Exit &amp; Revoke Access
                </button>
              )}
              {!c.is_active && <p className="text-xs text-red-600 mt-2 flex items-center gap-1 justify-end"><ShieldOff size={12} /> Login revoked · account inactive</p>}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
          {/* Clearance checklist */}
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <h2 className="font-semibold text-foreground">Clearance Checklist</h2>
              <span className="text-sm text-secondary">{done}/{items.length} done</span>
            </div>
            <div className="px-5 pt-3">
              <div className="h-2 bg-muted rounded-full overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} /></div>
            </div>
            <div className="p-3 space-y-4">
              {Object.entries(grouped).map(([cat, list]) => (
                <div key={cat}>
                  <p className="text-xs font-semibold text-secondary uppercase px-2 mb-1">{cat}</p>
                  <div className="space-y-1">
                    {(list as any[]).map((it) => (
                      <button key={it.id} disabled={completed || toggleItem.isPending} onClick={() => toggleItem.mutate(it.id)}
                        className={`w-full flex items-start gap-2.5 px-2 py-2 rounded-lg text-left transition-colors ${completed ? 'cursor-default' : 'hover:bg-muted/40'}`}>
                        {it.is_completed ? <CheckCircle2 size={18} className="text-green-600 shrink-0 mt-0.5" /> : <Circle size={18} className="text-secondary shrink-0 mt-0.5" />}
                        <span className={`text-sm ${it.is_completed ? 'text-secondary line-through' : 'text-foreground'}`}>{it.item_name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Full & Final settlement */}
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center gap-2">
              <IndianRupee size={16} className="text-primary" />
              <h2 className="font-semibold text-foreground">Full &amp; Final Settlement</h2>
            </div>
            {!fnf ? (
              <p className="p-5 text-sm text-secondary">Salary not configured for this employee — settlement cannot be computed.</p>
            ) : (
              <div className="p-5 space-y-3">
                <FnfRow label={`Salary — ${fnf.days_worked}/${fnf.days_in_month} days`} value={fnf.prorated_salary} onChange={(v) => setF('prorated_salary', v)} disabled={completed} />
                <FnfRow label={`Leave encashment (${fnf.leave_balance_days} d)`} value={fnf.leave_encashment} onChange={(v) => setF('leave_encashment', v)} disabled={completed} />
                <FnfRow label={`Gratuity${fnf.gratuity_eligible ? '' : ' (n/a <5y)'}`} value={fnf.gratuity} onChange={(v) => setF('gratuity', v)} disabled={completed} />
                <FnfRow label="Deductions (advances/notice)" value={fnf.deductions} onChange={(v) => setF('deductions', v)} disabled={completed} negative />
                <div className="border-t border-border pt-3 flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">Net Payable</span>
                  <span className="text-lg font-bold text-primary">{formatINR(net)}</span>
                </div>
                {!completed && (
                  <button onClick={() => saveFnf.mutate()} disabled={saveFnf.isPending}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-primary text-primary rounded-lg text-sm font-medium hover:bg-primary/5 disabled:opacity-50">
                    {saveFnf.isPending ? <Loader2 size={15} className="animate-spin" /> : <IndianRupee size={15} />} Save settlement
                  </button>
                )}
                {c.fnf_amount != null && <p className="text-xs text-secondary text-center">Last saved: {formatINR(c.fnf_amount)}</p>}
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmComplete}
        title="Complete exit and revoke access?"
        message={<>This will mark <strong className="text-foreground">{c.first_name} {c.last_name}</strong> inactive, <strong className="text-foreground">revoke their login</strong>, and record the exit ({formatDate(c.last_working_day)}) for attrition reporting. This cannot be undone.</>}
        confirmLabel="Complete exit"
        loading={completeMutation.isPending}
        onConfirm={() => completeMutation.mutate()}
        onCancel={() => setConfirmComplete(false)}
      />
    </AppShell>
  );
}

function FnfRow({ label, value, onChange, disabled, negative }: { label: string; value: any; onChange: (v: string) => void; disabled?: boolean; negative?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-secondary">{label}</span>
      <div className="flex items-center gap-1">
        {negative && <span className="text-secondary text-sm">−</span>}
        <span className="text-secondary text-sm">₹</span>
        <input type="number" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
          className="w-28 px-2 py-1 border border-border rounded bg-background text-sm text-right disabled:opacity-70" />
      </div>
    </div>
  );
}
