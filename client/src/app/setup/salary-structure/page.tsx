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
import { LinesEditor, LineDraft, toLineDrafts, linesPayload } from '@/components/salary/LinesEditor';
import { Search, Layers, Building2, Loader2, Save, Plus, Trash2, IndianRupee, Users, RotateCcw, UserCog } from 'lucide-react';

const inputCls = 'w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';

export default function SalaryStructurePage() {
  const [tab, setTab] = useState<'employee' | 'designation' | 'department'>('employee');
  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <Breadcrumb className="mb-2" items={[{ label: 'Payroll' }, { label: 'Salary Structures' }]} />
          <h1 className="text-2xl font-bold text-foreground">Salary Structures</h1>
        </div>

        <div className="flex gap-1 border-b border-border">
          <TabBtn active={tab === 'employee'} onClick={() => setTab('employee')} icon={Users} label="Employees" />
          <TabBtn active={tab === 'designation'} onClick={() => setTab('designation')} icon={Layers} label="Designation" />
          <TabBtn active={tab === 'department'} onClick={() => setTab('department')} icon={Building2} label="Departments" />
        </div>

        {tab === 'employee'
          ? <EmployeesPanel />
          : <TemplatesPanel key={tab} scope={tab} />}
      </div>
    </AppShell>
  );
}

