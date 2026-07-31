'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import Breadcrumb from '@/components/ui/Breadcrumb';
import LoadError from '@/components/ui/LoadError';
import api from '@/lib/api';
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning';
import { SlidersHorizontal, Info, Save, Loader2 } from 'lucide-react';

interface PayRule {
  code: string;
  label: string;
  pay_fraction: number;
  counts_in_denominator: boolean;
  deducts_leave_fraction: number;
  config: { allowance?: number; beyond_pay_fraction?: number };
}

// The local, editable copy of one rule (config flattened for the two miss-punch fields).
interface Edit {
  pay_fraction: number;
  counts_in_denominator: boolean;
  deducts_leave_fraction: number;
  allowance: number;
  beyond_pay_fraction: number;
}

const toEdit = (r: PayRule): Edit => ({
  pay_fraction: r.pay_fraction,
  counts_in_denominator: r.counts_in_denominator,
  deducts_leave_fraction: r.deducts_leave_fraction,
  allowance: Number(r.config?.allowance ?? 0),
  beyond_pay_fraction: Number(r.config?.beyond_pay_fraction ?? 0.5),
});

const same = (a: Edit, b: Edit) =>
  a.pay_fraction === b.pay_fraction &&
  a.counts_in_denominator === b.counts_in_denominator &&
  a.deducts_leave_fraction === b.deducts_leave_fraction &&
  a.allowance === b.allowance &&
  a.beyond_pay_fraction === b.beyond_pay_fraction;

// Which named preset a pay fraction matches; anything else is "Custom".
const presetOf = (f: number): 'full' | 'half' | 'none' | 'custom' =>
  f === 1 ? 'full' : f === 0.5 ? 'half' : f === 0 ? 'none' : 'custom';

