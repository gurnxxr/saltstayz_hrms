'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import Breadcrumb from '@/components/ui/Breadcrumb';
import LoadError from '@/components/ui/LoadError';
import api from '@/lib/api';
import { formatINR } from '@/lib/utils';
import { INDIAN_STATES } from '@/lib/constants';
import { Landmark, IndianRupee, Ban, Info, Save, Loader2, Plus, X, PiggyBank, AlertTriangle } from 'lucide-react';

const TABS = [
  { key: 'epf', label: 'EPF' },
  { key: 'esi', label: 'ESI' },
  { key: 'pt', label: 'Professional Tax' },
  { key: 'lwf', label: 'Labour Welfare Fund' },
  { key: 'bonus', label: 'Statutory Bonus' },
  { key: 'minwage', label: 'Minimum Wage' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const Req = () => <span className="text-red-600">*</span>;
const inputCls = 'w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';

function InfoTip({ text }: { text: string }) {
  return (
    <span className="inline-flex text-secondary cursor-help align-middle" title={text} aria-label="More info">
      <Info size={14} />
    </span>
  );
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

function useStatutory() {
  return useQuery({ queryKey: ['statutory'], queryFn: () => api.get('/statutory').then((r) => r.data) });
}

export default function StatutoryComponentsPage() {
  const [tab, setTab] = useState<TabKey>('epf');
  const { data, isLoading, isError, refetch } = useStatutory();

  return (
    <AppShell>
      <div className="space-y-6">
        <Breadcrumb items={[{ label: 'Payroll' }, { label: 'Statutory Components' }]} />

        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><Landmark className="text-primary" size={20} /></div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Statutory Components</h1>
              <p className="text-secondary text-sm">Configure EPF, ESI, Professional Tax, Labour Welfare Fund and Statutory Bonus.</p>
            </div>
          </div>
          <button
            className="w-6 h-6 rounded-full bg-orange-500 text-white text-xs font-bold flex items-center justify-center shrink-0"
            title="These are your organisation's statutory payroll settings. Enable and configure each component as applicable."
            aria-label="Help"
          >?</button>
        </div>

        {/* Tab bar */}
        <div className="border-b border-border">
          <div className="flex gap-6 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`pb-2.5 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${
                  tab === t.key ? 'border-primary text-foreground font-semibold' : 'border-transparent text-primary hover:text-primary/80'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="bg-card rounded-xl border border-border p-10 text-center text-secondary text-sm">Loading…</div>
        ) : isError || !data ? (
          <div className="bg-card rounded-xl border border-border"><LoadError message="Couldn't load statutory settings." onRetry={() => refetch()} /></div>
        ) : (
          <>
            {tab === 'epf' && <EpfTab epf={data.settings.epf} />}
            {tab === 'esi' && <EsiTab esi={data.settings.esi} />}
            {tab === 'pt' && <PtTab pt={data.settings.pt} />}
            {tab === 'lwf' && <LwfTab lwf={data.settings.lwf} />}
            {tab === 'bonus' && <BonusTab bonus={data.settings.bonus} />}
            {tab === 'minwage' && <MinimumWageTab states={data.states} minimumWages={data.minimumWages} />}
          </>
        )}
      </div>
    </AppShell>
  );
}

// ─── Shared empty state ───
function EmptyState({ icon, heading, text, cta, onCta }: { icon: React.ReactNode; heading: string; text: string; cta: string; onCta: () => void }) {
  return (
    <div className="bg-card rounded-xl border border-border py-14 px-6 flex flex-col items-center text-center">
      <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-5">{icon}</div>
      <h3 className="text-lg font-semibold text-foreground mb-2">{heading}</h3>
      <p className="text-sm text-secondary max-w-lg mb-6">{text}</p>
      <button onClick={onCta} className="px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">{cta}</button>
    </div>
  );
}

/*
 * `onDisable` is only passed once a component is actually on. Enabling used to be one-way here:
 * every tab hardcoded `enabled: true`, so nothing could take EPF, ESI or Statutory Bonus back off
 * once it was switched on — the "Are you registered for…?" screen was unreachable again and the
 * deduction kept running. Per-state PT and LWF already had their own Disable button; these three
 * now match it, on the right-hand side so it is never the button you hit reaching for Save.
 */
function Footer({ onCancel, onSave, saving, saveLabel = 'Enable', onDisable, disableLabel, disabling }: {
  onCancel: () => void; onSave: () => void; saving: boolean; saveLabel?: string;
  onDisable?: () => void; disableLabel?: string; disabling?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 pt-4 border-t border-border">
      <button onClick={onSave} disabled={saving || disabling} className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
        {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {saveLabel}
      </button>
      <button onClick={onCancel} className="px-5 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors">Cancel</button>
      {onDisable && (
        <button onClick={onDisable} disabled={saving || disabling}
          className="ml-auto inline-flex items-center gap-2 px-5 py-2.5 border border-border rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 hover:border-red-200 disabled:opacity-50 transition-colors">
          {disabling ? <Loader2 size={15} className="animate-spin" /> : <Ban size={15} />} {disableLabel}
        </button>
      )}
    </div>
  );
}

/**
 * The disable half of a component's save pair. Sends `enabled: false` and NO config, so the
 * server keeps the stored settings — switch it back on later and the rates are as they were.
 */
function useDisableComponent(path: string, label: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.put(`/statutory/${path}`, { enabled: false }),
    onSuccess: () => { toast.success(`${label} disabled`); qc.invalidateQueries({ queryKey: ['statutory'] }); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to disable'),
  });
}

/*
 * A percentage spinner for the EPF rates.
 *
 * The raw keystrokes are held as a string so a half-typed "10." or a cleared box does not
 * become 0 mid-edit and re-render the field out from under the typist. Only a parsed number
 * is handed upward, and blur snaps an empty or out-of-range box back to the last good value —
 * saveEpf rejects anything outside 0.01–100, and a rejected save is a worse way to learn that
 * than the field simply refusing to hold it.
 */
function RatePct({ value, onChange }: { value: any; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value ?? ''));
  useEffect(() => setDraft(String(value ?? '')), [value]);
  const commit = () => {
    const n = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(n) || n < 0.01 || n > 100) setDraft(String(value ?? ''));
    else onChange(n);
  };
  return (
    <div className="flex items-center gap-2">
      <div className="relative w-32">
        <input
          type="number" step="0.01" min="0.01" max="100" value={draft}
          onChange={(e) => { setDraft(e.target.value); const n = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(n) && n >= 0.01 && n <= 100) onChange(n); }}
          onBlur={commit}
          className={`${inputCls} pr-7`}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-secondary">%</span>
      </div>
      <span className="text-sm text-secondary whitespace-nowrap">of Actual PF Wage</span>
    </div>
  );
}

