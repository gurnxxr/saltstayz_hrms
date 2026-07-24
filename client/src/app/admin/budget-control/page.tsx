'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import LoadError from '@/components/ui/LoadError';
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning';
import Breadcrumb from '@/components/ui/Breadcrumb';
import { formatINR } from '@/lib/utils';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { Wallet, Save, IndianRupee, Users, UserCheck, UserPlus, ChevronRight, ChevronDown, ArrowLeft, Search, AlertTriangle, Lock } from 'lucide-react';

// A blank/cleared field posts as 0. A 0 sanctioned budget or headcount silently
// blocks ALL hiring at that property (the guardrail sees no remaining budget/slots),
// so these submissions are confirmed before they save.
const isZeroish = (v: string | number | null | undefined) => v === '' || v == null || Number(v) <= 0;

const inputBase = 'px-3 py-1.5 border rounded-lg bg-background text-sm';
const invalidRing = 'border-red-400 bg-red-50';
const redChip = 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-semibold';
const amberChip = 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-semibold';

// Same grouping rules as formatINR, minus the symbol — the box it sits under already shows a ₹,
// and printing it twice in one cell reads as a mistake.
const grouped = (v: string | number) => formatINR(v).replace('₹', '');

/** A number box with a ₹ inside it, so a bare 313000 reads as money at a glance. */
function MoneyInput({ value, onChange, invalid, disabled, className = 'w-40', placeholder }: {
  value: string; onChange?: (v: string) => void; invalid?: boolean; disabled?: boolean;
  className?: string; placeholder?: string;
}) {
  return (
    <div className="relative inline-block">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-secondary text-sm">₹</span>
      <input
        type="number" min="0" value={value} placeholder={placeholder}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        readOnly={disabled} aria-invalid={invalid}
        className={`${inputBase} ${className} pl-6 ${invalid ? invalidRing : 'border-border'} ${disabled ? 'text-secondary cursor-not-allowed bg-muted/40' : ''}`}
      />
    </div>
  );
}