export default function AttendancePayRulesPage() {
  const qc = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery<PayRule[]>({
    queryKey: ['attendance-pay-rules'],
    queryFn: () => api.get('/attendance-pay-rules').then((r) => r.data),
  });

  // Editable copy keyed by code, plus the pristine baseline to compute per-row dirtiness.
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [base, setBase] = useState<Record<string, Edit>>({});

  useEffect(() => {
    if (!data) return;
    const e: Record<string, Edit> = {};
    for (const r of data) e[r.code] = toEdit(r);
    setEdits(e);
    setBase(JSON.parse(JSON.stringify(e)));
  }, [data]);

  const anyDirty = data?.some((r) => edits[r.code] && base[r.code] && !same(edits[r.code], base[r.code])) ?? false;
  useUnsavedChangesWarning(anyDirty);

  const set = (code: string, patch: Partial<Edit>) =>
    setEdits((prev) => ({ ...prev, [code]: { ...prev[code], ...patch } }));

  const save = useMutation({
    mutationFn: (code: string) => {
      const e = edits[code];
      return api.put(`/attendance-pay-rules/${code}`, {
        pay_fraction: e.pay_fraction,
        counts_in_denominator: e.counts_in_denominator,
        deducts_leave_fraction: e.deducts_leave_fraction,
        config: { allowance: e.allowance, beyond_pay_fraction: e.beyond_pay_fraction },
      }).then((r) => r.data);
    },
    onSuccess: () => {
      toast.success('Rule saved');
      qc.invalidateQueries({ queryKey: ['attendance-pay-rules'] });
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to save'),
  });

  return (
    <AppShell>
      <div className="space-y-6 max-w-4xl">
        <Breadcrumb items={[{ label: 'Payroll' }, { label: 'Attendance Pay Rules' }]} />
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><SlidersHorizontal className="text-primary" size={20} /></div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Attendance Pay Rules</h1>
            <p className="text-secondary text-sm">Set how much each attendance code pays — no code change needed.</p>
          </div>
        </div>

        <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 p-3">
          <Info size={15} className="text-secondary mt-0.5 shrink-0" />
          <p className="text-xs text-secondary">
            Payroll pays each day by its code&apos;s rule below. Two things always take priority: an{' '}
            <span className="font-medium text-foreground">approved regularisation</span> pays the day in full, and an{' '}
            <span className="font-medium text-foreground">approved paid leave</span> is paid as leave — both override the code rule.
            Changing a rule only affects <span className="font-medium text-foreground">open</span> months; already-paid months keep the figures they were paid on.
          </p>
        </div>

        {isLoading ? (
          <div className="bg-card rounded-xl border border-border p-10 text-center text-secondary text-sm">Loading…</div>
        ) : isError ? (
          <div className="bg-card rounded-xl border border-border"><LoadError message="Couldn't load the attendance pay rules." onRetry={() => refetch()} /></div>
        ) : (
          <div className="space-y-4">
            {(data || []).map((r) => {
              const e = edits[r.code];
              if (!e) return null;
              const dirty = base[r.code] && !same(e, base[r.code]);
              const preset = presetOf(e.pay_fraction);
              const savingThis = save.isPending && save.variables === r.code;
              return (
                <div key={r.code} className="bg-card rounded-xl border border-border p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">{r.label}</h3>
                      <code className="text-xs text-secondary">{r.code}</code>
                    </div>
                    <button
                      onClick={() => save.mutate(r.code)}
                      disabled={!dirty || savingThis}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors"
                    >
                      {savingThis ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                      {dirty ? 'Save' : 'Saved'}
                    </button>
                  </div>

                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                    {/* Pay effect */}
                    <div>
                      <p className="text-xs font-medium text-foreground mb-1.5">Pays</p>
                      <div className="inline-flex rounded-lg border border-border overflow-hidden">
                        {([['full', 'Full', 1], ['half', 'Half', 0.5], ['none', 'None', 0]] as const).map(([key, lbl, val]) => (
                          <button
                            key={key}
                            onClick={() => set(r.code, { pay_fraction: val })}
                            className={`px-3 py-1.5 text-xs font-medium border-r border-border last:border-r-0 transition-colors ${preset === key ? 'bg-primary text-white' : 'bg-background text-secondary hover:bg-muted'}`}
                          >
                            {lbl}
                          </button>
                        ))}
                        <span className={`px-3 py-1.5 text-xs font-medium ${preset === 'custom' ? 'bg-primary text-white' : 'bg-background text-secondary'}`}>Custom</span>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <input
                          type="number" step="1" min={0} max={100}
                          value={Math.round(e.pay_fraction * 100)}
                          onChange={(ev) => set(r.code, { pay_fraction: Math.max(0, Math.min(100, Number(ev.target.value))) / 100 })}
                          className="w-20 px-3 py-1.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                        <span className="text-xs text-secondary">% of a day&apos;s pay</span>
                      </div>
                    </div>

                    {/* Denominator + leave */}
                    <div className="space-y-3">
                      <label className="flex items-start gap-2.5 cursor-pointer w-fit">
                        <input type="checkbox" className="accent-primary w-4 h-4 mt-0.5"
                          checked={e.counts_in_denominator}
                          onChange={(ev) => set(r.code, { counts_in_denominator: ev.target.checked })} />
                        <span>
                          <span className="text-xs font-medium text-foreground">Counts as a working day</span>
                          <span className="block text-[11px] text-secondary mt-0.5">Included in the salary divisor. Off for weekly-offs.</span>
                        </span>
                      </label>
                      <div>
                        <p className="text-xs font-medium text-foreground mb-1">Also uses paid leave</p>
                        <div className="flex items-center gap-2">
                          <select
                            value={String(e.deducts_leave_fraction)}
                            onChange={(ev) => set(r.code, { deducts_leave_fraction: Number(ev.target.value) })}
                            className="px-2 py-1.5 border border-border rounded-lg bg-background text-sm"
                          >
                            <option value="0">No leave used</option>
                            <option value="0.5">½ day of leave</option>
                            <option value="1">1 day of leave</option>
                          </select>
                        </div>
                        <p className="text-[11px] text-secondary mt-1">e.g. a Half Day = worked half + half a leave day.</p>
                      </div>
                    </div>

                    {/* Miss-punch allowance (only the code that has one) */}
                    {r.code === 'miss_punch' && (
                      <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 border-t border-border pt-4">
                        <div>
                          <p className="text-xs font-medium text-foreground mb-1">Free miss punches / month</p>
                          <input type="number" step="1" min={0} max={31} value={e.allowance}
                            onChange={(ev) => set(r.code, { allowance: Math.max(0, Math.min(31, Math.round(Number(ev.target.value)))) })}
                            className="w-24 px-3 py-1.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                          <p className="text-[11px] text-secondary mt-1">
                            {e.allowance === 0
                              ? 'Zero means no free ones — every miss punch pays the figure above.'
                              : 'Paid in full before any deduction applies.'}
                          </p>
                        </div>
                        {/* With no allowance there is nothing "beyond" it, so this figure decides nothing.
                            Disabled rather than hidden, so it is obvious the setting still exists. */}
                        <div className={e.allowance === 0 ? 'opacity-50' : undefined}>
                          <p className="text-xs font-medium text-foreground mb-1">Beyond the allowance, pays</p>
                          <div className="flex items-center gap-2">
                            <input type="number" step="1" min={0} max={100} value={Math.round(e.beyond_pay_fraction * 100)}
                              disabled={e.allowance === 0}
                              onChange={(ev) => set(r.code, { beyond_pay_fraction: Math.max(0, Math.min(100, Number(ev.target.value))) / 100 })}
                              className="w-20 px-3 py-1.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:cursor-not-allowed" />
                            <span className="text-xs text-secondary">% of a day&apos;s pay</span>
                          </div>
                          {e.allowance === 0 && (
                            <p className="text-[11px] text-secondary mt-1">Not used while the allowance is zero.</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
