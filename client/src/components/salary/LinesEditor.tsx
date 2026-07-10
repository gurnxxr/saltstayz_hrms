'use client';

import { useMemo } from 'react';
import { Plus, X } from 'lucide-react';

// Shared salary-structure line editor. Used by the per-designation/-employee template
// editor (Payroll → Salary Structures) and by the recruitment offer editor, so both
// edit component lines the same way. It renders lines only — the owner holds the state
// (base, city, etc.) and computes the breakdown server-side.

export interface LineDraft { component_id: string; calculation_type: string; value: string }

// Server line rows → editable drafts (string-valued for controlled inputs).
export const toLineDrafts = (lines: any[] = []): LineDraft[] =>
  lines.map((l) => ({ component_id: String(l.component_id), calculation_type: l.calculation_type, value: String(l.value ?? 0) }));

// Editable drafts → the API payload (numeric ids/values, blank lines dropped).
export const linesPayload = (lines: LineDraft[]) =>
  lines.filter((l) => l.component_id).map((l) => ({ component_id: Number(l.component_id), calculation_type: l.calculation_type, value: Number(l.value) || 0 }));

const CALC_TYPES = [
  { v: 'flat', label: 'Flat amount ₹' },
  { v: 'pct_of_base', label: '% of base' },
  { v: 'pct_of_basic', label: '% of Basic' },
  { v: 'remainder', label: 'Remainder (base − other earnings)' },
];

const CATEGORY_LABEL: Record<string, string> = {
  earning: 'Earning', deduction: 'Deduction', benefit: 'Benefit (employer)', reimbursement: 'Reimbursement',
};

const inputCls = 'w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';

export function LinesEditor({ components, lines, setLine, addLine, removeLine }: {
  components: any[]; lines: LineDraft[];
  setLine: (idx: number, patch: Partial<LineDraft>) => void; addLine: () => void; removeLine: (idx: number) => void;
}) {
  const componentById = useMemo(() => new Map(components.map((c: any) => [String(c.id), c])), [components]);
  return (
    <>
      <div className="flex items-center justify-between mt-5 mb-2">
        <p className="text-xs font-semibold text-secondary uppercase">Components</p>
        <button onClick={addLine}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors">
          <Plus size={14} /> Add component
        </button>
      </div>
      <div className="space-y-2">
        {lines.map((line, idx) => {
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
    </>
  );
}
