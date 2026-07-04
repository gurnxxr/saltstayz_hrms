'use client';

import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import Breadcrumb from '@/components/ui/Breadcrumb';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { formatINR } from '@/lib/utils';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { Search, Layers, Loader2, Save, Plus, Trash2, X, IndianRupee } from 'lucide-react';

// Operating cities/states — resolve to a statutory state on the server.
const CITIES = ['Haryana', 'Gurugram', 'Faridabad', 'Delhi', 'Noida', 'Greater Noida', 'Uttar Pradesh', 'Chandigarh', 'Dehradun', 'Uttarakhand'];

const CALC_TYPES = [
  { v: 'flat', label: 'Flat amount ₹' },
  { v: 'pct_of_base', label: '% of base' },
  { v: 'pct_of_basic', label: '% of Basic' },
  { v: 'remainder', label: 'Remainder (base − other earnings)' },
];

const CATEGORY_LABEL: Record<string, string> = {
  earning: 'Earning', deduction: 'Deduction', benefit: 'Benefit (employer)', reimbursement: 'Reimbursement',
};

interface LineDraft { component_id: string; calculation_type: string; value: string }
interface FormState {
  name: string; job_title_id: string; payment_basis: string;
  default_base: string; city: string; is_active: boolean; lines: LineDraft[];
}

const emptyForm = (): FormState => ({
  name: '', job_title_id: '', payment_basis: 'monthly', default_base: '', city: 'Haryana', is_active: true,
  lines: [{ component_id: '', calculation_type: 'pct_of_base', value: '50' }],
});

const inputCls = 'w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';