function TabBtn({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: React.ElementType; label: string }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${active ? 'border-primary text-primary' : 'border-transparent text-secondary hover:text-foreground'}`}>
      <Icon size={15} /> {label}
    </button>
  );
}

// ─────────────────────────────── By Employee ───────────────────────────────

function EmployeesPanel() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState({ base: '', tds: '', payment_basis: 'monthly', lines: [] as LineDraft[] });
  const [confirmReset, setConfirmReset] = useState(false);

  const { data: list = [], isLoading } = useQuery({
    queryKey: ['employee-salary'],
    queryFn: () => api.get('/admin/employee-salary').then(r => r.data),
  });
  const { data: components = [] } = useQuery({
    queryKey: ['structure-components'],
    queryFn: () => api.get('/admin/salary-structures/components').then(r => r.data),
  });
  const { data: detail } = useQuery({
    queryKey: ['employee-salary', selectedId],
    queryFn: () => api.get(`/admin/employee-salary/${selectedId}`).then(r => r.data),
    enabled: selectedId != null,
  });

  useEffect(() => {
    if (!detail) return;
    setForm({
      base: detail.base ? String(Math.round(detail.base)) : '',
      tds: detail.tds_amount ? String(Math.round(detail.tds_amount)) : '',
      payment_basis: detail.payment_basis ?? 'monthly',
      lines: toLineDrafts(detail.lines),
    });
  }, [detail]);

  const setLine = (idx: number, patch: Partial<LineDraft>) =>
    setForm((p) => ({ ...p, lines: p.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)) }));
  const addLine = () => setForm((p) => ({ ...p, lines: [...p.lines, { component_id: '', calculation_type: 'flat', value: '0' }] }));
  const removeLine = (idx: number) => setForm((p) => ({ ...p, lines: p.lines.filter((_, i) => i !== idx) }));

  // Preview at the employee's work-location state (read-only, from their property).
  const previewInput = useDebouncedValue(JSON.stringify({ lines: linesPayload(form.lines), base: Number(form.base) || 0, city: detail?.state ?? 'Haryana' }), 400);
  const { data: preview } = useQuery({
    queryKey: ['emp-structure-preview', previewInput],
    queryFn: () => api.post('/admin/salary-structures/preview', JSON.parse(previewInput)).then(r => r.data),
    enabled: selectedId != null && linesPayload(form.lines).length > 0 && (Number(form.base) || 0) > 0,
    placeholderData: (prev) => prev,
  });

  const saveMutation = useMutation({
    mutationFn: () => api.put(`/admin/employee-salary/${selectedId}`, {
      lines: linesPayload(form.lines),
      base: Number(form.base) || 0,
      tds_amount: Number(form.tds) || 0,
      payment_basis: form.payment_basis,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employee-salary'] });
      toast.success('Salary structure saved');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save'),
  });

  const resetMutation = useMutation({
    mutationFn: () => api.post(`/admin/employee-salary/${selectedId}/reset`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employee-salary'] });
      queryClient.invalidateQueries({ queryKey: ['employee-salary', selectedId] });
      toast.success('Reset to the designation template');
      setConfirmReset(false);
    },
    onError: (e: any) => { toast.error(e.response?.data?.error || 'Failed to reset'); setConfirmReset(false); },
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return list.filter((r: any) => !q
      || `${r.first_name} ${r.last_name}`.toLowerCase().includes(q)
      || r.employee_code?.toLowerCase().includes(q)
      || r.designation?.toLowerCase().includes(q));
  }, [list, search]);

  const selectedRow = useMemo(() => list.find((r: any) => r.employee_id === selectedId), [list, selectedId]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5 items-start">
      {/* Employee list */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee, code, designation..."
              className="w-full pl-9 pr-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
        </div>
        <div className="max-h-[600px] overflow-y-auto divide-y divide-border">
          {isLoading ? (
            <div className="p-3 space-y-2">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-12 bg-muted rounded animate-pulse" />)}</div>
          ) : filtered.map((r: any) => (
            <button key={r.employee_id} onClick={() => setSelectedId(r.employee_id)}
              className={`w-full text-left px-4 py-2.5 transition-colors ${selectedId === r.employee_id ? 'bg-primary/5' : 'hover:bg-muted/40'}`}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground truncate flex-1">{r.first_name} {r.last_name}</span>
                {r.configured
                  ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">Configured</span>
                  : <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Not set</span>}
              </div>
              <p className="text-[11px] text-secondary mt-0.5">{r.employee_code} · {r.designation || 'No designation'}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Editor + preview */}
      {selectedId == null ? (
        <div className="bg-card rounded-xl border border-border flex flex-col items-center justify-center py-20 text-secondary">
          <UserCog size={40} className="opacity-30 mb-3" />
          <p className="text-sm">Select an employee to configure their salary structure</p>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
              <h2 className="text-lg font-semibold text-foreground">
                {selectedRow ? `${selectedRow.first_name} ${selectedRow.last_name}` : 'Employee'}
                <span className="text-sm font-normal text-secondary"> · {selectedRow?.designation || '—'}</span>
              </h2>
              <div className="flex items-center gap-2">
                {detail?.configured && (
                  <button onClick={() => setConfirmReset(true)}
                    className="flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors" title="Reset to the designation template">
                    <RotateCcw size={14} /> Reset to template
                  </button>
                )}
                <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !form.base || linesPayload(form.lines).length === 0}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                  {saveMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save
                </button>
              </div>
            </div>

            {detail && !detail.configured && (
              <div className="mb-4 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 text-sm">
                Not configured yet{detail.template_source ? <> — pre-filled from the <b>{detail.template_source.name}</b> template</> : ''}. Adjust and Save to create this employee&apos;s structure.
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-secondary mb-1">Base {form.payment_basis === 'hourly' ? '₹/hour' : '₹/month'}<span className="text-red-600"> *</span></label>
                <input type="number" className={inputCls} value={form.base} onChange={(e) => setForm(p => ({ ...p, base: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-secondary mb-1">TDS ₹/month</label>
                <input type="number" min={0} className={inputCls} value={form.tds} placeholder="0"
                  title="Manual monthly TDS — a deduction line on the payslip"
                  onChange={(e) => setForm(p => ({ ...p, tds: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-secondary mb-1">Statutory state</label>
                <div className={`${inputCls} bg-muted/40 cursor-default`} title="Resolved from the employee's property — change it in Admin → Organization">
                  {detail?.state ?? '—'}
                </div>
                <p className="mt-1 text-[11px] text-secondary">From the employee&apos;s property</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-secondary mb-1">Payment basis</label>
                <select className={inputCls} value={form.payment_basis} onChange={(e) => setForm(p => ({ ...p, payment_basis: e.target.value }))}>
                  <option value="monthly">Monthly-rated</option>
                  <option value="hourly">Hourly-rated</option>
                </select>
              </div>
            </div>

            <LinesEditor components={components} lines={form.lines} setLine={setLine} addLine={addLine} removeLine={removeLine} />
          </div>

          <PreviewCard preview={preview} base={Number(form.base) || 0} />
        </div>
      )}

      <ConfirmDialog
        open={confirmReset}
        title="Reset to designation template?"
        message={<>This replaces this employee&apos;s components and base with their designation&apos;s template. Their manual edits will be lost.</>}
        confirmLabel="Reset"
        danger={false}
        loading={resetMutation.isPending}
        onConfirm={() => resetMutation.mutate()}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}

// ─────────────────────────────── Templates ───────────────────────────────

interface TemplateForm {
  name: string; scope_id: string; payment_basis: string;
  default_base: string; city: string; is_active: boolean; lines: LineDraft[];
}
const emptyTemplate = (): TemplateForm => ({
  name: '', scope_id: '', payment_basis: 'monthly', default_base: '', city: 'Haryana', is_active: true,
  lines: [{ component_id: '', calculation_type: 'pct_of_base', value: '50' }],
});

// TemplatesPanel serves two scopes with the same editor: a Designation template is
// keyed to a job title (optional — a blank one is a generic template), a Department
// template to a department (required). Everything that differs — which list to load,
// which dropdown to show, which id field to send — lives here.
type TemplateScope = 'designation' | 'department';
const TEMPLATE_SCOPES: Record<TemplateScope, {
  listKey: readonly string[]; listUrl: string;
  optionsKey: readonly string[]; optionsUrl: string; optionLabel: (o: any) => string;
  payloadField: 'job_title_id' | 'department_id'; rowIdField: 'job_title_id' | 'department_id';
  rowLabel: (s: any) => string; scopeInputLabel: string; scopeRequired: boolean;
  nonePlaceholder: string; newLabel: string; emptyHint: string;
}> = {
  designation: {
    listKey: ['salary-structures', 'designation'], listUrl: '/admin/salary-structures',
    optionsKey: ['job-titles'], optionsUrl: '/admin/job-titles', optionLabel: (o) => o.title,
    payloadField: 'job_title_id', rowIdField: 'job_title_id',
    rowLabel: (s) => s.designation || 'No designation',
    scopeInputLabel: 'Designation (optional)', scopeRequired: false, nonePlaceholder: '— None —',
    newLabel: 'New Template', emptyHint: 'Select a template, or create one for a designation',
  },
  department: {
    listKey: ['salary-structures', 'department'], listUrl: '/admin/salary-structures?scope=department',
    optionsKey: ['departments'], optionsUrl: '/admin/departments', optionLabel: (o) => o.name,
    payloadField: 'department_id', rowIdField: 'department_id',
    rowLabel: (s) => s.department_name || 'No department',
    scopeInputLabel: 'Department', scopeRequired: true, nonePlaceholder: '— Select a department —',
    newLabel: 'New Department Template', emptyHint: 'Select a template, or create one for a department',
  },
};

function TemplatesPanel({ scope }: { scope: TemplateScope }) {
  const cfg = TEMPLATE_SCOPES[scope];
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | 'new' | null>(null);
  const [form, setForm] = useState<TemplateForm>(emptyTemplate());
  const [confirmDel, setConfirmDel] = useState<any | null>(null);

  const { data: list = [], isLoading } = useQuery({
    queryKey: cfg.listKey,
    queryFn: () => api.get(cfg.listUrl).then(r => r.data),
  });
  const { data: components = [] } = useQuery({
    queryKey: ['structure-components'],
    queryFn: () => api.get('/admin/salary-structures/components').then(r => r.data),
  });
  const { data: scopeOptions = [] } = useQuery({
    queryKey: cfg.optionsKey,
    queryFn: () => api.get(cfg.optionsUrl).then(r => r.data),
  });
  // Data-derived operating states (properties + configured statutory rows). The
  // preview's rates are keyed by STATE, so the picker lists states, not cities.
  const { data: operatingStates = [] } = useQuery<string[]>({
    queryKey: ['operating-states'],
    queryFn: () => api.get('/statutory/states').then(r => r.data),
  });
  const stateOptions = operatingStates.length ? operatingStates : ['Haryana'];

  const selected = useMemo(
    () => (typeof selectedId === 'number' ? list.find((x: any) => x.id === selectedId) : null),
    [list, selectedId],
  );

  useEffect(() => {
    if (selectedId === 'new') { setForm(emptyTemplate()); return; }
    if (selected) {
      setForm({
        name: selected.name ?? '',
        scope_id: selected[cfg.rowIdField] != null ? String(selected[cfg.rowIdField]) : '',
        payment_basis: selected.payment_basis ?? 'monthly',
        default_base: String(selected.default_base ?? ''),
        city: selected.city ?? 'Haryana',
        is_active: !!selected.is_active,
        lines: toLineDrafts(selected.lines),
      });
    }
  }, [selected, selectedId]);

  const set = (k: keyof TemplateForm, v: any) => setForm((p) => ({ ...p, [k]: v }));
  const setLine = (idx: number, patch: Partial<LineDraft>) =>
    setForm((p) => ({ ...p, lines: p.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)) }));
  const addLine = () => setForm((p) => ({ ...p, lines: [...p.lines, { component_id: '', calculation_type: 'flat', value: '0' }] }));
  const removeLine = (idx: number) => setForm((p) => ({ ...p, lines: p.lines.filter((_, i) => i !== idx) }));

  const payload = () => ({
    name: form.name.trim(),
    [cfg.payloadField]: form.scope_id ? Number(form.scope_id) : null,
    payment_basis: form.payment_basis,
    default_base: Number(form.default_base) || 0,
    city: form.city,
    is_active: form.is_active,
    lines: linesPayload(form.lines),
  });

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
      queryClient.invalidateQueries({ queryKey: ['salary-structures'] }); // prefix-matches both scopes
      toast.success(selectedId === 'new' ? 'Template created' : 'Template saved');
      if (selectedId === 'new' && res.data?.id) setSelectedId(res.data.id);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/salary-structures/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salary-structures'] });
      toast.success('Template deleted');
      setConfirmDel(null);
      setSelectedId(null);
    },
    onError: (e: any) => { toast.error(e.response?.data?.error || 'Failed to delete'); setConfirmDel(null); },
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return list.filter((x: any) => !q || x.name?.toLowerCase().includes(q)
      || x.designation?.toLowerCase().includes(q) || x.department_name?.toLowerCase().includes(q));
  }, [list, search]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5 items-start">
      {/* Template list */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="p-3 border-b border-border space-y-2">
          <button onClick={() => setSelectedId('new')}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
            <Plus size={15} /> {cfg.newLabel}
          </button>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search templates..."
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
                {cfg.rowLabel(s)} · CTC {formatINR(s.breakdown?.ctc ?? 0)}/mo
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Editor + preview */}
      {selectedId === null ? (
        <div className="bg-card rounded-xl border border-border flex flex-col items-center justify-center py-20 text-secondary">
          <IndianRupee size={40} className="opacity-30 mb-3" />
          <p className="text-sm">{cfg.emptyHint}</p>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">
                {selectedId === 'new' ? cfg.newLabel : `Edit — ${selected?.name ?? ''}`}
              </h2>
              <div className="flex items-center gap-2">
                {typeof selectedId === 'number' && (
                  <button onClick={() => setConfirmDel(selected)}
                    className="p-2 rounded-lg text-secondary hover:text-red-600 hover:bg-red-50 transition-colors" title="Delete">
                    <Trash2 size={16} />
                  </button>
                )}
                <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !form.name || !form.default_base || (cfg.scopeRequired && !form.scope_id)}
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
                <label className="block text-xs font-medium text-secondary mb-1">
                  {cfg.scopeInputLabel}{cfg.scopeRequired && <span className="text-red-600"> *</span>}
                </label>
                <select className={inputCls} value={form.scope_id} onChange={(e) => set('scope_id', e.target.value)}>
                  <option value="">{cfg.nonePlaceholder}</option>
                  {scopeOptions.map((o: any) => <option key={o.id} value={o.id}>{cfg.optionLabel(o)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-secondary mb-1">Payment basis</label>
                <select className={inputCls} value={form.payment_basis} onChange={(e) => set('payment_basis', e.target.value)}>
                  <option value="monthly">Monthly-rated</option>
                  <option value="hourly">Hourly-rated</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-secondary mb-1">Default base {form.payment_basis === 'hourly' ? '₹/hour' : '₹/month'}<span className="text-red-600"> *</span></label>
                <input type="number" className={inputCls} value={form.default_base} onChange={(e) => set('default_base', e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-secondary mb-1">Preview state (statutory)</label>
                <select className={inputCls} value={form.city} onChange={(e) => set('city', e.target.value)}
                  title="Which state's statutory rates to preview against — employees' payslips use their own property's state">
                  {!stateOptions.includes(form.city) && form.city && <option value={form.city}>{form.city}</option>}
                  {stateOptions.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 mt-5 cursor-pointer select-none">
                <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-primary/50" />
                <span className="text-sm text-foreground">Active</span>
              </label>
            </div>

            <LinesEditor components={components} lines={form.lines} setLine={setLine} addLine={addLine} removeLine={removeLine} />
          </div>

          <PreviewCard preview={preview} base={Number(form.default_base) || 0} />
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDel}
        title="Delete template?"
        message={confirmDel ? <>This permanently removes <span className="font-medium text-foreground">{confirmDel.name}</span>.{scope === 'designation' ? ' New hires for its designation will no longer be seeded from it.' : ''}</> : undefined}
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
        onConfirm={() => confirmDel && deleteMutation.mutate(confirmDel.id)}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  );
}

// ─────────────────────────────── Shared ───────────────────────────────

function PreviewCard({ preview, base }: { preview: any; base: number }) {
  if (!preview) return null;
  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="px-5 py-3 border-b border-border bg-muted/30">
        <h3 className="text-sm font-semibold text-foreground">Payslip preview at {formatINR(base)} base</h3>
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
