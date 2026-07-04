'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import Breadcrumb from '@/components/ui/Breadcrumb';
import LoadError from '@/components/ui/LoadError';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import api from '@/lib/api';
import { formatINR } from '@/lib/utils';
import { Coins, Plus, ChevronDown, MoreHorizontal, X, Save, Loader2, Info, Sparkles, AlertTriangle } from 'lucide-react';

type Cat = 'earning' | 'deduction' | 'benefit' | 'reimbursement';

const TABS: { key: Cat; label: string }[] = [
  { key: 'earning', label: 'Earnings' },
  { key: 'deduction', label: 'Deductions' },
  { key: 'benefit', label: 'Benefits' },
  { key: 'reimbursement', label: 'Reimbursements' },
];

const ADD_ITEMS: { label: string; cat: Cat; title: string }[] = [
  { label: 'Earning', cat: 'earning', title: 'New Earning' },
  { label: 'Correction', cat: 'earning', title: 'New Correction' }, // correction = an earnings-type adjustment
  { label: 'Benefit', cat: 'benefit', title: 'New Benefit' },
  { label: 'Deduction', cat: 'deduction', title: 'New Deduction' },
  { label: 'Reimbursement', cat: 'reimbursement', title: 'New Reimbursement' },
];

const EARNING_TYPE_OPTIONS = [
  'Basic', 'House Rent Allowance', 'Dearness Allowance', 'Retaining Allowance', 'Conveyance Allowance',
  'Children Education Allowance', 'Transport Allowance', 'Travelling Allowance', 'Fixed Allowance',
  'Overtime Allowance', 'Special Allowance', 'Medical Allowance',
];
// Templates whose nature is Variable (paid ad-hoc, not a fixed structure line);
// everything else defaults to Fixed. Drives the table's EARNING TYPE column.
const VARIABLE_EARNING_TEMPLATES = new Set(['Travelling Allowance', 'Overtime Allowance']);

const inputCls = 'w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';
const Req = () => <span className="text-red-600">*</span>;

function InfoTip({ text }: { text: string }) {
  return <span className="inline-flex text-secondary cursor-help align-middle" title={text} aria-label="More info"><Info size={14} /></span>;
}
function Field({ label, required, children, hint }: { label: React.ReactNode; required?: boolean; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-foreground mb-1.5">{label}{required && <> <Req /></>}</span>
      {children}
      {hint && <span className="block text-xs text-secondary mt-1">{hint}</span>}
    </label>
  );
}
function Check({ checked, onChange, disabled, children }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <label className={`flex items-start gap-2.5 text-sm ${disabled ? 'opacity-50' : 'cursor-pointer'} text-foreground`}>
      <input type="checkbox" className="accent-primary w-4 h-4 mt-0.5" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}
function StatusBadge({ status }: { status: string }) {
  return status === 'active'
    ? <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">Active</span>
    : <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-medium">Inactive</span>;
}

// Earning calculation-type display, e.g. "50% of CTC" / "Flat amount of 1600" / "Flat Amount".
function calcLabel(c: any) {
  if (c.calculationType === 'percentage') return `${c.percentage}% of ${c.percentOf === 'ctc' ? 'CTC' : 'Basic'}`;
  return Number(c.amount) > 0 ? `Flat amount of ${c.amount}` : 'Flat Amount';
}