export default function SalaryStructurePage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [confirmDel, setConfirmDel] = useState<any | null>(null);

  const { data: list = [], isLoading } = useQuery({
    queryKey: ['salary-structures'],
    queryFn: () => api.get('/admin/salary-structures').then(r => r.data),
  });
  const { data: components = [] } = useQuery({
    queryKey: ['structure-components'],
    queryFn: () => api.get('/admin/salary-structures/components').then(r => r.data),
  });
  const { data: jobTitles = [] } = useQuery({
    queryKey: ['job-titles'],
    queryFn: () => api.get('/admin/job-titles').then(r => r.data),
  });

  const selected = useMemo(
    () => (typeof selectedId === 'number' ? list.find((x: any) => x.id === selectedId) : null),
    [list, selectedId],
  );

  useEffect(() => {
    if (selectedId === 'new') { setForm(emptyForm()); return; }
    if (selected) {
      setForm({
        name: selected.name ?? '',
        job_title_id: selected.job_title_id != null ? String(selected.job_title_id) : '',
        payment_basis: selected.payment_basis ?? 'monthly',
        default_base: String(selected.default_base ?? ''),
        city: selected.city ?? 'Haryana',
        is_active: !!selected.is_active,
        lines: (selected.lines ?? []).map((l: any) => ({
          component_id: String(l.component_id), calculation_type: l.calculation_type, value: String(l.value ?? 0),
        })),
      });
    }
  }, [selected, selectedId]);

  const set = (k: keyof FormState, v: any) => setForm((p) => ({ ...p, [k]: v }));
  const setLine = (idx: number, patch: Partial<LineDraft>) =>
    setForm((p) => ({ ...p, lines: p.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)) }));
  const addLine = () => setForm((p) => ({ ...p, lines: [...p.lines, { component_id: '', calculation_type: 'flat', value: '0' }] }));
  const removeLine = (idx: number) => setForm((p) => ({ ...p, lines: p.lines.filter((_, i) => i !== idx) }));

  const payload = () => ({
    name: form.name.trim(),
    job_title_id: form.job_title_id ? Number(form.job_title_id) : null,
    payment_basis: form.payment_basis,
    default_base: Number(form.default_base) || 0,
    city: form.city,
    is_active: form.is_active,
    lines: form.lines
      .filter((l) => l.component_id)
      .map((l) => ({ component_id: Number(l.component_id), calculation_type: l.calculation_type, value: Number(l.value) || 0 })),
  });

  // Live server preview of the draft (debounced) — matches the payslip engine exactly.
  const previewInput = useDebouncedValue(JSON.stringify({ lines: payload().lines, base: Number(form.default_base) || 0, city: form.city }), 400);
  const { data: preview } = useQuery({
    queryKey: ['structure-preview', previewInput],
    queryFn: () => api.post('/admin/salary-structures/preview', JSON.parse(previewInput)).then(r => r.data),
    enabled: selectedId !== null && payload().lines.length > 0 && (Number(form.default_base) || 0) > 0,
    placeholderData: (prev) => prev,
  });

  const saveMutation = useMutation({
    mutationFn: () => (selectedId === 'new'
      ? api.post('/admin/salary-structures', payload())
      : api.put(`/admin/salary-structures/${selectedId}`, payload())),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['salary-structures'] });
      toast.success(selectedId === 'new' ? 'Structure created' : 'Structure saved');
      if (selectedId === 'new' && res.data?.id) setSelectedId(res.data.id);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/salary-structures/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salary-structures'] });
      toast.success('Structure deleted');
      setConfirmDel(null);
      setSelectedId(null);
    },
    onError: (e: any) => { toast.error(e.response?.data?.error || 'Failed to delete'); setConfirmDel(null); },
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return list.filter((x: any) => !q || x.name?.toLowerCase().includes(q) || x.designation?.toLowerCase().includes(q));
  }, [list, search]);

  const componentById = useMemo(() => new Map(components.map((c: any) => [String(c.id), c])), [components]);

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <Breadcrumb className="mb-2" items={[{ label: 'Admin', href: '/admin' }, { label: 'Salary Structures' }]} />
          <h1 className="text-2xl font-bold text-foreground">Salary Structures</h1>
          <p className="text-secondary mt-1">Component-based templates — one per employee category. Creating a new category is creating a new structure here, no code involved. Employees are assigned a structure + base in Admin → Salary Assignments.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5 items-start">
          {/* Structure list */}
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="p-3 border-b border-border space-y-2">
              <button onClick={() => setSelectedId('new')}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
                <Plus size={15} /> New Structure
              </button>
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search structures..."
                  className="w-full pl-9 pr-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
              </div>
            </div>
            <div className="max-h-[600px] overflow-y-auto divide-y divide-border">
              {isLoading ? (
                <div className="p-3 space-y-2">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-11 bg-muted rounded animate-pulse" />)}</div>
              ) : filtered.map((s: any) => (
                <button key={s.id} onClick={() => setSelectedId(s.id)}
                  className={`w-full text-left px-4 py-2.5 transition-colors ${selectedId === s.id ? 'bg-primary/5' : 'hover:bg-muted/40'}`}>
                  <div className="flex items-center gap-2">
                    <Layers size={14} className="text-secondary shrink-0" />
                    <span className="text-sm font-medium text-foreground truncate flex-1">{s.name}</span>
                    {!s.is_active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-secondary">Inactive</span>}
                  </div>
                  <p className="text-[11px] text-secondary mt-0.5 ml-6">
                    {s.designation || 'No designation'} · {s.assignment_count} assigned · CTC {formatINR(s.breakdown?.ctc ?? 0)}/mo
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Editor + preview */}
          {selectedId === null ? (
            <div className="bg-card rounded-xl border border-border flex flex-col items-center justify-center py-20 text-secondary">
              <IndianRupee size={40} className="opacity-30 mb-3" />
              <p className="text-sm">Select a structure, or create a new one for a new employee category</p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="bg-card rounded-xl border border-border p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-foreground">
                    {selectedId === 'new' ? 'New Salary Structure' : `Edit — ${selected?.name ?? ''}`}
                  </h2>
                  <div className="flex items-center gap-2">
                    {typeof selectedId === 'number' && (
                      <button onClick={() => setConfirmDel(selected)}
                        className="p-2 rounded-lg text-secondary hover:text-red-600 hover:bg-red-50 transition-colors" title="Delete">
                        <Trash2 size={16} />
                      </button>
                    )}
                    <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !form.name || !form.default_base}
                      className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                      {saveMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="col-span-2 md:col-span-1">
                    <label className="block text-xs font-medium text-secondary mb-1">Name<span className="text-red-600"> *</span></label>
                    <input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. F&B Service Staff" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-secondary mb-1">Designation (optional)</label>
                    <select className={inputCls} value={form.job_title_id} onChange={(e) => set('job_title_id', e.target.value)}>
                      <option value="">— None —</option>
                      {jobTitles.map((jt: any) => <option key={jt.id} value={jt.id}>{jt.title}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-secondary mb-1">Payment basis</label>
                    <select className={inputCls} value={form.payment_basis} onChange={(e) => set('payment_basis', e.target.value)}>
                      <option value="monthly">Monthly-rated</option>
                      <option value="hourly">Hourly-rated (payroll in Phase 3)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-secondary mb-1">Default base {form.payment_basis === 'hourly' ? '₹/hour' : '₹/month'}<span className="text-red-600"> *</span></label>
                    <input type="number" className={inputCls} value={form.default_base} onChange={(e) => set('default_base', e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-secondary mb-1">City / State (statutory)</label>
                    <select className={inputCls} value={form.city} onChange={(e) => set('city', e.target.value)}>
                      {!CITIES.includes(form.city) && form.city && <option value={form.city}>{form.city}</option>}
                      {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 mt-5 cursor-pointer select-none">
                    <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)}
                      className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-primary/50" />
                    <span className="text-sm text-foreground">Active</span>
                  </label>
                </div>

                {/* Component lines */}
                <div className="flex items-center justify-between mt-5 mb-2">
                  <p className="text-xs font-semibold text-secondary uppercase">Components</p>
                  <button onClick={addLine}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors">
                    <Plus size={14} /> Add component
                  </button>
                </div>
                <div className="space-y-2">
                  {form.lines.map((line, idx) => {
                    const comp: any = componentById.get(line.component_id);
                    return (
                      <div key={idx} className="grid grid-cols-[1fr_170px_120px_36px] gap-2 items-center">
                        <select className={inputCls} value={line.component_id} onChange={(e) => setLine(idx, { component_id: e.target.value })}>
                          <option value="">Select component…</option>
                          {['earning', 'deduction', 'benefit', 'reimbursement'].map((cat) => (
                            <optgroup key={cat} label={CATEGORY_LABEL[cat]}>
                              {components.filter((c: any) => c.category === cat).map((c: any) => (
                                <option key={c.id} value={c.id}>{c.name_in_payslip || c.name}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        <select className={inputCls} value={line.calculation_type} onChange={(e) => setLine(idx, { calculation_type: e.target.value })}>
                          {CALC_TYPES
                            .filter((t) => t.v !== 'remainder' || comp?.category === 'earning')
                            .map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
                        </select>
                        <input type="number" step="any" className={inputCls} value={line.value}
                          disabled={line.calculation_type === 'remainder'}
                          onChange={(e) => setLine(idx, { value: e.target.value })} />
                        <button onClick={() => removeLine(idx)}
                          className="p-1.5 rounded-lg text-secondary hover:text-red-600 hover:bg-red-50 transition-colors" title="Remove">
                          <X size={16} />
                        </button>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-secondary mt-3">
                  EPF, ESI and LWF are applied automatically from each component&apos;s applicability flags and the state-wise rates in{' '}
                  <a href="/setup/statutory-components" className="underline hover:text-foreground">Payroll → Statutory Components</a>.
                </p>
              </div>

              {/* Live server preview */}
              {preview && (
                <div className="bg-card rounded-xl border border-border overflow-hidden">
                  <div className="px-5 py-3 border-b border-border bg-muted/30">
                    <h3 className="text-sm font-semibold text-foreground">Payslip preview at {formatINR(Number(form.default_base) || 0)} base</h3>
                  </div>
                  <table className="w-full text-sm">
                    <tbody>
                      {preview.earnings.map((l: any) => <Row key={`e-${l.name}`} label={l.name} value={l.amount} sub />)}
                      <Row label="Gross Earnings" value={preview.gross_earnings} strong />
                      <Row label="Employee PF" value={preview.employee_pf} sub />
                      <Row label="ESI" value={preview.esi} sub />
                      <Row label="LWF" value={preview.lwf} sub />
                      {preview.other_deductions.map((l: any) => <Row key={`d-${l.name}`} label={l.name} value={l.amount} sub />)}
                      <Row label="Total Deduction" value={preview.total_deduction} head />
                      <Row label="Net In Hand" value={preview.net_pay} strong highlight />
                      <Row label="Employer PF + ESI + LWF" value={preview.employer_pf + preview.employer_esi + preview.employer_lwf} sub />
                      {preview.employer_costs.map((l: any) => <Row key={`b-${l.name}`} label={l.name} value={l.amount} sub />)}
                      <Row label="CTC" value={preview.ctc} strong highlight />
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmDel}
        title="Delete salary structure?"
        message={confirmDel ? <>This permanently removes <span className="font-medium text-foreground">{confirmDel.name}</span>. Structures with assigned employees can&apos;t be deleted.</> : undefined}
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
        onConfirm={() => confirmDel && deleteMutation.mutate(confirmDel.id)}
        onCancel={() => setConfirmDel(null)}
      />
    </AppShell>
  );
}

function Row({ label, value, sub, head, strong, highlight }: {
  label: string; value: number; sub?: boolean; head?: boolean; strong?: boolean; highlight?: boolean;
}) {
  return (
    <tr className={`border-b border-border ${highlight ? 'bg-primary/5' : head ? 'bg-muted/30' : ''}`}>
      <td className={`px-5 py-2 ${sub ? 'pl-10 text-secondary' : 'text-foreground'} ${head || strong ? 'font-semibold' : ''}`}>{label}</td>
      <td className={`px-5 py-2 text-right ${strong ? 'font-bold text-primary' : head ? 'font-semibold text-foreground' : 'text-foreground'}`}>{formatINR(value)}</td>
    </tr>
  );
}
