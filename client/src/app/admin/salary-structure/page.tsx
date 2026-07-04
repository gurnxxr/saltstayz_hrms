'use client';

import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import Breadcrumb from '@/components/ui/Breadcrumb';
import { formatINR } from '@/lib/utils';
import { Search, Briefcase, Loader2, Save, IndianRupee, AlertCircle } from 'lucide-react';

// Operating cities/states — resolve to a statutory state on the server.
const CITIES = ['Haryana', 'Gurugram', 'Faridabad', 'Delhi', 'Noida', 'Greater Noida', 'Uttar Pradesh', 'Chandigarh', 'Dehradun', 'Uttarakhand'];
const num = (v: any) => (v === '' || v === null || v === undefined ? 0 : Number(v));

const emptyStruct = {
  gross: '', city: 'Haryana',
  pct_basic: 50, pct_hra: 50, pct_gratuity: 4.81,
  pli: 0, lwf_employee: '', lwf_employer: '', meal: 0, accommodation: 0, accommodation_allowance: 0,
};

// Mirrors the server payslip.calc engine for live preview. Statutory rates
// (EPF/ESI/LWF) come from GET /statutory/rates — editable in Payroll → Statutory
// Components — so this preview always matches what payslips will actually compute.
function computeBreakdown(s: any, statutory: any) {
  const r = Math.round;
  const epf = statutory?.epf || {};
  const esiCfg = statutory?.esi || {};
  const lwfCfg = statutory?.lwf || {};
  const gross = r(num(s.gross)), pli = r(num(s.pli)), meal = r(num(s.meal));
  const accommodation = r(num(s.accommodation)), accAllow = r(num(s.accommodation_allowance));
  const basic = r(gross * num(s.pct_basic) / 100);
  const hra = r(basic * num(s.pct_hra) / 100);
  const other = gross - basic - hra;
  const fixed = gross;
  const grossEarnings = fixed + pli;
  const lwfCalc = lwfCfg.enabled
    ? Math.min(r(num(lwfCfg.employeePct) / 100 * gross), r(num(lwfCfg.employeeMaxAmount)))
    : 0;
  const lwf = r(s.lwf_employee !== '' && s.lwf_employee !== null ? num(s.lwf_employee) : lwfCalc);
  const empLwf = r(s.lwf_employer !== '' && s.lwf_employer !== null
    ? num(s.lwf_employer)
    : (lwfCfg.enabled ? lwfCalc * (num(lwfCfg.employerMultiplier) || 1) : 0));
  const pfBase = basic + other;
  const empPf = epf.enabled ? r(num(epf.employeeRatePct) / 100 * pfBase) : 0;
  const erPf = epf.enabled ? r(num(epf.employerRatePct) / 100 * pfBase) : 0;
  const ceiling = num(esiCfg.wageCeiling);
  const esiEligible = !!esiCfg.enabled && (ceiling <= 0 || gross <= ceiling);
  const esi = esiEligible ? Math.ceil(num(esiCfg.employeeRatePct) / 100 * gross) : 0;
  const erEsi = esiEligible ? Math.ceil(num(esiCfg.employerRatePct) / 100 * gross) : 0;
  const totalDed = empPf + esi + lwf + meal + accommodation;
  const net = fixed + pli - totalDed;
  const gratuity = r(num(s.pct_gratuity) / 100 * basic);
  const retirals = erPf + gratuity + empLwf;
  const benefits = erEsi + accAllow;
  const ctc = fixed + pli + retirals + benefits;
  return { basic, hra, other, fixed, pli, grossEarnings, empPf, esi, lwf, meal, accommodation, totalDed, net, erPf, gratuity, empLwf, retirals, erEsi, accAllow, benefits, ctc };
}