export default function SalaryComponentsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Cat>('earning');
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<{ cat: Cat; mode: 'new' | 'edit'; title: string; component?: any } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<any | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['salary-components'], queryFn: () => api.get('/salary-components').then((r) => r.data) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['salary-components'] });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => api.patch(`/salary-components/${id}/status`, { status }),
    onSuccess: () => { toast.success('Status updated'); invalidate(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/salary-components/${id}`),
    onSuccess: () => { toast.success('Component deleted'); setConfirmDelete(null); invalidate(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const rows: any[] = data ? (data[`${tab}s` as 'earnings'] || []) : [];

  const openEdit = (component: any) => {
    const t = { earning: 'Edit Earning', deduction: 'Edit Deduction', benefit: 'Edit Benefit', reimbursement: 'Edit Reimbursement' }[tab];
    setForm({ cat: tab, mode: 'edit', title: t as string, component });
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <Breadcrumb items={[{ label: 'Payroll' }, { label: 'Salary Components' }]} />

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><Coins className="text-primary" size={20} /></div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Salary Components</h1>
              <p className="text-secondary text-sm">Earnings, deductions, benefits and reimbursements that make up a salary structure.</p>
            </div>
          </div>
          <div className="relative shrink-0">
            <button onClick={() => setAddOpen((o) => !o)} className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
              <Plus size={16} /> Add Component <ChevronDown size={15} />
            </button>
            {addOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setAddOpen(false)} />
                <div className="absolute right-0 mt-1 w-48 bg-card border border-border rounded-lg shadow-lg z-40 py-1">
                  {ADD_ITEMS.map((it, i) => (
                    <button
                      key={it.label}
                      onClick={() => { setForm({ cat: it.cat, mode: 'new', title: it.title }); setAddOpen(false); }}
                      className={`w-full text-left px-4 py-2 text-sm hover:bg-primary hover:text-white transition-colors ${i === 0 ? 'text-foreground' : 'text-foreground'}`}
                    >
                      {it.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-border">
          <div className="flex gap-6 overflow-x-auto">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`pb-2.5 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${tab === t.key ? 'border-primary text-foreground font-semibold' : 'border-transparent text-primary hover:text-primary/80'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {tab === 'reimbursement' && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-xs">
            With these reimbursement components, employees can claim reimbursements for the components which are part of the payroll and not for other expenses reimbursements.
          </div>
        )}

        {/* Content */}
        {isLoading ? (
          <div className="bg-card rounded-xl border border-border p-10 text-center text-secondary text-sm">Loading…</div>
        ) : isError || !data ? (
          <div className="bg-card rounded-xl border border-border"><LoadError message="Couldn't load salary components." onRetry={() => refetch()} /></div>
        ) : (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-secondary">
                  <tr className="text-left">
                    <th className="px-4 py-2.5 font-medium uppercase text-xs">Name</th>
                    {tab === 'earning' && <>
                      <th className="px-4 py-2.5 font-medium uppercase text-xs">Earning Type</th>
                      <th className="px-4 py-2.5 font-medium uppercase text-xs">Calculation Type</th>
                      <th className="px-4 py-2.5 font-medium uppercase text-xs">Consider for EPF</th>
                      <th className="px-4 py-2.5 font-medium uppercase text-xs">Consider for ESI</th>
                    </>}
                    {tab === 'deduction' && <>
                      <th className="px-4 py-2.5 font-medium uppercase text-xs">Deduction Type</th>
                      <th className="px-4 py-2.5 font-medium uppercase text-xs">Deduction Frequency</th>
                    </>}
                    {tab === 'benefit' && <>
                      <th className="px-4 py-2.5 font-medium uppercase text-xs">Benefit Type</th>
                      <th className="px-4 py-2.5 font-medium uppercase text-xs">Benefit Frequency</th>
                    </>}
                    {tab === 'reimbursement' && <>
                      <th className="px-4 py-2.5 font-medium uppercase text-xs">Reimbursement Type</th>
                      <th className="px-4 py-2.5 font-medium uppercase text-xs">Maximum Reimbursable Amount</th>
                    </>}
                    <th className="px-4 py-2.5 font-medium uppercase text-xs">Status</th>
                    <th className="px-4 py-2.5 w-12"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-secondary">No components.</td></tr>
                  ) : rows.map((r) => {
                    const c = r.config || {};
                    return (
                      <tr key={r.id} className="hover:bg-muted/30">
                        <td className="px-4 py-3"><button onClick={() => openEdit(r)} className="text-primary hover:underline font-medium text-left">{r.name}</button></td>
                        {tab === 'earning' && <>
                          <td className="px-4 py-3 capitalize text-foreground">{c.earningType}</td>
                          <td className="px-4 py-3 text-foreground">{calcLabel(c)}</td>
                          <td className="px-4 py-3">
                            {c.considerEpf === 'no' ? <span className="text-foreground">No</span> : (
                              <span className="text-foreground">Yes{c.considerEpf === 'if_below_15000' && <span className="block text-[11px] text-secondary">(If PF Wage &lt; 15k)</span>}</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-foreground">{c.considerEsi ? 'Yes' : 'No'}</td>
                        </>}
                        {tab === 'deduction' && <>
                          <td className="px-4 py-3 text-foreground">{c.deductionType || r.name}</td>
                          <td className="px-4 py-3 text-foreground">{c.frequency === 'recurring' ? 'Recurring' : 'One-time'}</td>
                        </>}
                        {tab === 'benefit' && <>
                          <td className="px-4 py-3 text-foreground">{c.benefitPlan || r.name}</td>
                          <td className="px-4 py-3 text-foreground capitalize">{c.frequency || 'recurring'}</td>
                        </>}
                        {tab === 'reimbursement' && <>
                          <td className="px-4 py-3 text-foreground">{c.reimbursementType || r.name}</td>
                          <td className="px-4 py-3 text-foreground">{formatINR(c.maxAmount, { blank: '₹0' })}</td>
                        </>}
                        <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                        <td className="px-4 py-3 text-right">
                          <RowMenu
                            row={r}
                            category={tab}
                            onEdit={() => openEdit(r)}
                            onToggle={() => setStatus.mutate({ id: r.id, status: r.status === 'active' ? 'inactive' : 'active' })}
                            onDelete={() => setConfirmDelete(r)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Footer */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-border text-xs text-secondary">
              <span>Total Count: <button className="text-primary hover:underline">View</button></span>
              <div className="flex items-center gap-4">
                <span className="inline-flex items-center gap-1 border border-border rounded px-2 py-1">50 per page <ChevronDown size={12} /></span>
                <span>1 - {rows.length}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Form modal */}
      {form && (
        <ComponentModal
          key={`${form.cat}-${form.mode}-${form.component?.id ?? 'new'}`}
          form={form}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); invalidate(); }}
        />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete this earning?"
        message={confirmDelete && <>Delete <b className="text-foreground">{confirmDelete.name}</b>? This removes the component from the catalog.</>}
        confirmLabel="Delete"
        loading={remove.isPending}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => remove.mutate(confirmDelete.id)}
      />
    </AppShell>
  );
}

// ─────────────────────────── Row more-actions menu ───────────────────────────
function RowMenu({ row, category, onEdit, onToggle, onDelete }: { row: any; category: Cat; onEdit: () => void; onToggle: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const toggleLabel = row.status === 'active' ? 'Mark as Inactive' : 'Mark as Active';
  const items: { label: string; onClick: () => void; danger?: boolean }[] = [{ label: 'Edit', onClick: onEdit }];
  if (category !== 'deduction') items.push({ label: toggleLabel, onClick: onToggle });
  if (category === 'earning') items.push({ label: 'Delete', onClick: onDelete, danger: true });

  return (
    <div className="relative inline-block text-left">
      <button onClick={() => setOpen((o) => !o)} className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center text-secondary" aria-label="More actions">
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 w-44 bg-card border border-border rounded-lg shadow-lg z-40 py-1">
            {items.map((it, i) => (
              <button key={it.label} onClick={() => { setOpen(false); it.onClick(); }}
                className={`w-full text-left px-4 py-2 text-sm transition-colors ${it.danger ? 'text-red-600 hover:bg-red-50' : 'text-foreground hover:bg-primary hover:text-white'}`}>
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────── Form modal shell ───────────────────────────
function ComponentModal({ form, onClose, onSaved }: { form: { cat: Cat; mode: 'new' | 'edit'; title: string; component?: any }; onClose: () => void; onSaved: () => void }) {
  const inner = () => {
    switch (form.cat) {
      case 'earning': return <EarningForm form={form} onSaved={onSaved} onClose={onClose} />;
      case 'deduction': return <DeductionForm form={form} onSaved={onSaved} onClose={onClose} />;
      case 'benefit': return <BenefitForm form={form} onSaved={onSaved} onClose={onClose} />;
      case 'reimbursement': return <ReimbursementForm form={form} onSaved={onSaved} onClose={onClose} />;
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-card rounded-xl border border-border w-full max-w-3xl my-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="text-lg font-bold text-foreground">{form.title}</h3>
          <div className="flex items-center gap-4">
            <button className="inline-flex items-center gap-1 text-xs text-primary hover:underline"><Sparkles size={13} /> Page Tips</button>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted text-secondary"><X size={18} /></button>
          </div>
        </div>
        {inner()}
      </div>
    </div>
  );
}

function FormFooter({ onSave, onCancel, saving }: { onSave: () => void; onCancel: () => void; saving: boolean }) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-t border-border">
      <div className="flex items-center gap-2">
        <button onClick={onSave} disabled={saving} className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save
        </button>
        <button onClick={onCancel} className="px-5 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-muted">Cancel</button>
      </div>
      <span className="text-xs text-red-600"><Req /> indicates mandatory fields</span>
    </div>
  );
}

function useSave(url: string, method: 'post' | 'put', onSaved: () => void) {
  return useMutation({
    mutationFn: (body: any) => (api as any)[method](url, body),
    onSuccess: () => { toast.success('Saved'); onSaved(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save'),
  });
}

// ─────────────────────────── Earning form ───────────────────────────
function EarningForm({ form, onSaved, onClose }: { form: any; onSaved: () => void; onClose: () => void }) {
  const edit = form.mode === 'edit';
  const cfg = form.component?.config || {};
  const [earningType, setEarningType] = useState<string>(edit ? (form.component.name) : '');
  const [customName, setCustomName] = useState('');
  const [name, setName] = useState(form.component?.name || '');
  const [payslip, setPayslip] = useState(form.component?.name_in_payslip || '');
  const [calc, setCalc] = useState<'flat' | 'percentage'>(cfg.calculationType === 'percentage' ? 'percentage' : 'flat');
  const [amount, setAmount] = useState(String(cfg.amount ?? ''));
  const [percentage, setPercentage] = useState(String(cfg.percentage ?? ''));
  const [active, setActive] = useState(edit ? form.component.status === 'active' : true);
  const [partOfStructure, setPartOfStructure] = useState(cfg.partOfStructure ?? true);
  const [isTaxable, setIsTaxable] = useState(cfg.isTaxable ?? true);
  const [proRata, setProRata] = useState(cfg.proRata ?? true);
  const [epfOn, setEpfOn] = useState(edit ? cfg.considerEpf && cfg.considerEpf !== 'no' : false);
  const [epfMode, setEpfMode] = useState<'always' | 'if_below_15000'>(cfg.considerEpf === 'if_below_15000' ? 'if_below_15000' : 'always');
  const [considerEsi, setConsiderEsi] = useState(cfg.considerEsi ?? false);
  const [showInPayslip, setShowInPayslip] = useState(cfg.showInPayslip ?? true);

  const isBasic = (edit ? form.component.name : name) === 'Basic';
  const save = useSave(edit ? `/salary-components/${form.component.id}` : '/salary-components', edit ? 'put' : 'post', onSaved);

  const pickType = (v: string) => {
    setEarningType(v);
    if (v && v !== 'custom') { setName(v); if (!payslip) setPayslip(v); }
  };

  const onSave = () => {
    const finalName = edit ? name : (earningType === 'custom' ? customName.trim() : name);
    if (!finalName) { toast.error('Earning name is required.'); return; }
    if (!payslip.trim()) { toast.error('Name in payslip is required.'); return; }
    save.mutate({
      category: 'earning', name: finalName, name_in_payslip: payslip.trim(), status: active ? 'active' : 'inactive',
      config: {
        // On edit, keep the curated nature; on create, derive it from the chosen template.
        earningType: edit ? (cfg.earningType || 'fixed') : (VARIABLE_EARNING_TEMPLATES.has(earningType) ? 'variable' : 'fixed'),
        calculationType: calc,
        amount: calc === 'flat' ? Number(amount) || 0 : 0,
        percentage: calc === 'percentage' ? Number(percentage) || 0 : 0,
        percentOf: calc === 'percentage' ? (isBasic ? 'ctc' : 'basic') : null,
        partOfStructure, isTaxable, proRata,
        considerEpf: epfOn ? epfMode : 'no', considerEsi, showInPayslip,
      },
    });
  };

  return (
    <>
      <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
        {/* Earning type selector */}
        <Field label="Earning Type" required>
          {edit ? (
            <input value={form.component.name} readOnly className={`${inputCls} bg-muted/50 cursor-default`} />
          ) : (
            <>
              <select value={earningType} onChange={(e) => pickType(e.target.value)} className={inputCls}>
                <option value="">Select an earning type…</option>
                {EARNING_TYPE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                <option value="custom">⊕ New Custom Allowance</option>
              </select>
              {earningType === 'custom' && (
                <input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="Custom allowance name" className={`${inputCls} mt-2`} />
              )}
              {earningType && earningType !== 'custom' && (
                <span className="inline-flex items-center gap-1 text-xs text-secondary mt-2"><Info size={13} /> Fixed amount paid at the end of every month.</span>
              )}
            </>
          )}
        </Field>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left */}
          <div className="space-y-4">
            <Field label={<>Earning Name <InfoTip text="This is the name which will be displayed on your employees' payslips" /></>} required>
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Name in Payslip" required>
              <input value={payslip} onChange={(e) => setPayslip(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Calculation Type" required>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
                  <input type="radio" name="calc" className="accent-primary w-4 h-4" checked={calc === 'flat'} onChange={() => setCalc('flat')} /> Flat Amount
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
                  <input type="radio" name="calc" className="accent-primary w-4 h-4" checked={calc === 'percentage'} onChange={() => setCalc('percentage')} /> Percentage of {isBasic ? 'CTC' : 'Basic'}
                </label>
              </div>
            </Field>
            <Field label={calc === 'flat' ? 'Enter Amount' : 'Enter Percentage'}>
              {calc === 'flat' ? (
                <div className="relative w-48"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-secondary">₹</span>
                  <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputCls} pl-7`} /></div>
              ) : (
                <div className="relative w-32"><input type="number" step="0.01" value={percentage} onChange={(e) => setPercentage(e.target.value)} className={`${inputCls} pr-7`} />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-secondary">%</span></div>
              )}
            </Field>
            <Check checked={active} onChange={setActive}>Mark this as Active</Check>
          </div>

          {/* Right: Other Configurations */}
          <div className="space-y-3 lg:border-l lg:border-border lg:pl-6">
            <h4 className="text-sm font-semibold text-foreground">Other Configurations</h4>
            <Check checked={partOfStructure} onChange={setPartOfStructure}>Make this earning a part of the employee&apos;s salary structure</Check>
            <Check checked={isTaxable} onChange={setIsTaxable}>
              This is a taxable earning
              <span className="block text-xs text-secondary">The income tax will be divided equally and deducted every month across the financial year.</span>
            </Check>
            <Check checked={proRata} onChange={setProRata}>
              Calculate on pro-rata basis
              <span className="block text-xs text-secondary">Pay will be adjusted based on the employee&apos;s working days.</span>
            </Check>
            <div>
              <Check checked={epfOn} onChange={setEpfOn}>Consider for EPF Contribution <InfoTip text="Include this component in the EPF wage base." /></Check>
              {epfOn && (
                <div className="ml-6 mt-2 space-y-1.5">
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
                    <input type="radio" name="epf-mode" className="accent-primary w-4 h-4" checked={epfMode === 'always'} onChange={() => setEpfMode('always')} /> Always
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
                    <input type="radio" name="epf-mode" className="accent-primary w-4 h-4" checked={epfMode === 'if_below_15000'} onChange={() => setEpfMode('if_below_15000')} /> Only when PF Wage is less than ₹15,000
                  </label>
                </div>
              )}
            </div>
            <Check checked={considerEsi} onChange={setConsiderEsi}>Consider for ESI Contribution</Check>
            <Check checked={showInPayslip} onChange={setShowInPayslip}>Show this component in payslip</Check>
          </div>
        </div>

        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-xs">
          <b>Note:</b> Once you associate this component with an employee, you will only be able to edit the Name and Amount/Percentage. The changes you make to Amount/Percentage will apply only to new employees.
        </div>
      </div>
      <FormFooter onSave={onSave} onCancel={onClose} saving={save.isPending} />
    </>
  );
}

// ─────────────────────────── Deduction form ───────────────────────────
function DeductionForm({ form, onSaved, onClose }: { form: any; onSaved: () => void; onClose: () => void }) {
  const edit = form.mode === 'edit';
  const cfg = form.component?.config || {};
  const [payslip, setPayslip] = useState(form.component?.name_in_payslip || '');
  const [frequency, setFrequency] = useState<'one_time' | 'recurring'>(cfg.frequency === 'recurring' ? 'recurring' : 'one_time');
  const [active, setActive] = useState(edit ? form.component.status === 'active' : true);
  const save = useSave(edit ? `/salary-components/${form.component.id}` : '/salary-components', edit ? 'put' : 'post', onSaved);

  const onSave = () => {
    if (!payslip.trim()) { toast.error('Name in payslip is required.'); return; }
    save.mutate({ category: 'deduction', name: payslip.trim(), name_in_payslip: payslip.trim(), status: active ? 'active' : 'inactive', config: { deductionType: payslip.trim(), frequency } });
  };

  return (
    <>
      <div className="px-6 py-5 space-y-5 max-w-xl">
        <Field label="Name in Payslip" required><input value={payslip} onChange={(e) => setPayslip(e.target.value)} className={inputCls} /></Field>
        <Field label="Select the deduction frequency" required>
          <div className="space-y-2">
            <label className={`flex items-center gap-2 text-sm text-foreground ${edit ? 'opacity-50' : 'cursor-pointer'}`}>
              <input type="radio" name="ded-freq" className="accent-primary w-4 h-4" checked={frequency === 'one_time'} disabled={edit} onChange={() => setFrequency('one_time')} /> One-time deduction
            </label>
            <label className={`flex items-center gap-2 text-sm text-foreground ${edit ? 'opacity-50' : 'cursor-pointer'}`}>
              <input type="radio" name="ded-freq" className="accent-primary w-4 h-4" checked={frequency === 'recurring'} disabled={edit} onChange={() => setFrequency('recurring')} /> Recurring deduction for subsequent Payrolls
            </label>
          </div>
        </Field>
        <Check checked={active} onChange={setActive}>Mark this as Active</Check>
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-xs">
          <b>Note:</b> Once you associate this benefits with an employee, you will only be able to edit the Name in Payslip. The change will be reflected in both new and existing employees.
        </div>
      </div>
      <FormFooter onSave={onSave} onCancel={onClose} saving={save.isPending} />
    </>
  );
}

// ─────────────────────────── Benefit form ───────────────────────────
function BenefitForm({ form, onSaved, onClose }: { form: any; onSaved: () => void; onClose: () => void }) {
  const edit = form.mode === 'edit';
  const cfg = form.component?.config || {};
  const [plan, setPlan] = useState(cfg.benefitPlan || form.component?.name || '');
  const [assoc, setAssoc] = useState(cfg.associateWith || '');
  const [payslip, setPayslip] = useState(form.component?.name_in_payslip || '');
  const [proRata, setProRata] = useState(cfg.proRata ?? false);
  const [active, setActive] = useState(edit ? form.component.status === 'active' : true);
  const save = useSave(edit ? `/salary-components/${form.component.id}` : '/salary-components', edit ? 'put' : 'post', onSaved);

  const onSave = () => {
    if (!plan.trim()) { toast.error('Benefit plan is required.'); return; }
    if (!payslip.trim()) { toast.error('Name in payslip is required.'); return; }
    save.mutate({ category: 'benefit', name: plan.trim(), name_in_payslip: payslip.trim(), status: active ? 'active' : 'inactive', config: { benefitPlan: plan.trim(), associateWith: assoc.trim(), frequency: 'recurring', proRata } });
  };

  return (
    <>
      <div className="px-6 py-5 space-y-5 max-w-xl">
        <Field label="Benefit Plan">
          <input value={plan} onChange={(e) => setPlan(e.target.value)} readOnly={edit} className={`${inputCls} ${edit ? 'bg-muted/50 cursor-default' : ''}`} />
        </Field>
        <Field label="Associate this benefit with">
          <input value={assoc} onChange={(e) => setAssoc(e.target.value)} readOnly={edit} placeholder="e.g. Employee Provident Fund" className={`${inputCls} ${edit ? 'bg-muted/50 cursor-default' : ''}`} />
        </Field>
        <Field label="Name in Payslip" required><input value={payslip} onChange={(e) => setPayslip(e.target.value)} className={inputCls} /></Field>
        <Check checked={proRata} onChange={setProRata}>
          Calculate on pro-rata basis
          <span className="block text-xs text-secondary">Benefit will be adjusted based on the employee&apos;s working days.</span>
        </Check>
        <div className="border-t border-border" />
        <Check checked={active} onChange={setActive}>Mark this as Active</Check>
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-xs">
          <b>Note:</b> Once you associate this benefit with an employee, you will only be able to edit the Name in Payslip. The change will be reflected in both new and existing employees.
        </div>
      </div>
      <FormFooter onSave={onSave} onCancel={onClose} saving={save.isPending} />
    </>
  );
}

// ─────────────────────────── Reimbursement form ───────────────────────────
function ReimbursementForm({ form, onSaved, onClose }: { form: any; onSaved: () => void; onClose: () => void }) {
  const edit = form.mode === 'edit';
  const cfg = form.component?.config || {};
  const [type, setType] = useState(cfg.reimbursementType || form.component?.name || '');
  const [payslip, setPayslip] = useState(form.component?.name_in_payslip || '');
  const [isFbp, setIsFbp] = useState(cfg.isFbp ?? false);
  const [unclaimed, setUnclaimed] = useState<'carry_forward' | 'monthly'>(cfg.unclaimed === 'monthly' ? 'monthly' : 'carry_forward');
  const [amount, setAmount] = useState(String(cfg.maxAmount ?? ''));
  const [active, setActive] = useState(edit ? form.component.status === 'active' : true);
  const save = useSave(edit ? `/salary-components/${form.component.id}` : '/salary-components', edit ? 'put' : 'post', onSaved);

  const onSave = () => {
    if (!type.trim()) { toast.error('Reimbursement type is required.'); return; }
    if (!payslip.trim()) { toast.error('Name in payslip is required.'); return; }
    if (!(Number(amount) > 0)) { toast.error('Amount is required.'); return; }
    save.mutate({ category: 'reimbursement', name: type.trim(), name_in_payslip: payslip.trim(), status: active ? 'active' : 'inactive', config: { reimbursementType: type.trim(), maxAmount: Number(amount) || 0, isFbp, unclaimed } });
  };

  return (
    <>
      <div className="px-6 py-5 space-y-5 max-w-xl">
        <Field label="Reimbursement Type">
          <input value={type} onChange={(e) => setType(e.target.value)} readOnly={edit} className={`${inputCls} ${edit ? 'bg-muted/50 cursor-default' : ''}`} />
        </Field>
        <Field label="Name in Payslip" required><input value={payslip} onChange={(e) => setPayslip(e.target.value)} className={inputCls} /></Field>
        <Check checked={isFbp} onChange={setIsFbp}>
          Include this as a Flexible Benefit Plan component
          <span className="block text-xs text-secondary">FBP allows your employees to personalise their salary structure by choosing how much they want to receive under each FBP component.</span>
        </Check>
        <Field label="How do you want to handle unclaimed reimbursement?">
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
              <input type="radio" name="unclaimed" className="accent-primary w-4 h-4" checked={unclaimed === 'carry_forward'} onChange={() => setUnclaimed('carry_forward')} /> Carry forward and encash at the end of the fiscal year
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
              <input type="radio" name="unclaimed" className="accent-primary w-4 h-4" checked={unclaimed === 'monthly'} onChange={() => setUnclaimed('monthly')} /> Do not carry forward and encash monthly
            </label>
          </div>
        </Field>
        <Field label="Enter Amount" required>
          <div className="flex items-center gap-2">
            <div className="relative w-48"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-secondary">₹</span>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputCls} pl-7`} /></div>
            <span className="text-sm text-secondary">per month</span>
          </div>
        </Field>
        <Check checked={active} onChange={setActive}>Mark this as Active</Check>
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-xs">
          <b>Note:</b> Once you associate this component with an employee, you will only be able to edit the Name in Payslip and Amount. The changes you make to Amount will apply only to new employees.
        </div>
      </div>
      <FormFooter onSave={onSave} onCancel={onClose} saving={save.isPending} />
    </>
  );
}