// ─────────────────────────────── EPF ───────────────────────────────
function EpfTab({ epf }: { epf: any }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [showSplit, setShowSplit] = useState(false);
  const [cfg, setCfg] = useState(epf.config);
  useEffect(() => setCfg(epf.config), [epf.config]);

  const set = (k: string, v: any) => setCfg((c: any) => ({ ...c, [k]: v }));

  const save = useMutation({
    mutationFn: () => api.put('/statutory/epf', { enabled: true, config: cfg }),
    onSuccess: () => { toast.success('EPF settings saved'); setEditing(false); qc.invalidateQueries({ queryKey: ['statutory'] }); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save'),
  });
  // setEditing(false) as well, or the form stays open over an already-disabled component
  // instead of falling back to the "Are you registered for EPF?" screen.
  const disable = useDisableComponent('epf', 'EPF');
  const onDisable = () => disable.mutate(undefined, { onSuccess: () => setEditing(false) });

  if (!epf.enabled && !editing) {
    return (
      <EmptyState
        icon={<PiggyBank size={34} />}
        heading="Are you registered for EPF?"
        text="Any organisation with 20 or more employees must register for the Employee Provident Fund (EPF) scheme, a retirement benefit plan for all salaried employees."
        cta="Enable EPF"
        onCta={() => setEditing(true)}
      />
    );
  }

  const SAMPLE = 20000;
  const eeEpf = Math.round(SAMPLE * (Number(cfg.employeeRatePct) || 0) / 100);
  // EPS takes 8.33% of the capped wage and EPF gets what is left of the employer's share.
  // Clamped because the rate is a free spinner now: below 8.33% the old subtraction rendered
  // a negative EPF line and a total larger than the rate actually set.
  const erTotal = Math.round(SAMPLE * (Number(cfg.employerRatePct) || 0) / 100);
  const eps = Math.min(erTotal, Math.round(Math.min(SAMPLE, 15000) * 8.33 / 100));
  const erEpf = erTotal - eps;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground">Employees&apos; Provident Fund</h2>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6 items-start">
        {/* Form */}
        <div className="bg-card rounded-xl border border-border p-6 space-y-5">
          <Field label={<>Deduction Cycle <InfoTip text="EPF is deducted every month." /></>}>
            <input value="Monthly" readOnly className={`${inputCls} bg-muted/50 cursor-default`} />
          </Field>

          {/* Both rates were a two-option dropdown (12% / 10%). saveEpf has always accepted
              anything in 0.01–100 via num(), so the picker was narrower than the rule it was
              standing in for — a reduced-rate establishment on 10% could be configured but
              nothing in between could. Now a spinner, matching the ESI tab's two rate inputs. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Employee Contribution Rate">
              <RatePct value={cfg.employeeRatePct} onChange={(v) => set('employeeRatePct', v)} />
            </Field>
            <Field label={
              <span className="flex items-center justify-between">
                <span>Employer Contribution Rate</span>
                <button type="button" onClick={() => setShowSplit((s) => !s)} className="text-xs text-primary hover:underline font-normal">View Splitup</button>
              </span>
            }>
              <RatePct value={cfg.employerRatePct} onChange={(v) => set('employerRatePct', v)} />
            </Field>
          </div>
          <p className="text-xs text-secondary -mt-2">
            Statutory EPF is <b className="text-foreground">12%</b>; <b className="text-foreground">10%</b> applies to the
            reduced-rate establishments named in the Act. The sample on the right follows whatever you set here.
          </p>
          {showSplit && (
            <div className="text-xs text-secondary bg-muted/40 rounded-lg p-3 -mt-2">
              Employer&apos;s {cfg.employerRatePct}% splits into <b>EPS</b> (8.33% of PF wage, capped at ₹15,000) and <b>EPF</b> (the remainder).
            </div>
          )}

          <div className="space-y-3 pt-1">
            <label className="flex items-start gap-2.5 cursor-pointer text-sm text-foreground">
              <input type="checkbox" className="accent-primary w-4 h-4 mt-0.5" checked={cfg.includeEmployerInCtc !== false} onChange={(e) => set('includeEmployerInCtc', e.target.checked)} />
              <span>Include employer&apos;s PF contribution in the employee&apos;s CTC.</span>
            </label>
          </div>

          <div className="pt-2">
            <h3 className="text-sm font-semibold text-foreground mb-2">PF Configuration when LOP Applied</h3>
            <div className="space-y-3">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input type="radio" name="epf-lop" className="accent-primary w-4 h-4 mt-0.5" checked={cfg.lopMode === 'prorate_restricted'} onChange={() => set('lopMode', 'prorate_restricted')} />
                <span className="text-sm">
                  <span className="text-foreground">Pro-rate Restricted PF Wage</span>
                  <span className="block text-xs text-secondary">PF contribution will be pro-rated based on the number of days worked by the employee.</span>
                </span>
              </label>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input type="radio" name="epf-lop" className="accent-primary w-4 h-4 mt-0.5" checked={cfg.lopMode === 'consider_all_below_15000'} onChange={() => set('lopMode', 'consider_all_below_15000')} />
                <span className="text-sm">
                  <span className="text-foreground">Consider all applicable salary components if PF wage is less than ₹15,000 after Loss of Pay</span>
                  <span className="block text-xs text-secondary">PF wage will be computed from all applicable components when Loss of Pay brings the restricted PF wage below ₹15,000.</span>
                </span>
              </label>
            </div>
          </div>

          <Footer onCancel={() => { setCfg(epf.config); setEditing(false); }} onSave={() => save.mutate()} saving={save.isPending} saveLabel={epf.enabled ? 'Save' : 'Enable'}
            onDisable={epf.enabled ? onDisable : undefined} disableLabel="Disable EPF" disabling={disable.isPending} />
        </div>

        {/* Sample calc panel */}
        <div className="bg-card rounded-xl border border-border border-t-4 border-t-orange-500 p-5">
          <h3 className="text-sm font-semibold text-foreground mb-2">Sample EPF Calculation</h3>
          <p className="text-xs text-secondary mb-3">Let&apos;s assume the PF wage is ₹20,000. The breakup of contribution will be:</p>
          <div className="border border-border rounded-lg p-3 space-y-3 text-xs">
            <div>
              <p className="font-semibold text-foreground mb-1">Employee&apos;s Contribution</p>
              <div className="flex justify-between text-secondary"><span>EPF ({cfg.employeeRatePct}% of 20000)</span><span className="text-foreground font-medium">{formatINR(eeEpf)}</span></div>
            </div>
            <div>
              <p className="font-semibold text-foreground mb-1">Employer&apos;s Contribution</p>
              <div className="flex justify-between text-secondary"><span>EPS (8.33% of 20000, max of ₹15,000)</span><span className="text-foreground font-medium">{formatINR(eps)}</span></div>
              <div className="flex justify-between text-secondary"><span>EPF ({cfg.employerRatePct}% of 20000 − EPS)</span><span className="text-foreground font-medium">{formatINR(erEpf)}</span></div>
              <div className="flex justify-between border-t border-border mt-1.5 pt-1.5"><span className="text-foreground font-medium">Total</span><span className="text-foreground font-semibold">{formatINR(erTotal)}</span></div>
            </div>
          </div>
          <p className="text-xs text-secondary mt-3">Do you want to preview EPF calculation for multiple cases?</p>
          <button className="text-xs text-primary hover:underline mt-1" title="Detailed multi-case preview coming soon.">Preview EPF Calculation</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────── ESI ───────────────────────────────
function EsiTab({ esi }: { esi: any }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [cfg, setCfg] = useState(esi.config);
  useEffect(() => setCfg(esi.config), [esi.config]);
  const set = (k: string, v: any) => setCfg((c: any) => ({ ...c, [k]: v }));

  const save = useMutation({
    mutationFn: () => api.put('/statutory/esi', { enabled: true, config: cfg }),
    onSuccess: () => { toast.success('ESI settings saved'); setEditing(false); qc.invalidateQueries({ queryKey: ['statutory'] }); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save'),
  });
  const disable = useDisableComponent('esi', 'ESI');
  const onDisable = () => disable.mutate(undefined, { onSuccess: () => setEditing(false) });

  if (!esi.enabled && !editing) {
    return (
      <EmptyState
        icon={<Landmark size={34} />}
        heading="Are you registered for ESI?"
        text="Organisations having 10 or more employees must register for Employee State Insurance (ESI). This scheme provides cash allowances and medical benefits for employees whose monthly salary is less than ₹21,000."
        cta="Enable ESI"
        onCta={() => setEditing(true)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground">Employees&apos; State Insurance</h2>
      <div className="bg-card rounded-xl border border-border p-6 space-y-5 max-w-2xl">
        <Field label={<>Deduction Cycle <InfoTip text="ESI is deducted every month." /></>}>
          <input value="Monthly" readOnly className={`${inputCls} bg-muted/50 cursor-default`} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Employees' Contribution">
            <div className="flex items-center gap-2">
              <input type="number" step="0.01" value={cfg.employeeRatePct} onChange={(e) => set('employeeRatePct', e.target.value)} className={`${inputCls} w-28`} />
              <span className="text-sm text-secondary whitespace-nowrap">of Gross Pay</span>
            </div>
          </Field>
          <Field label="Employer's Contribution">
            <div className="flex items-center gap-2">
              <input type="number" step="0.01" value={cfg.employerRatePct} onChange={(e) => set('employerRatePct', e.target.value)} className={`${inputCls} w-28`} />
              <span className="text-sm text-secondary whitespace-nowrap">of Gross Pay</span>
            </div>
          </Field>
        </div>
        <label className="flex items-start gap-2.5 cursor-pointer text-sm text-foreground">
          <input type="checkbox" className="accent-primary w-4 h-4 mt-0.5" checked={!!cfg.includeEmployerInCtc} onChange={(e) => set('includeEmployerInCtc', e.target.checked)} />
          <span>Include employer&apos;s contribution in employee&apos;s salary structure.</span>
        </label>
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-xs">
          ESI deductions will be made only if the employee&apos;s monthly salary is less than or equal to ₹21,000. If the employee gets a salary revision which increases their monthly salary above ₹21,000, they would have to continue making ESI contributions till the end of the contribution period in which the salary was revised (April–September or October–March).
        </div>
        <Footer onCancel={() => { setCfg(esi.config); setEditing(false); }} onSave={() => save.mutate()} saving={save.isPending} saveLabel={esi.enabled ? 'Save' : 'Enable'}
          onDisable={esi.enabled ? onDisable : undefined} disableLabel="Disable ESI" disabling={disable.isPending} />
      </div>
    </div>
  );
}

// ─────────────────────────── Professional Tax ───────────────────────────
function PtTab({ pt }: { pt: any[] }) {
  const existing = new Set<string>(pt.map((r) => r.state));
  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Professional Tax</h2>
        <p className="text-sm text-secondary mt-1">Levied by the State Government on monthly gross salary; slabs differ per state. The states below come from your properties, and you can add one that isn&apos;t there yet — configure slabs only where PT is actually levied, and the engine deducts automatically.</p>
      </div>
      <div className="space-y-3">
        {pt.map((row) => <PtStateCard key={row.state} row={row} />)}
      </div>
      <AddPtState existingStates={existing} />
    </div>
  );
}

interface SlabDraft { min: string; max: string; amount: string }

const BLANK_SLABS = (): SlabDraft[] => [{ min: '0', max: '', amount: '0' }];

// A row the admin never filled in at all is dropped rather than sent as a 0–0 slab that
// deducts nothing and then blocks the next slab as an overlap.
const slabsPayload = (slabs: SlabDraft[]) => slabs
  .filter((s) => s.min !== '' || s.max !== '' || s.amount !== '')
  .map((s) => ({ min: Number(s.min) || 0, max: s.max === '' ? null : Number(s.max), amount: Number(s.amount) || 0 }));

// The slab grid only — each caller keeps its own "+ Add slab" link and action buttons,
// because the card puts them on one row with Disable/Save and the add-state form does not.
function SlabRows({ slabs, setSlabs }: { slabs: SlabDraft[]; setSlabs: React.Dispatch<React.SetStateAction<SlabDraft[]>> }) {
  const edit = (i: number, patch: Partial<SlabDraft>) => setSlabs(p => p.map((x, j) => j === i ? { ...x, ...patch } : x));
  return (
    <>
      {slabs.map((s, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_1fr_32px] gap-2 items-center">
          <input type="number" placeholder="From ₹" value={s.min} onChange={(e) => edit(i, { min: e.target.value })}
            className="px-2 py-1.5 border border-border rounded-lg bg-background text-sm" />
          <input type="number" placeholder="To ₹ (blank = no limit)" value={s.max} onChange={(e) => edit(i, { max: e.target.value })}
            className="px-2 py-1.5 border border-border rounded-lg bg-background text-sm" />
          <input type="number" placeholder="PT ₹/month" value={s.amount} onChange={(e) => edit(i, { amount: e.target.value })}
            className="px-2 py-1.5 border border-border rounded-lg bg-background text-sm" />
          <button onClick={() => setSlabs(p => p.filter((_, j) => j !== i))} className="p-1 text-secondary hover:text-red-600" title="Remove slab">✕</button>
        </div>
      ))}
    </>
  );
}

/*
 * Introduce a state that has no property yet. Mirrors AddLwfState: savePtState accepts any
 * name in INDIAN_STATES, not just the derived ones, so the PUT is all that is needed.
 *
 * Worth knowing before you use it: writing a PT row makes that state an OPERATING state
 * everywhere, because getOperatingStates unions properties with the states that already
 * carry statutory rows. So the state also gains an LWF card here and joins the preview-state
 * picker on Salary Structures. That is the intended way to configure a state ahead of opening
 * a property in it.
 */
function AddPtState({ existingStates }: { existingStates: Set<string> }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState('');
  const [slabs, setSlabs] = useState<SlabDraft[]>(BLANK_SLABS());

  const reset = () => { setOpen(false); setState(''); setSlabs(BLANK_SLABS()); };
  const options = INDIAN_STATES.filter((s) => !existingStates.has(s));

  const save = useMutation({
    mutationFn: () => api.put(`/statutory/pt/${encodeURIComponent(state)}`, { enabled: true, config: { slabs: slabsPayload(slabs) } }),
    onSuccess: () => { toast.success(`Professional Tax added for ${state}`); qc.invalidateQueries({ queryKey: ['statutory'] }); reset(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to add state'),
  });

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
        <Plus size={15} /> Add a state
      </button>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-dashed border-border p-5 space-y-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">Add a state</h3>
        <button onClick={reset} className="p-1 text-secondary hover:text-foreground" aria-label="Close"><X size={16} /></button>
      </div>

      <label className="block text-xs text-secondary">State
        <select value={state} onChange={(e) => setState(e.target.value)} className={`${inputCls} mt-1`}>
          <option value="">Select a state…</option>
          {options.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>

      <div className="space-y-2">
        <SlabRows slabs={slabs} setSlabs={setSlabs} />
        <button onClick={() => setSlabs(p => [...p, { min: '', max: '', amount: '' }])} className="text-xs text-primary hover:underline">+ Add slab</button>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={reset} className="px-3 py-1.5 border border-border rounded-lg text-xs font-medium hover:bg-muted">Cancel</button>
        {/* PT with no slabs deducts nothing, and the server rejects enabling in that state —
            so the button is held shut rather than letting the save come back as an error. */}
        <button onClick={() => save.mutate()} disabled={save.isPending || !state || slabsPayload(slabs).length === 0}
          className="px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-50">
          {save.isPending ? 'Adding…' : 'Add & Enable'}
        </button>
      </div>
    </div>
  );
}

function PtStateCard({ row }: { row: any }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [slabs, setSlabs] = useState<SlabDraft[]>([]);

  const openEditor = () => {
    const existing = Array.isArray(row.config?.slabs) ? row.config.slabs : [];
    setSlabs(existing.length
      ? existing.map((s: any) => ({ min: String(s.min ?? 0), max: s.max == null ? '' : String(s.max), amount: String(s.amount ?? 0) }))
      : BLANK_SLABS());
    setEditing(true);
  };

  const save = useMutation({
    mutationFn: (payload: { enabled: boolean; config?: any }) => api.put(`/statutory/pt/${encodeURIComponent(row.state)}`, payload),
    onSuccess: () => { toast.success(`Professional Tax updated for ${row.state}`); qc.invalidateQueries({ queryKey: ['statutory'] }); setEditing(false); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save'),
  });

  const submit = (enabled: boolean) => save.mutate({ enabled, config: { slabs: slabsPayload(slabs) } });

  const configured = Array.isArray(row.config?.slabs) && row.config.slabs.length > 0;

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h3 className="text-sm font-semibold text-foreground">{row.state}</h3>
        <div className="flex items-center gap-2">
          {row.enabled
            ? <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-semibold">Enabled</span>
            : <span className="px-2 py-0.5 rounded-full bg-muted text-secondary text-xs font-semibold">Not levied</span>}
          <button onClick={() => (editing ? setEditing(false) : openEditor())} className="text-xs text-primary hover:underline">
            {editing ? 'Close' : configured || row.enabled ? 'Edit slabs' : 'Configure slabs'}
          </button>
        </div>
      </div>

      {!editing && !configured && (
        <div className="flex items-center gap-2.5 text-sm text-secondary">
          <span className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-secondary shrink-0"><Ban size={16} /></span>
          No PT slabs configured — nothing is deducted for {row.state}.
        </div>
      )}
      {!editing && configured && (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-secondary"><th className="py-1 font-medium">Monthly gross from</th><th className="py-1 font-medium">To</th><th className="py-1 font-medium text-right">PT / month</th></tr></thead>
          <tbody>
            {row.config.slabs.map((s: any, i: number) => (
              <tr key={i} className="border-t border-border">
                <td className="py-1.5">{formatINR(s.min)}</td>
                <td className="py-1.5">{s.max == null ? 'No limit' : formatINR(s.max)}</td>
                <td className="py-1.5 text-right font-medium">{formatINR(s.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && (
        <div className="space-y-2 mt-2">
          <SlabRows slabs={slabs} setSlabs={setSlabs} />
          <div className="flex items-center justify-between pt-1">
            <button onClick={() => setSlabs(p => [...p, { min: '', max: '', amount: '' }])} className="text-xs text-primary hover:underline">+ Add slab</button>
            <div className="flex gap-2">
              {row.enabled && (
                <button onClick={() => save.mutate({ enabled: false })} disabled={save.isPending}
                  className="px-3 py-1.5 border border-border rounded-lg text-xs font-medium hover:bg-muted disabled:opacity-50">Disable PT</button>
              )}
              <button onClick={() => submit(true)} disabled={save.isPending}
                className="px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-50">
                {save.isPending ? 'Saving…' : 'Save & Enable'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── Labour Welfare Fund ───────────────────────────
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function LwfTab({ lwf }: { lwf: any[] }) {
  const existing = new Set<string>(lwf.map((r) => r.state));
  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Labour Welfare Fund</h2>
        <p className="text-sm text-secondary mt-1">Per-state LWF rules — fixed amounts or a percent of gross, deducted every month or only in specific months (e.g. Delhi: June &amp; December). Everything here is data; the engine follows it exactly. States without an LWF act stay disabled.</p>
      </div>
      <div className="space-y-3">
        {lwf.map((row) => <LwfStateCard key={row.state} row={row} />)}
      </div>
      <AddLwfState existingStates={existing} />
    </div>
  );
}

// Introduce a state that isn't in the list yet, with its LWF rules. Mirrors the
// LwfStateCard edit form; the backend upserts a row for any valid Indian state,
// which then shows up as its own card on the next load.
function AddLwfState({ existingStates }: { existingStates: Set<string> }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState('');
  const blank = { mode: 'percent', employeePct: '', employeeMaxAmount: '', employerMultiplier: '', employeeAmount: '', employerAmount: '', deductionMonths: [] as number[] };
  const [cfg, setCfg] = useState<any>({ ...blank });

  const reset = () => { setOpen(false); setState(''); setCfg({ ...blank }); };
  const options = INDIAN_STATES.filter((s) => !existingStates.has(s));

  const save = useMutation({
    mutationFn: () => api.put(`/statutory/lwf/${encodeURIComponent(state)}`, {
      enabled: true,
      config: {
        mode: cfg.mode === 'fixed' ? 'fixed' : 'percent',
        employeePct: Number(cfg.employeePct) || 0,
        employeeMaxAmount: Number(cfg.employeeMaxAmount) || 0,
        employerMultiplier: Number(cfg.employerMultiplier) || 1,
        employeeAmount: Number(cfg.employeeAmount) || 0,
        employerAmount: Number(cfg.employerAmount) || 0,
        deductionMonths: Array.isArray(cfg.deductionMonths) ? cfg.deductionMonths : [],
      },
    }),
    onSuccess: () => { toast.success(`LWF added for ${state}`); qc.invalidateQueries({ queryKey: ['statutory'] }); reset(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to add state'),
  });

  const draftMonths: number[] = Array.isArray(cfg.deductionMonths) ? cfg.deductionMonths : [];
  const toggleMonth = (m: number) => setCfg((p: any) => {
    const cur: number[] = Array.isArray(p.deductionMonths) ? p.deductionMonths : [];
    return { ...p, deductionMonths: cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m].sort((a, b) => a - b) };
  });

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
        <Plus size={15} /> Add a state
      </button>
    );
  }

  const mode = cfg.mode === 'fixed' ? 'fixed' : 'percent';
  return (
    <div className="bg-card rounded-xl border border-dashed border-border p-5 space-y-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">Add a state</h3>
        <button onClick={reset} className="p-1 text-secondary hover:text-foreground" aria-label="Close"><X size={16} /></button>
      </div>

      <label className="block text-xs text-secondary">State
        <select value={state} onChange={(e) => setState(e.target.value)} className={`${inputCls} mt-1`}>
          <option value="">Select a state…</option>
          {options.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>

      <div className="flex gap-4">
        {(['percent', 'fixed'] as const).map((m) => (
          <label key={m} className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" className="accent-primary" checked={mode === m} onChange={() => setCfg((p: any) => ({ ...p, mode: m }))} />
            <span className="capitalize">{m === 'percent' ? '% of gross (capped)' : 'Fixed amounts'}</span>
          </label>
        ))}
      </div>
      {mode === 'percent' ? (
        <div className="grid grid-cols-3 gap-2">
          <label className="text-xs text-secondary">Employee %<input type="number" step="any" value={cfg.employeePct} onChange={(e) => setCfg((p: any) => ({ ...p, employeePct: e.target.value }))} className="mt-1 w-full px-2 py-1.5 border border-border rounded-lg bg-background text-sm" /></label>
          <label className="text-xs text-secondary">Max ₹<input type="number" step="any" value={cfg.employeeMaxAmount} onChange={(e) => setCfg((p: any) => ({ ...p, employeeMaxAmount: e.target.value }))} className="mt-1 w-full px-2 py-1.5 border border-border rounded-lg bg-background text-sm" /></label>
          <label className="text-xs text-secondary">Employer ×<input type="number" step="any" value={cfg.employerMultiplier} onChange={(e) => setCfg((p: any) => ({ ...p, employerMultiplier: e.target.value }))} className="mt-1 w-full px-2 py-1.5 border border-border rounded-lg bg-background text-sm" /></label>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-secondary">Employee ₹<input type="number" step="any" value={cfg.employeeAmount} onChange={(e) => setCfg((p: any) => ({ ...p, employeeAmount: e.target.value }))} className="mt-1 w-full px-2 py-1.5 border border-border rounded-lg bg-background text-sm" /></label>
          <label className="text-xs text-secondary">Employer ₹<input type="number" step="any" value={cfg.employerAmount} onChange={(e) => setCfg((p: any) => ({ ...p, employerAmount: e.target.value }))} className="mt-1 w-full px-2 py-1.5 border border-border rounded-lg bg-background text-sm" /></label>
        </div>
      )}
      <div>
        <p className="text-xs text-secondary mb-1.5">Deduction months <span className="text-secondary/70">(none selected = every month)</span></p>
        <div className="flex flex-wrap gap-1.5">
          {MONTH_LABELS.map((label, i) => (
            <button key={label} onClick={() => toggleMonth(i + 1)}
              className={`px-2 py-1 rounded-lg text-xs font-medium border transition-colors ${draftMonths.includes(i + 1) ? 'bg-primary text-white border-primary' : 'border-border text-secondary hover:bg-muted'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={reset} className="px-3 py-1.5 border border-border rounded-lg text-xs font-medium hover:bg-muted">Cancel</button>
        <button onClick={() => save.mutate()} disabled={save.isPending || !state}
          className="px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-50">
          {save.isPending ? 'Adding…' : 'Add & Enable'}
        </button>
      </div>
    </div>
  );
}

function LwfStateCard({ row }: { row: any }) {
  const qc = useQueryClient();
  const c = row.config || {};
  const [editing, setEditing] = useState(false);
  const [cfg, setCfg] = useState<any>(c);

  const save = useMutation({
    mutationFn: (payload: { enabled: boolean; config?: any }) => api.put(`/statutory/lwf/${encodeURIComponent(row.state)}`, payload),
    onSuccess: () => { toast.success(`LWF updated for ${row.state}`); qc.invalidateQueries({ queryKey: ['statutory'] }); setEditing(false); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save'),
  });

  const months: number[] = Array.isArray(c.deductionMonths) ? c.deductionMonths : [];
  const cycleLabel = months.length === 0 ? 'Every month' : months.map((m) => MONTH_LABELS[m - 1]).join(', ');
  const draftMonths: number[] = Array.isArray(cfg.deductionMonths) ? cfg.deductionMonths : [];
  const toggleMonth = (m: number) => setCfg((p: any) => {
    const cur: number[] = Array.isArray(p.deductionMonths) ? p.deductionMonths : [];
    return { ...p, deductionMonths: cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m].sort((a, b) => a - b) };
  });

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-sm font-semibold text-foreground">{row.state}</h3>
        <div className="flex items-center gap-2">
          {row.enabled
            ? <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-semibold">Enabled</span>
            : <span className="px-2 py-0.5 rounded-full bg-muted text-secondary text-xs font-semibold">Disabled</span>}
          <button onClick={() => { setCfg({ ...c }); setEditing(!editing); }} className="text-xs text-primary hover:underline">
            {editing ? 'Close' : 'Edit'}
          </button>
        </div>
      </div>

      {!editing ? (
        <dl className="space-y-2 text-sm">
          {c.mode === 'fixed' ? (
            <>
              <div className="flex justify-between gap-4"><dt className="text-secondary">Employee&apos;s Contribution</dt><dd className="text-foreground">{formatINR(c.employeeAmount)} fixed</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-secondary">Employer&apos;s Contribution</dt><dd className="text-foreground">{formatINR(c.employerAmount)} fixed</dd></div>
            </>
          ) : (
            <>
              <div className="flex justify-between gap-4">
                <dt className="text-secondary">Employee&apos;s Contribution</dt>
                <dd className="text-right text-foreground">{Number(c.employeePct)}% of Gross Pay
                  <span className="block text-xs text-secondary">(Max Limit: {formatINR(c.employeeMaxAmount)})</span></dd>
              </div>
              <div className="flex justify-between gap-4"><dt className="text-secondary">Employer&apos;s Contribution</dt><dd className="text-foreground">{Number(c.employerMultiplier)} × Employee&apos;s Contribution</dd></div>
            </>
          )}
          <div className="flex justify-between gap-4"><dt className="text-secondary">Deducted In</dt><dd className="text-foreground">{cycleLabel}</dd></div>
        </dl>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="flex gap-4">
            {(['percent', 'fixed'] as const).map((m) => (
              <label key={m} className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" className="accent-primary" checked={(cfg.mode === 'fixed' ? 'fixed' : 'percent') === m}
                  onChange={() => setCfg((p: any) => ({ ...p, mode: m }))} />
                <span className="capitalize">{m === 'percent' ? '% of gross (capped)' : 'Fixed amounts'}</span>
              </label>
            ))}
          </div>
          {(cfg.mode === 'fixed' ? 'fixed' : 'percent') === 'percent' ? (
            <div className="grid grid-cols-3 gap-2">
              <label className="text-xs text-secondary">Employee %<input type="number" step="any" value={cfg.employeePct ?? ''} onChange={(e) => setCfg((p: any) => ({ ...p, employeePct: e.target.value }))} className="mt-1 w-full px-2 py-1.5 border border-border rounded-lg bg-background text-sm" /></label>
              <label className="text-xs text-secondary">Max ₹<input type="number" step="any" value={cfg.employeeMaxAmount ?? ''} onChange={(e) => setCfg((p: any) => ({ ...p, employeeMaxAmount: e.target.value }))} className="mt-1 w-full px-2 py-1.5 border border-border rounded-lg bg-background text-sm" /></label>
              <label className="text-xs text-secondary">Employer ×<input type="number" step="any" value={cfg.employerMultiplier ?? ''} onChange={(e) => setCfg((p: any) => ({ ...p, employerMultiplier: e.target.value }))} className="mt-1 w-full px-2 py-1.5 border border-border rounded-lg bg-background text-sm" /></label>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-secondary">Employee ₹<input type="number" step="any" value={cfg.employeeAmount ?? ''} onChange={(e) => setCfg((p: any) => ({ ...p, employeeAmount: e.target.value }))} className="mt-1 w-full px-2 py-1.5 border border-border rounded-lg bg-background text-sm" /></label>
              <label className="text-xs text-secondary">Employer ₹<input type="number" step="any" value={cfg.employerAmount ?? ''} onChange={(e) => setCfg((p: any) => ({ ...p, employerAmount: e.target.value }))} className="mt-1 w-full px-2 py-1.5 border border-border rounded-lg bg-background text-sm" /></label>
            </div>
          )}
          <div>
            <p className="text-xs text-secondary mb-1.5">Deduction months <span className="text-secondary/70">(none selected = every month)</span></p>
            <div className="flex flex-wrap gap-1.5">
              {MONTH_LABELS.map((label, i) => (
                <button key={label} onClick={() => toggleMonth(i + 1)}
                  className={`px-2 py-1 rounded-lg text-xs font-medium border transition-colors ${draftMonths.includes(i + 1) ? 'bg-primary text-white border-primary' : 'border-border text-secondary hover:bg-muted'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            {row.enabled && (
              <button onClick={() => save.mutate({ enabled: false })} disabled={save.isPending}
                className="px-3 py-1.5 border border-border rounded-lg text-xs font-medium hover:bg-muted disabled:opacity-50">Disable</button>
            )}
            <button
              onClick={() => save.mutate({
                enabled: true,
                config: {
                  mode: cfg.mode === 'fixed' ? 'fixed' : 'percent',
                  employeePct: Number(cfg.employeePct) || 0,
                  employeeMaxAmount: Number(cfg.employeeMaxAmount) || 0,
                  employerMultiplier: Number(cfg.employerMultiplier) || 1,
                  employeeAmount: Number(cfg.employeeAmount) || 0,
                  employerAmount: Number(cfg.employerAmount) || 0,
                  deductionMonths: draftMonths,
                },
              })}
              disabled={save.isPending}
              className="px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-50">
              {save.isPending ? 'Saving…' : 'Save & Enable'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────── Statutory Bonus ───────────────────────────────
function BonusTab({ bonus }: { bonus: any }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [cfg, setCfg] = useState(bonus.config);
  useEffect(() => setCfg(bonus.config), [bonus.config]);
  const set = (k: string, v: any) => setCfg((c: any) => ({ ...c, [k]: v }));

  const save = useMutation({
    mutationFn: () => api.put('/statutory/bonus', { enabled: true, config: cfg }),
    onSuccess: () => { toast.success('Statutory bonus saved'); setEditing(false); qc.invalidateQueries({ queryKey: ['statutory'] }); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save'),
  });
  const disable = useDisableComponent('bonus', 'Statutory bonus');
  const onDisable = () => disable.mutate(undefined, { onSuccess: () => setEditing(false) });

  if (!bonus.enabled && !editing) {
    return (
      <EmptyState
        icon={<IndianRupee size={34} />}
        heading="Are your employees eligible to receive statutory bonus?"
        text="According to the Payment of Bonus Act, 1965, an eligible employee can receive a statutory bonus of 8.33% (min) to 20% (max) of their salary earned during a financial year. Configure statutory bonus of your organisation and start paying your employees."
        cta="Enable Statutory Bonus"
        onCta={() => setEditing(true)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground">Statutory Bonus</h2>
      <div className="bg-card rounded-xl border border-border p-6 space-y-5 max-w-2xl">
        <Field label="Monthly Percentage of Bonus" required>
          <div className="flex items-center gap-2">
            <div className="relative w-32">
              <input type="number" step="0.01" value={cfg.monthlyPercent} onChange={(e) => set('monthlyPercent', e.target.value)} className={`${inputCls} pr-7`} />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-secondary">%</span>
            </div>
            <span className="text-sm text-secondary">of salary or minimum wage earned this year</span>
          </div>
        </Field>
        <p className="text-xs text-secondary flex items-center gap-1.5"><InfoTip text="Statutory Bonus Act, 1965." /> Statutory Bonus rate should be in-between <b className="text-foreground">8.33%</b> and <b className="text-foreground">20%</b>, based on the Statutory Bonus Act.</p>

        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-xs space-y-1.5">
          <p className="font-semibold">NOTE</p>
          <ul className="list-disc pl-4 space-y-1">
            <li>The payment frequency of this statutory bonus is <b>monthly and taxable</b>.</li>
            <li>Once you&apos;ve associated the statutory bonus with an employee, you can change the bonus percentage <b>only at the beginning of the next fiscal year</b>.</li>
          </ul>
        </div>

        <p className="text-xs text-secondary">Statutory Bonus is a percentage of the minimum wage or Basic (whichever the Act caps it at). Configure per-state minimum wage in the <span className="font-medium text-foreground">Minimum Wage</span> tab.</p>

        <Footer onCancel={() => { setCfg(bonus.config); setEditing(false); }} onSave={() => save.mutate()} saving={save.isPending} saveLabel={bonus.enabled ? 'Save' : 'Enable'}
          onDisable={bonus.enabled ? onDisable : undefined} disableLabel="Disable Bonus" disabling={disable.isPending} />
      </div>
    </div>
  );
}

// ─────────────────────────────── Minimum Wage ───────────────────────────────
function MinimumWageTab({ states, minimumWages }: { states: string[]; minimumWages: any[] }) {
  const qc = useQueryClient();
  const [addState, setAddState] = useState<string | null>(null);
  const [wageInput, setWageInput] = useState('');
  const [addingNewState, setAddingNewState] = useState(false);
  const [newState, setNewState] = useState('');
  const [newWage, setNewWage] = useState('');

  // Upsert a per-state minimum wage. Used for both the inline per-state add/edit
  // and the "Add a state" form below (any Indian state, not just operating ones).
  const saveWage = useMutation({
    mutationFn: (v: { state: string; wage: string }) => api.post('/statutory/minimum-wage', { state: v.state, monthly_wage: Number(v.wage) }),
    onSuccess: () => {
      toast.success('Minimum wage saved');
      setAddState(null); setWageInput(''); setAddingNewState(false); setNewState(''); setNewWage('');
      qc.invalidateQueries({ queryKey: ['statutory'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save'),
  });

  const wageFor = (state: string) => minimumWages.find((w: any) => w.state === state);

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Minimum Wage</h2>
        <p className="text-sm text-secondary mt-1">The monthly minimum wage set by each state government. An employee&apos;s state comes from their property — no employee can be offered a Total CTC below their state&apos;s minimum wage, and Statutory Bonus uses it as a floor.</p>
      </div>
      <div className="space-y-3">
        {states.map((s) => {
          const w = wageFor(s);
          return (
            <div key={s} className="border border-border rounded-lg p-4">
              <h4 className="text-sm font-semibold text-foreground mb-2">{s}</h4>
              {addState === s ? (
                <div className="flex items-center gap-2">
                  <input type="number" autoFocus value={wageInput} onChange={(e) => setWageInput(e.target.value)} placeholder="Monthly minimum wage" className={`${inputCls} max-w-xs`} />
                  <button onClick={() => saveWage.mutate({ state: s, wage: wageInput })} disabled={saveWage.isPending || !wageInput} className="px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">{w ? 'Save' : 'Add'}</button>
                  <button onClick={() => { setAddState(null); setWageInput(''); }} className="p-2 text-secondary hover:text-foreground"><X size={16} /></button>
                </div>
              ) : w ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-foreground">Minimum wage: <span className="font-medium">{formatINR(w.monthly_wage)}</span> / month</p>
                  <button onClick={() => { setAddState(s); setWageInput(String(w.monthly_wage)); }} className="text-sm text-primary hover:underline whitespace-nowrap">Edit</button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm text-amber-700"><AlertTriangle size={15} className="text-amber-500" /> Minimum wage details are not added for {s}</span>
                  <button onClick={() => { setAddState(s); setWageInput(''); }} className="inline-flex items-center gap-1 text-sm text-primary hover:underline whitespace-nowrap"><Plus size={14} /> Add Minimum Wage</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Configure a state that isn't listed above (any Indian state). */}
      <div className="pt-1">
        {!addingNewState ? (
          <button onClick={() => setAddingNewState(true)} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
            <Plus size={15} /> Add a state
          </button>
        ) : (
          <div className="border border-dashed border-border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold text-foreground">Add a state</h4>
              <button onClick={() => { setAddingNewState(false); setNewState(''); setNewWage(''); }} className="p-1 text-secondary hover:text-foreground" aria-label="Close"><X size={16} /></button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs text-secondary">State
                <select value={newState} onChange={(e) => setNewState(e.target.value)} className={`${inputCls} mt-1`}>
                  <option value="">Select a state…</option>
                  {INDIAN_STATES.filter((st) => !states.includes(st)).map((st) => <option key={st} value={st}>{st}</option>)}
                </select>
              </label>
              <label className="text-xs text-secondary">Monthly minimum wage ₹
                <input type="number" value={newWage} onChange={(e) => setNewWage(e.target.value)} placeholder="e.g. 12000" className={`${inputCls} mt-1`} />
              </label>
            </div>
            <div className="flex justify-end">
              <button onClick={() => saveWage.mutate({ state: newState, wage: newWage })} disabled={saveWage.isPending || !newState || !newWage} className="px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">
                {saveWage.isPending ? 'Adding…' : 'Add'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