export default function SalaryStructurePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState<any>(emptyStruct);

  const { data: list = [], isLoading } = useQuery({
    queryKey: ['salary-structures'],
    queryFn: () => api.get('/admin/salary-structures').then(r => r.data),
  });

  const selected = useMemo(() => list.find((x: any) => x.job_title_id === selectedId), [list, selectedId]);

  useEffect(() => {
    if (selected?.structure) {
      const s = selected.structure;
      setForm({
        gross: s.gross ?? '', city: s.city ?? 'Haryana',
        pct_basic: s.pct_basic, pct_hra: s.pct_hra, pct_gratuity: s.pct_gratuity,
        pli: s.pli, lwf_employee: s.lwf_employee ?? '', lwf_employer: s.lwf_employer ?? '',
        meal: s.meal, accommodation: s.accommodation, accommodation_allowance: s.accommodation_allowance,
      });
    } else if (selected) {
      setForm(emptyStruct);
    }
  }, [selected]);

  // Live statutory rates for the selected city/state — keeps the preview honest.
  const { data: statutory } = useQuery({
    queryKey: ['statutory-rates', form.city],
    queryFn: () => api.get(`/statutory/rates?city=${encodeURIComponent(form.city || '')}`).then(r => r.data),
  });

  const saveMutation = useMutation({
    mutationFn: () => api.put(`/admin/salary-structures/${selectedId}`, {
      ...form,
      lwf_employee: form.lwf_employee === '' ? null : Number(form.lwf_employee),
      lwf_employer: form.lwf_employer === '' ? null : Number(form.lwf_employer),
    }).then(r => r.data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['salary-structures'] }); toast.success('Salary structure saved'); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save'),
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return list.filter((x: any) => !q || x.designation?.toLowerCase().includes(q));
  }, [list, search]);

  const needsSetup = useMemo(() => list.filter((x: any) => !x.configured).length, [list]);

  const b = computeBreakdown(form, statutory);
  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }));

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <Breadcrumb className="mb-2" items={[{ label: 'Admin', href: '/admin' }, { label: 'Salary Structure' }]} />
          <h1 className="text-2xl font-bold text-foreground">Salary Structure</h1>
          <p className="text-secondary mt-1">Define the salary structure for each designation — every amount and percentage is editable. New hires inherit their designation&apos;s structure.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5 items-start">
          {/* Designation list */}
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="p-3 border-b border-border space-y-2">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search designation..."
                  className="w-full pl-9 pr-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
              </div>
              {needsSetup > 0 && (
                <p className="flex items-center gap-1.5 text-xs text-amber-700">
                  <AlertCircle size={13} className="shrink-0" />
                  Needs setup: {needsSetup} designation{needsSetup === 1 ? '' : 's'} missing salary details
                </p>
              )}
            </div>
            <div className="max-h-[600px] overflow-y-auto divide-y divide-border">
              {isLoading ? (
                <div className="p-3 space-y-2">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-11 bg-muted rounded animate-pulse" />)}</div>
              ) : filtered.map((d: any) => (
                <button key={d.job_title_id} onClick={() => setSelectedId(d.job_title_id)}
                  className={`w-full text-left px-4 py-2.5 transition-colors ${selectedId === d.job_title_id ? 'bg-primary/5' : 'hover:bg-muted/40'}`}>
                  <div className="flex items-center gap-2">
                    <Briefcase size={14} className="text-secondary shrink-0" />
                    <span className="text-sm font-medium text-foreground truncate flex-1">{d.designation}</span>
                    {d.employee_count > 0 && <span className="text-[10px] text-secondary">{d.employee_count}</span>}
                  </div>
                  {d.configured
                    ? d.breakdown && <p className="text-[11px] text-secondary mt-0.5 ml-6">CTC {formatINR(d.breakdown.ctc)}/mo</p>
                    : <span className="inline-block mt-1 ml-6 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">Missing salary details</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Editor + breakdown */}
          {!selected ? (
            <div className="bg-card rounded-xl border border-border flex flex-col items-center justify-center py-20 text-secondary">
              <IndianRupee size={40} className="opacity-30 mb-3" />
              <p className="text-sm">Select a designation to configure its salary structure</p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="bg-card rounded-xl border border-border p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">{selected.designation}</h2>
                    <p className="text-xs text-secondary">{selected.employee_count} employee(s) · base gross is the “Fixed Salary (A)” per minimum wage</p>
                  </div>
                  <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !form.gross}
                    className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                    {saveMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save
                  </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Field label="Gross (Fixed A) ₹" value={form.gross} onChange={(v) => set('gross', v)} />
                  <div>
                    <label className="block text-xs font-medium text-secondary mb-1">City / State (statutory)</label>
                    <select value={form.city} onChange={(e) => set('city', e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm">
                      {!CITIES.includes(form.city) && form.city && <option value={form.city}>{form.city}</option>}
                      {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <Field label="PLI (Variable B) ₹" value={form.pli} onChange={(v) => set('pli', v)} />
                  <Field label="Meal (deduction) ₹" value={form.meal} onChange={(v) => set('meal', v)} />
                  <Field label="Accommodation (deduction) ₹" value={form.accommodation} onChange={(v) => set('accommodation', v)} />
                  <Field label="Accom. Allowance (benefit) ₹" value={form.accommodation_allowance} onChange={(v) => set('accommodation_allowance', v)} />
                  <Field label="LWF Employee ₹" value={form.lwf_employee} onChange={(v) => set('lwf_employee', v)} placeholder="state default" />
                  <Field label="LWF Employer ₹" value={form.lwf_employer} onChange={(v) => set('lwf_employer', v)} placeholder="state default" />
                </div>

                <p className="text-xs font-semibold text-secondary uppercase mt-5 mb-2">Composition</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Field label="Basic (% of Gross)" value={form.pct_basic} onChange={(v) => set('pct_basic', v)} />
                  <Field label="HRA (% of Basic)" value={form.pct_hra} onChange={(v) => set('pct_hra', v)} />
                  <Field label="Gratuity (% of Basic)" value={form.pct_gratuity} onChange={(v) => set('pct_gratuity', v)} />
                </div>
                <p className="text-xs text-secondary mt-3">
                  EPF, ESI and LWF rates are statutory — set state-wise in{' '}
                  <a href="/setup/statutory-components" className="underline hover:text-foreground">Payroll → Statutory Components</a>{' '}
                  and applied automatically to every payslip.
                </p>
              </div>

              {/* Live breakdown */}
              <div className="bg-card rounded-xl border border-border overflow-hidden">
                <div className="px-5 py-3 border-b border-border bg-muted/30">
                  <h3 className="text-sm font-semibold text-foreground">Salary Breakup (live preview)</h3>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    <Row label="Final Gross Salary (A+B)" value={b.grossEarnings} strong />
                    <Row label="A. Fixed Salary" value={b.fixed} head />
                    <Row label="Basic" value={b.basic} sub note={`${form.pct_basic}% of Gross`} />
                    <Row label="HRA" value={b.hra} sub note={`${form.pct_hra}% of Basic`} />
                    <Row label="Other Allowance" value={b.other} sub note="Remaining" />
                    <Row label="B. Variable Pay" value={b.pli} head />
                    <Row label="PLI" value={b.pli} sub />
                    <Row label="E. Deduction" value={b.totalDed} head />
                    <Row label="Employee PF" value={b.empPf} sub note={statutory?.epf?.enabled ? `${statutory.epf.employeeRatePct}% of Basic+Other` : 'EPF disabled'} />
                    <Row label="ESI" value={b.esi} sub note={statutory?.esi?.enabled ? `${statutory.esi.employeeRatePct}% of Gross (≤ ₹${Number(statutory.esi.wageCeiling).toLocaleString('en-IN')})` : 'ESI disabled'} />
                    <Row label="LWF" value={b.lwf} sub note="State-wise — Statutory Components" />
                    <Row label="Meal" value={b.meal} sub note="Manual" />
                    <Row label="Accommodation" value={b.accommodation} sub note="Manual" />
                    <Row label="Net In Hand (A+B−E)" value={b.net} strong highlight />
                    <Row label="C. Retirals (Employer)" value={b.retirals} head />
                    <Row label="Employer PF" value={b.erPf} sub note={statutory?.epf?.enabled ? `${statutory.epf.employerRatePct}% of Basic+Other` : 'EPF disabled'} />
                    <Row label="Gratuity" value={b.gratuity} sub note={`${form.pct_gratuity}% of Basic`} />
                    <Row label="Employer LWF" value={b.empLwf} sub note="State-wise — Statutory Components" />
                    <Row label="D. Benefit" value={b.benefits} head />
                    <Row label="Employer ESI / Medical" value={b.erEsi} sub note={statutory?.esi?.enabled ? `${statutory.esi.employerRatePct}% of Gross` : 'ESI disabled'} />
                    <Row label="Accommodation Allowance" value={b.accAllow} sub note="Tentative" />
                    <Row label="CTC (A+B+C+D)" value={b.ctc} strong highlight />
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: any; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-secondary mb-1">{label}</label>
      <input type="number" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} step="any"
        className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
    </div>
  );
}

function Row({ label, value, sub, head, strong, highlight, note }: {
  label: string; value: number; sub?: boolean; head?: boolean; strong?: boolean; highlight?: boolean; note?: string;
}) {
  return (
    <tr className={`border-b border-border ${highlight ? 'bg-primary/5' : head ? 'bg-muted/30' : ''}`}>
      <td className={`px-5 py-2 ${sub ? 'pl-10 text-secondary' : 'text-foreground'} ${head || strong ? 'font-semibold' : ''}`}>
        {label}
        {note && <span className="text-[11px] text-secondary ml-2">{note}</span>}
      </td>
      <td className={`px-5 py-2 text-right ${strong ? 'font-bold text-primary' : head ? 'font-semibold text-foreground' : 'text-foreground'}`}>{formatINR(value)}</td>
    </tr>
  );
}