export default function BudgetControlPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [cluster, setCluster] = useState('');
  const [search, setSearch] = useState('');
  const [edits, setEdits] = useState<Record<number, { budget: string; head: string }>>({});
  // Which property's detail view is open (null = the list).
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [confirmRow, setConfirmRow] = useState<any | null>(null);

  // The detail view mounts the inner editors; leaving it (Back / a stale selection) unmounts them
  // and takes their unsaved typing with it. They report upward instead of holding that state
  // privately, so the page can ask before throwing it away.
  const [nestedDirty, setNestedDirty] = useState({ dept: false, bands: false });
  const nestedHasEdits = nestedDirty.dept || nestedDirty.bands;
  // Set true when Back is pressed with unsaved edits — shows the discard prompt.
  const [pendingLeave, setPendingLeave] = useState(false);

  const setDeptDirty = useCallback((v: boolean) => setNestedDirty(p => (p.dept === v ? p : { ...p, dept: v })), []);
  const setBandsDirty = useCallback((v: boolean) => setNestedDirty(p => (p.bands === v ? p : { ...p, bands: v })), []);

  const { data: rows = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['budget-control'],
    queryFn: () => api.get('/manpower/property-budgets').then(r => r.data),
  });
  // Committed spend/headcount for staff whose branch_name matches no property (renamed/typo'd)
  // — money that would otherwise vanish from every row.
  const { data: unassigned } = useQuery({
    queryKey: ['bc-unassigned'],
    queryFn: () => api.get('/manpower/property-budgets/unassigned').then(r => r.data).catch(() => null),
  });

  const save = useMutation({
    mutationFn: ({ id, budget, head }: any) => api.post(`/manpower/property-budgets/${id}`, { sanctioned_budget_monthly: Number(budget), sanctioned_headcount: Number(head) }),
    onSuccess: (_d, v: any) => { toast.success('Budget saved'); setConfirmRow(null); setEdits(e => { const n = { ...e }; delete n[v.id]; return n; }); qc.invalidateQueries({ queryKey: ['budget-control'] }); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save'),
  });

  const selected = selectedId != null ? rows.find((r: any) => r.property_id === selectedId) : null;
  const budgetDirty = selectedId != null && !!edits[selectedId];
  const detailDirty = budgetDirty || nestedHasEdits;
  const [convertRow, setConvertRow] = useState<any | null>(null);

  // If the open property drops out of a refetch (deleted, or the viewer's scope narrowed), don't
  // strand the detail view (which would bypass the discard guard and orphan the edit + leave the
  // unsaved-changes warning latched). Clean up its edit and fall back to the list.
  useEffect(() => {
    // No rows.length guard: an empty list (scope narrowed to zero) must still clear the orphaned edit.
    if (selectedId != null && !isLoading && !rows.find((r: any) => r.property_id === selectedId)) {
      setEdits(e => { const n = { ...e }; delete n[selectedId]; return n; });
      setNestedDirty({ dept: false, bands: false });
      setSelectedId(null);
      setPendingLeave(false);
    }
  }, [selectedId, rows, isLoading]);

  // Leaving the detail view discards its unsaved typing (the editors unmount) — ask first.
  const leaveToList = () => { setSelectedId(null); setNestedDirty({ dept: false, bands: false }); };
  const requestLeave = () => { if (detailDirty) setPendingLeave(true); else leaveToList(); };
  const confirmLeave = () => {
    if (selectedId != null) setEdits(e => { const n = { ...e }; delete n[selectedId]; return n; });
    setNestedDirty({ dept: false, bands: false });
    setSelectedId(null);
    setPendingLeave(false);
  };

  // One guard for the whole page. The inner editors used to each register their own, which meant
  // three listeners covering only the part of the screen that happened to be mounted.
  useUnsavedChangesWarning(Object.keys(edits).length > 0 || nestedHasEdits);

  const clusterNames = useMemo(() => Array.from(new Set(rows.map((r: any) => r.cluster_name).filter(Boolean))).sort(), [rows]);
  const term = search.trim().toLowerCase();
  const filtered = rows.filter((r: any) =>
    (!cluster || r.cluster_name === cluster) && (!term || String(r.property_name).toLowerCase().includes(term)));
  const overLimitCount = filtered.filter((r: any) => r.over_worker_limit).length;
  const overBudgetCount = filtered.filter((r: any) => r.over_budget).length;

  // Totals for the summary strip — over the (filtered) list, from saved values (editing lives in
  // the detail view, so the list itself never carries unsaved figures).
  const totals = filtered.reduce((a: any, r: any) => {
    const budget = Number(r.sanctioned_budget_monthly) || 0;
    const committed = Number(r.committed_amount) || 0;
    const reserved = Number(r.reserved_budget) || 0;
    const head = Number(r.sanctioned_headcount) || 0;
    const filled = Number(r.filled_headcount) || 0;
    const reservedSlots = Number(r.reserved_slots) || 0;
    a.budget += budget;
    a.head += head;
    a.filled += filled;
    a.committed += committed;
    a.reserved += reserved;
    a.reservedSlots += reservedSlots;
    // Free budget and open slots are NOT fungible across properties — one property's surplus can't
    // fill another's overage — so sum each property's own clamped free amount, don't clamp the total.
    a.freeBudget += Math.max(0, budget - committed - reserved);
    a.openSlots += Math.max(0, head - filled - reservedSlots);
    return a;
  }, { budget: 0, head: 0, filled: 0, committed: 0, reserved: 0, reservedSlots: 0, freeBudget: 0, openSlots: 0 });

  // ── Detail editing helpers (operate on the one selected property) ──
  const val = (r: any, field: 'budget' | 'head') => {
    const e = edits[r.property_id];
    if (e) return e[field];
    return String(field === 'budget' ? r.sanctioned_budget_monthly : r.sanctioned_headcount);
  };
  const rowInvalid = (r: any) => isZeroish(val(r, 'budget')) || isZeroish(val(r, 'head'));
  const zeroFields = (r: any) => {
    const b = isZeroish(val(r, 'budget')), h = isZeroish(val(r, 'head'));
    return b && h ? 'budget and headcount' : b ? 'budget' : 'headcount';
  };
  const submit = (r: any) => save.mutate({ id: r.property_id, budget: val(r, 'budget'), head: val(r, 'head') });
  const setVal = (r: any, field: 'budget' | 'head', v: string) => {
    setEdits(prev => ({
      ...prev,
      [r.property_id]: {
        budget: field === 'budget' ? v : (prev[r.property_id]?.budget ?? String(r.sanctioned_budget_monthly)),
        head: field === 'head' ? v : (prev[r.property_id]?.head ?? String(r.sanctioned_headcount)),
      },
    }));
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <Breadcrumb items={[{ label: 'Admin', href: '/admin' }, { label: 'Budget Control' }]} />
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><Wallet className="text-primary" size={20} /></div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Budget Control</h1>
            <p className="text-secondary text-sm">Set the sanctioned monthly budget (CTC) and headcount per property. These cap hiring across all roles.</p>
          </div>
        </div>

        {selected ? (
          // ─────────────────────────── DETAIL: one property ───────────────────────────
          (() => {
            const r = selected;
            const effBudget = Number(val(r, 'budget')) || 0;
            const effHead = Number(val(r, 'head')) || 0;
            const committed = Number(r.committed_amount) || 0;
            const filled = Number(r.filled_headcount) || 0;
            const missing = Number(r.missing_salary_count) || 0;
            const pipSlots = Number(r.pip_backfill_slots) || 0;
            const pipBudget = Number(r.pip_backfill_budget) || 0;
            // Reserved = pending offers not yet on the payroll. Free = what a new hire can actually
            // draw on = sanctioned − committed − reserved (the number every hiring gate enforces).
            const reserved = Number(r.reserved_budget) || 0;
            const reservedSlots = Number(r.reserved_slots) || 0;
            const free = effBudget - committed - reserved;
            const openSlots = Math.max(0, effHead - filled - reservedSlots);
            const overBudget = committed > effBudget;
            const overHead = filled > effHead;
            // Compare the per-department worker total against the LIVE (edited) headcount, not the
            // server flag — that flag reflects the last SAVED headcount, so while you're editing the
            // number to fix a mismatch it would still show, printing two equal values ("20 ≠ 20").
            const totalWorkers = Number(r.total_sanctioned_workers) || 0;
            const workersMismatch = totalWorkers > 0 && totalWorkers !== effHead;
            const dirty = !!edits[r.property_id];
            const saveNow = () => { if (rowInvalid(r)) setConfirmRow(r); else if (r.source === 'rolled_up') setConvertRow(r); else submit(r); };
            return (
              <div className="space-y-4">
                <button onClick={requestLeave} className="inline-flex items-center gap-1.5 text-sm text-secondary hover:text-foreground">
                  <ArrowLeft size={15} /> All properties
                </button>

                <div>
                  <h2 className="text-xl font-bold text-foreground inline-flex items-center gap-2 flex-wrap">
                    {r.property_name}
                    {overBudget && <span className={redChip}><AlertTriangle size={10} /> Over budget</span>}
                    {overHead && <span className={redChip}><AlertTriangle size={10} /> Over headcount</span>}
                    {missing > 0 && <span className={amberChip} title="Bodies holding a slot with no salary keyed yet"><AlertTriangle size={10} /> {missing} missing salary</span>}
                  </h2>
                  <p className="text-xs text-secondary mt-0.5">{r.cluster_name || 'Unassigned'} · {r.source === 'explicit' ? 'explicit budget' : 'rolled-up from roles'}</p>
                </div>

                {/* Read-only figures — recompute live as the caps below change. Annual = ×12. */}
                <div className="bg-card rounded-xl border border-border p-4 space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Figure label="Sanctioned budget" value={formatINR(effBudget)} sub={`${formatINR(effBudget * 12)}/yr`} />
                    <Figure label="Committed" value={formatINR(committed)} danger={overBudget}
                      sub={missing > 0 ? <span className="text-amber-600 font-medium">{missing} unpriced</span> : 'current staff'} />
                    <Figure label="Reserved" value={formatINR(reserved)}
                      sub={reserved > 0 ? 'pending offers' : 'none pending'} />
                    <Figure label="Free" value={formatINR(free)} danger={free < 0}
                      sub={pipBudget > 0 ? <span className="text-blue-600">+{formatINR(pipBudget)} PIP backfill</span> : 'sanctioned − committed − reserved'} />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border-t border-border pt-3">
                    <Figure label="Headcount" value={String(effHead)} />
                    <Figure label="Filled" value={String(filled)} danger={overHead}
                      sub={missing > 0 ? <span className="text-amber-600">{missing} without salary</span> : 'current staff'} />
                    <Figure label="Reserved slots" value={String(reservedSlots)}
                      sub={reservedSlots > 0 ? 'pending offers' : 'none pending'} />
                    <Figure label="Open slots" value={String(openSlots)}
                      sub={pipSlots > 0 ? <span className="text-blue-600">+{pipSlots} PIP backfill</span> : 'ready to hire'} />
                  </div>
                </div>

                {/* Honesty / reconciliation warnings (display-only) */}
                {(missing > 0 || r.explicit_overrides_roles || workersMismatch) && (
                  <div className="space-y-2">
                    {missing > 0 && (
                      <SoftWarn>
                        <b>{missing}</b> of {filled} staff have no salary keyed — they hold a sanctioned slot, but their cost isn&apos;t in Committed yet, so Remaining Budget is higher than the true spend. Key their salaries in Payroll → Salary Setup.
                      </SoftWarn>
                    )}
                    {r.explicit_overrides_roles && (
                      <SoftWarn>
                        This property uses an <b>explicit</b> budget/headcount that overrides the role roll-up (roles sum to {formatINR(Number(r.rolled_budget) || 0)} / {r.rolled_headcount} heads). Adding or removing roles won&apos;t change this cap until the override is cleared.
                      </SoftWarn>
                    )}
                    {workersMismatch && (
                      <SoftWarn>
                        Per-department sanctioned workers (<b>{totalWorkers}</b>) don&apos;t match the sanctioned headcount (<b>{effHead}</b>). Reconcile the department counts below or the headcount above.
                      </SoftWarn>
                    )}
                  </div>
                )}

                {/* Primary caps that gate hiring */}
                <div className="bg-card rounded-xl border border-border p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground">Sanctioned caps</h3>
                    {dirty && (rowInvalid(r)
                      ? <span className="text-[11px] font-medium text-red-600" title="Blank counts as ₹0 and will block hiring">Blank = 0, blocks hiring</span>
                      : <span className="text-[11px] font-medium text-amber-600">Unsaved</span>)}
                  </div>
                  <div className="flex flex-wrap items-end gap-4">
                    <label className="block">
                      <span className="block text-xs text-secondary mb-1">Sanctioned budget (monthly CTC)</span>
                      <MoneyInput value={val(r, 'budget')} onChange={v => setVal(r, 'budget', v)} invalid={dirty && isZeroish(val(r, 'budget'))} />
                      <div className={`mt-1 text-[11px] tabular-nums ${isZeroish(val(r, 'budget')) ? 'text-red-600 font-medium' : 'text-secondary'}`}>
                        {isZeroish(val(r, 'budget')) ? 'blocks all hiring' : `${grouped(val(r, 'budget'))} per month`}
                      </div>
                    </label>
                    <label className="block">
                      <span className="block text-xs text-secondary mb-1">Sanctioned headcount</span>
                      <input type="number" min="0" value={val(r, 'head')} onChange={e => setVal(r, 'head', e.target.value)}
                        aria-invalid={dirty && isZeroish(val(r, 'head'))}
                        className={`w-28 ${inputBase} ${dirty && isZeroish(val(r, 'head')) ? invalidRing : 'border-border'}`} />
                      <div className="mt-1 text-[11px] text-secondary">cumulative across all roles</div>
                    </label>
                    <button
                      onClick={saveNow}
                      disabled={!dirty || save.isPending}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-40"
                    >
                      <Save size={13} /> {save.isPending ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>

                {/* Who makes up Committed (drill-in) */}
                <CommittedBreakdown propertyId={r.property_id} committed={committed} filled={filled} missing={missing} />

                {/* Departments + salary bands — side by side on wide screens, stacked on narrow */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <div className="bg-card rounded-xl border border-border p-4"><PropertyDeptCounts propertyId={r.property_id} onDirtyChange={setDeptDirty} /></div>
                  <div className="bg-card rounded-xl border border-border p-4"><PropertyBands propertyId={r.property_id} onDirtyChange={setBandsDirty} /></div>
                </div>
              </div>
            );
          })()
        ) : (
          // ─────────────────────────── LIST: all properties ───────────────────────────
          <>
            {/* Summary strip */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <Metric icon={<IndianRupee size={16} />} label="Total Sanctioned Amount" value={formatINR(totals.budget)} sub={`monthly CTC · ${filtered.length} ${filtered.length === 1 ? 'property' : 'properties'}`} />
              <Metric icon={<Users size={16} />} label="Total Sanctioned Headcount" value={String(totals.head)} sub="cumulative across all roles" />
              <Metric icon={<UserCheck size={16} />} label="Positions Filled" value={String(totals.filled)}
                sub={totals.head > 0 ? `${Math.round((totals.filled / totals.head) * 100)}% of sanctioned` : 'no headcount sanctioned'} />
              <Metric icon={<UserPlus size={16} />} label="Open Slots" value={String(totals.openSlots)}
                sub={totals.reservedSlots > 0 ? `${totals.reservedSlots} reserved by pending offers` : 'summed per property'} />
              <Metric icon={<Wallet size={16} />} label="Free Budget" value={formatINR(totals.freeBudget)}
                danger={overBudgetCount > 0}
                sub={`${formatINR(totals.committed)} committed${totals.reserved > 0 ? ` · ${formatINR(totals.reserved)} reserved` : ''}`}
                fill={totals.budget > 0 ? (totals.committed + totals.reserved) / totals.budget : 0} />
            </div>

            {overBudgetCount > 0 && (
              <div className="w-full flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-800">
                <AlertTriangle size={16} className="text-red-600 shrink-0" />
                <span><b>{overBudgetCount}</b> {overBudgetCount === 1 ? 'property has' : 'properties have'} committed more than the sanctioned budget — open a property to review.</span>
              </div>
            )}
            {overLimitCount > 0 && (
              <button
                onClick={() => router.push('/admin/property-config')}
                className="w-full flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-800 hover:bg-red-100 transition-colors text-left"
              >
                <AlertTriangle size={16} className="text-red-600 shrink-0" />
                <span><b>{overLimitCount}</b> {overLimitCount === 1 ? 'property has' : 'properties have'} more workers hired than sanctioned — open Property Configuration to review.</span>
              </button>
            )}
            {unassigned && unassigned.count > 0 && (
              <div className="w-full flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 text-sm text-amber-800">
                <AlertTriangle size={16} className="text-amber-600 shrink-0" />
                <span><b>{unassigned.count}</b> staff ({formatINR(unassigned.committed)}/mo committed) aren&apos;t matched to any property — a blank or mistyped branch name — so they&apos;re missing from every row below. Fix their branch on the employee record.</span>
              </div>
            )}

            {/* Search + cluster filter */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search property…"
                  className="w-full pl-9 pr-3 py-2 border border-border rounded-lg bg-background text-sm" />
              </div>
              <select value={cluster} onChange={e => setCluster(e.target.value)} className="px-3 py-2 border border-border rounded-lg bg-background text-sm">
                <option value="">All clusters</option>
                {clusterNames.map((c: any) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            {/* One compact, read-only row per property; click anywhere to open it */}
            <div className="bg-card rounded-xl border border-border overflow-hidden divide-y divide-border">
              {isLoading ? (
                <div className="px-4 py-8 text-center text-secondary text-sm">Loading…</div>
              ) : isError ? (
                <LoadError compact message="Couldn't load budgets." onRetry={() => refetch()} />
              ) : filtered.length === 0 ? (
                <div className="px-4 py-8 text-center text-secondary text-sm">{term || cluster ? 'No properties match.' : 'No properties.'}</div>
              ) : filtered.map((r: any) => {
                const budget = Number(r.sanctioned_budget_monthly) || 0;
                const committed = Number(r.committed_amount) || 0;
                const head = Number(r.sanctioned_headcount) || 0;
                const filled = Number(r.filled_headcount) || 0;
                const reservedSlots = Number(r.reserved_slots) || 0;
                const openSlots = Math.max(0, head - filled - reservedSlots);
                return (
                  <button key={r.property_id} onClick={() => setSelectedId(r.property_id)}
                    className="w-full text-left px-4 py-3 hover:bg-muted/30 transition-colors flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-foreground truncate inline-flex items-center gap-1.5">
                        {r.property_name}
                        {r.over_worker_limit && (
                          <span className={redChip} title={`${r.worker_count} hired vs ${r.total_sanctioned_workers} sanctioned`}>
                            <AlertTriangle size={10} /> {r.worker_count}/{r.total_sanctioned_workers}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-secondary truncate">{r.cluster_name || 'Unassigned'} · {r.source === 'explicit' ? 'explicit' : 'rolled-up from roles'}</div>
                    </div>
                    <div className="hidden sm:block w-48 shrink-0">
                      <div className={`text-xs tabular-nums ${r.over_budget ? 'text-red-600 font-medium' : 'text-secondary'}`}>
                        {formatINR(committed)} <span className="text-secondary">/ {formatINR(budget)}</span>
                      </div>
                      <UsageBar used={committed} total={budget} className="mt-1" />
                    </div>
                    <div className="w-24 shrink-0 text-right text-xs">
                      <div>
                        <span className={r.over_headcount ? 'text-red-600 font-medium' : 'text-foreground'}>{filled}</span>
                        <span className="text-secondary"> / {head}</span>
                      </div>
                      <div className="text-[11px] text-secondary">{openSlots} open{reservedSlots > 0 ? ` · ${reservedSlots} reserved` : ''}</div>
                      {r.missing_salary_count > 0 && <div className="text-[10px] text-amber-600">{r.missing_salary_count} no salary</div>}
                    </div>
                    <ChevronRight size={16} className="text-secondary shrink-0" />
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-secondary">Headcount is cumulative across all roles at the property. Open a property to set its per-role maximum salary and per-department counts.</p>
          </>
        )}
      </div>

      <ConfirmDialog
        open={!!confirmRow}
        danger
        title="Save a zero sanctioned value?"
        confirmLabel="Save anyway"
        cancelLabel="Go back"
        loading={save.isPending}
        message={confirmRow && (
          <>Setting <b>{confirmRow.property_name}</b>&apos;s sanctioned {zeroFields(confirmRow)} to <b>0</b> will block all new hiring at this property until it&apos;s raised. Save anyway?</>
        )}
        onCancel={() => setConfirmRow(null)}
        onConfirm={() => {
          if (!confirmRow) return;
          // A rolled-up property still needs the convert-to-explicit warning after the zero one.
          if (confirmRow.source === 'rolled_up') { setConvertRow(confirmRow); setConfirmRow(null); }
          else submit(confirmRow);
        }}
      />

      {/* Leaving the property view throws away whatever is typed inside it. Ask rather than lose it. */}
      <ConfirmDialog
        open={pendingLeave}
        danger
        title="Discard unsaved changes?"
        confirmLabel="Discard them"
        cancelLabel="Keep editing"
        message={<>The budget, department, or salary-band changes you made here haven&apos;t been saved. Leaving this property will discard them.</>}
        onCancel={() => setPendingLeave(false)}
        onConfirm={confirmLeave}
      />

      {/* Saving a rolled-up property freezes it into an explicit override — it stops tracking role changes. */}
      <ConfirmDialog
        open={!!convertRow}
        title="Switch to an explicit budget?"
        confirmLabel="Save as explicit"
        cancelLabel="Cancel"
        loading={save.isPending}
        message={convertRow && (
          <><b>{convertRow.property_name}</b> currently rolls its sanctioned budget/headcount up from its per-role sanctions. Saving here converts it to an <b>explicit</b> override — after this, adding or removing roles will no longer change its cap until the override is cleared. Continue?</>
        )}
        onCancel={() => setConvertRow(null)}
        onConfirm={() => { if (convertRow) { submit(convertRow); setConvertRow(null); } }}
      />
    </AppShell>
  );
}

// Per-department sanctioned employee count — the same figure editable in Property Configuration.
function PropertyDeptCounts({ propertyId, onDirtyChange }: { propertyId: number; onDirtyChange: (d: boolean) => void }) {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['bc-console', propertyId],
    queryFn: () => api.get(`/manpower/property-console?property_id=${propertyId}`).then(r => r.data),
  });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: ({ department, worker_count }: any) => api.put('/manpower/property-console/department-workers', { property_id: propertyId, department, worker_count: Number(worker_count) }),
    onSuccess: (_d, v: any) => { toast.success('Employees per department saved'); setEdits(e => { const n = { ...e }; delete n[v.department]; return n; }); qc.invalidateQueries({ queryKey: ['bc-console', propertyId] }); qc.invalidateQueries({ queryKey: ['budget-control'] }); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save'),
  });

  // Reported upward instead of guarded here: this component is unmounted the moment another
  // property is opened, so a guard living inside it can never fire for that case.
  const deptDirty = Object.keys(edits).length > 0;
  useEffect(() => { onDirtyChange(deptDirty); }, [deptDirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  if (isError) return <LoadError compact message="Couldn't load departments." onRetry={() => refetch()} />;
  if (isLoading || !data) return <p className="text-xs text-secondary">Loading departments…</p>;
  const depts: any[] = data.byDepartment || [];

  return (
    <div className="space-y-2">
      <p className="text-[11px] uppercase tracking-wide text-secondary">
        No. of employees by department (sanctioned)
        {deptDirty && <span className="ml-2 normal-case tracking-normal font-medium text-amber-600">· Unsaved changes</span>}
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-secondary">
            <th className="py-1 pr-3 font-medium">Department</th>
            <th className="py-1 pr-3 font-medium">Currently hired</th>
            <th className="py-1 pr-2 font-medium">Sanctioned</th>
            <th />
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {depts.length === 0 && <tr><td colSpan={4} className="py-2 text-secondary text-xs">No departments.</td></tr>}
          {depts.map((d) => {
            const edited = edits[d.dept_name];
            const val = edited != null ? edited : String(d.sanctioned_workers ?? 0);
            return (
              <tr key={d.dept_name}>
                <td className="py-2 pr-3 font-medium text-foreground">{d.dept_name}</td>
                <td className="py-2 pr-3 text-secondary text-xs">{d.actual_workers} hired</td>
                <td className="py-2 pr-2">
                  <input type="number" min="0" value={val} onChange={ev => setEdits(p => ({ ...p, [d.dept_name]: ev.target.value }))}
                    className="w-24 px-2 py-1 border border-border rounded-lg bg-background text-sm" />
                </td>
                <td className="py-2 text-right">
                  <button disabled={edited == null || save.isPending}
                    onClick={() => save.mutate({ department: d.dept_name, worker_count: val })}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-primary text-white rounded-lg text-xs font-medium disabled:opacity-40"><Save size={12} /> Save</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Per-property role salary CAP editor. One approved MAXIMUM per role — no band minimum (the only
// floor is the statutory minimum wage, enforced on the offer path). band_min is written as 0.
function PropertyBands({ propertyId, onDirtyChange }: { propertyId: number; onDirtyChange: (d: boolean) => void }) {
  const qc = useQueryClient();
  const { data: roles = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['bc-sanctions', propertyId],
    queryFn: () => api.get(`/manpower/sanctions?property_id=${propertyId}`).then(r => r.data),
  });
  const { data: jobTitles = [] } = useQuery({
    queryKey: ['bc-jobtitles'], queryFn: () => api.get('/recruitment/job-titles').then(r => r.data).catch(() => []),
  });
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [add, setAdd] = useState({ job_title_id: '', max: '' });

  const saveBand = useMutation({
    mutationFn: (b: any) => api.put('/manpower/sanctions/band', b),
    onSuccess: () => {
      toast.success('Maximum salary saved');
      qc.invalidateQueries({ queryKey: ['bc-sanctions', propertyId] });
      qc.invalidateQueries({ queryKey: ['budget-control'] });
      setEdits({}); setAdd({ job_title_id: '', max: '' });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const bandedIds = new Set(roles.map((r: any) => r.job_title_id));
  const addable = jobTitles.filter((j: any) => !bandedIds.has(j.id));
  // Reported upward, not guarded here — see the note in PropertyDeptCounts.
  const bandsDirty = Object.keys(edits).length > 0 || !!add.job_title_id || !!add.max;
  useEffect(() => { onDirtyChange(bandsDirty); }, [bandsDirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  if (isError) return <LoadError compact message="Couldn't load salary caps." onRetry={() => refetch()} />;
  if (isLoading) return <p className="text-xs text-secondary">Loading salary caps…</p>;

  return (
    <div className="space-y-2">
      <p className="text-[11px] uppercase tracking-wide text-secondary">
        Maximum salary (monthly CTC) by role
        {bandsDirty && <span className="ml-2 normal-case tracking-normal font-medium text-amber-600">· Unsaved changes</span>}
      </p>
      <p className="text-[11px] text-secondary -mt-1">No offer at this property may exceed the role&apos;s maximum. There is no minimum — the statutory minimum wage is the only floor.</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-secondary">
            <th className="py-1 pr-3 font-medium">Role</th>
            <th className="py-1 pr-2 font-medium">Maximum salary</th>
            <th />
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {roles.length === 0 && <tr><td colSpan={3} className="py-2 text-secondary text-xs">No role caps yet — add one below.</td></tr>}
          {roles.map((r: any) => {
            const max = edits[r.id] != null ? edits[r.id] : String(r.band_max);
            const invalid = max !== '' && Number(max) <= 0;
            // A locked cap is refused by the server. Showing it as editable meant the only way
            // to discover that was to type a number and have the save fail.
            const locked = !!r.is_locked;
            return (
              <tr key={r.id}>
                <td className="py-2 pr-3 font-medium text-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    {r.job_title}
                    {locked && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-muted text-secondary text-[10px] font-semibold" title="This cap is locked. Unlock it before editing.">
                        <Lock size={10} /> locked
                      </span>
                    )}
                  </span>
                </td>
                <td className="py-2 pr-2">
                  <MoneyInput className="w-32" value={max} disabled={locked} invalid={invalid} placeholder="max"
                    onChange={v => setEdits(p => ({ ...p, [r.id]: v }))} />
                  {invalid && <p className="mt-0.5 text-[11px] font-medium text-red-600">Enter a maximum above 0</p>}
                </td>
                <td className="py-2 text-right align-top">
                  {!locked && (
                    <button disabled={edits[r.id] == null || invalid || saveBand.isPending}
                      onClick={() => saveBand.mutate({ property_id: propertyId, job_title_id: r.job_title_id, band_min: 0, band_max: Number(max) })}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-primary text-white rounded-lg text-xs font-medium disabled:opacity-40">
                      <Save size={12} /> {saveBand.isPending ? 'Saving…' : 'Save'}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {addable.length > 0 && (
        <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-border/60">
          <label className="block"><span className="block text-xs text-secondary mb-1">Add role cap</span>
            <select value={add.job_title_id} onChange={e => setAdd(a => ({ ...a, job_title_id: e.target.value }))} className="px-2 py-1 border border-border rounded-lg bg-background text-sm">
              <option value="">Select role</option>
              {addable.map((j: any) => <option key={j.id} value={j.id}>{j.title}</option>)}
            </select>
          </label>
          <div>
            <span className="block text-xs text-secondary mb-1">Maximum salary</span>
            <MoneyInput className="w-32" value={add.max} placeholder="max" onChange={v => setAdd(a => ({ ...a, max: v }))} />
          </div>
          <button disabled={!add.job_title_id || !add.max || Number(add.max) <= 0 || saveBand.isPending}
            onClick={() => saveBand.mutate({ property_id: propertyId, job_title_id: Number(add.job_title_id), band_min: 0, band_max: Number(add.max) })}
            className="px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium disabled:opacity-40">Add cap</button>
        </div>
      )}
    </div>
  );
}

/** A thin committed-vs-sanctioned bar for a list row: red when over, amber near the cap. */
function UsageBar({ used, total, className = '' }: { used: number; total: number; className?: string }) {
  const over = used > total;
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : (used > 0 ? 100 : 0);
  return (
    <div className={`h-1.5 w-full rounded-full bg-muted overflow-hidden ${className}`} role="img" aria-label={`${pct}% of budget committed`}>
      <div className={`h-full rounded-full ${over ? 'bg-red-500' : pct >= 90 ? 'bg-amber-500' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** A compact read-only stat for the detail figures row. */
function Figure({ label, value, sub, danger }: { label: string; value: string; sub?: React.ReactNode; danger?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-secondary">{label}</div>
      <div className={`text-lg font-bold ${danger ? 'text-red-600' : 'text-foreground'}`}>{value}</div>
      {sub && <div className="text-[11px] text-secondary mt-0.5">{sub}</div>}
    </div>
  );
}

/** A soft (non-blocking) advisory banner for the detail view. */
function SoftWarn({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
      <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  );
}

/** Drill-in: the employees that make up a property's Committed figure (lazy-loaded on expand). */
function CommittedBreakdown({ propertyId, committed, filled, missing }: { propertyId: number; committed: number; filled: number; missing: number }) {
  const [open, setOpen] = useState(false);
  const { data: staff = [], isLoading } = useQuery({
    queryKey: ['bc-committed', propertyId],
    queryFn: () => api.get(`/manpower/property-budgets/${propertyId}/committed`).then(r => r.data),
    enabled: open,
  });
  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/30 transition-colors">
        <span className="text-sm font-semibold text-foreground inline-flex items-center gap-1.5">
          {open ? <ChevronDown size={15} className="text-secondary" /> : <ChevronRight size={15} className="text-secondary" />}
          Who makes up Committed
        </span>
        <span className="text-xs text-secondary">{formatINR(committed)}/mo · {filled} staff{missing > 0 ? ` · ${missing} without salary` : ''}</span>
      </button>
      {open && (
        <div className="border-t border-border overflow-x-auto">
          {isLoading ? (
            <div className="px-4 py-4 text-center text-secondary text-sm">Loading…</div>
          ) : staff.length === 0 ? (
            <div className="px-4 py-4 text-center text-secondary text-sm">No staff at this property.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-secondary text-[11px] uppercase tracking-wide">
                <tr className="text-left">
                  <th className="px-4 py-2 font-medium">Employee</th>
                  <th className="px-4 py-2 font-medium">Role</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium text-right">Monthly CTC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {staff.map((s: any) => (
                  <tr key={s.id} className="hover:bg-muted/20">
                    <td className="px-4 py-2 font-medium text-foreground">{s.first_name} {s.last_name}<span className="block text-[11px] text-secondary">{s.employee_code}</span></td>
                    <td className="px-4 py-2 text-secondary">{s.designation || '—'}</td>
                    <td className="px-4 py-2 text-secondary">{s.employment_status || '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {s.monthly_ctc == null
                        ? <span className="text-amber-600 font-medium">no salary</span>
                        : formatINR(s.monthly_ctc)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ icon, label, value, sub, danger, fill }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; danger?: boolean;
  /** 0–1 share of the budget already committed; draws a bar so "how close are we" is visible. */
  fill?: number;
}) {
  const pct = fill == null ? null : Math.min(100, Math.max(0, Math.round(fill * 100)));
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center gap-1.5 text-secondary text-[11px] uppercase tracking-wide">{icon}<span className="truncate">{label}</span></div>
      <p className={`text-2xl font-bold mt-1.5 ${danger ? 'text-red-600' : 'text-foreground'}`}>{value}</p>
      {pct != null && (
        <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden" role="img" aria-label={`${pct}% of budget committed`}>
          <div className={`h-full rounded-full ${danger ? 'bg-red-500' : pct >= 90 ? 'bg-amber-500' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
        </div>
      )}
      {sub && <p className="text-xs text-secondary mt-0.5">{sub}</p>}
    </div>
  );
}
