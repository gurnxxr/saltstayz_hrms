'use client';

import { Calendar, Download, IndianRupee } from 'lucide-react';
import { formatINR } from '@/lib/utils';
import { statutoryLines } from '@/lib/payslip';

// Full payslip preview card (banner + days + earnings/deductions + net + CTC).
// Shared by the employee's own "View Payslip" (Salary page) and Admin's
// individual salary-slip generation.
export default function PayslipPreview({ result, downloadHref, download }: {
  result: any; downloadHref: string; download: (url: string, label: string) => void;
}) {
  const b = result.breakdown;
  const pdfLabel = `${String(result.employee?.name || 'Payslip').replace(/\s+/g, '_')}_${String(result.monthLabel || '').replace(/\s+/g, '_')}`;
  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      {/* Banner */}
      <div className="bg-primary px-6 py-5 flex items-center justify-between">
        <div>
          <p className="text-white font-semibold text-lg">{result.employee.name}</p>
          <p className="text-blue-200 text-xs mt-0.5">
            {result.employee.employee_code} · {result.employee.designation}
          </p>
        </div>
        <div className="text-right">
          <p className="text-blue-200 text-xs flex items-center gap-1 justify-end">
            <Calendar size={12} /> {result.monthLabel}
          </p>
          <button
            onClick={() => download(downloadHref, pdfLabel)}
            className="mt-2 flex items-center gap-2 px-3 py-1.5 bg-white text-primary rounded-lg text-xs font-semibold hover:bg-blue-50 transition-colors ml-auto"
          >
            <Download size={13} /> Download PDF
          </button>
        </div>
      </div>

      {/* Attendance-driven days strip */}
      {b.days && (
        <div className="px-6 py-3 bg-muted/40 border-b border-border flex flex-wrap gap-x-6 gap-y-1 text-xs">
          {/* working_days IS the salary divisor, and under calendar_days that is the whole month —
              calling 31 "working days" would be plainly wrong on a payslip. */}
          <span className="text-secondary">
            {b.days.method === 'calendar_days' ? 'Days in month' : 'Working days'}{' '}
            <span className="font-semibold text-foreground">{b.days.working_days}</span>
          </span>
          <span className="text-secondary">Loss of pay <span className={`font-semibold ${b.days.lop_days > 0 ? 'text-red-600' : 'text-foreground'}`}>{b.days.lop_days}</span></span>
          {b.days.hours != null
            ? <span className="text-secondary">Hours paid <span className="font-semibold text-foreground">{b.days.hours}</span></span>
            : <span className="text-secondary">Days paid <span className="font-semibold text-foreground">{b.days.payment_days}</span></span>}
        </div>
      )}

      {/* Earnings + Deductions — component lines from the salary structure */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border">
        <Section title="Earnings" rows={(b.earnings ?? []).map((l: any) => [l.name, l.amount] as [string, number])}
          total={['Gross Earnings', b.gross_earnings]} />
        {/* The statutory heads come from lib/payslip so this card and "My Salary Structure" on the
            Salary page — which sits one scroll above it — cannot name or order them differently
            again. Zeroes are kept HERE: a payslip is a record of what was deducted, and naming each
            statutory head even at nil is part of what makes it one. */}
        <Section title="Deductions" rows={[
          ...statutoryLines(b, { includeZero: true }),
          ...(b.other_deductions ?? []).map((l: any) => [l.name, l.amount] as [string, number]),
        ]} total={['Total Deduction', b.total_deduction]} />
      </div>

      {/* Net pay */}
      <div className="bg-green-50 px-6 py-4 flex items-center justify-between border-t border-border">
        <div>
          <p className="text-sm font-semibold text-green-800 flex items-center gap-1.5">
            <IndianRupee size={15} /> Net Pay
          </p>
          <p className="text-xs text-green-700/70 mt-0.5">Gross Earnings − Total Deduction</p>
        </div>
        <p className="text-2xl font-bold text-green-700">{formatINR(b.net_pay)}</p>
      </div>

      {/* CTC breakdown */}
      <div className="px-6 py-5 border-t border-border">
        <p className="text-sm font-semibold text-foreground mb-3">Cost to Company (CTC)</p>
        <div className="space-y-1.5 text-sm">
          <CtcLine label="Gross Earnings" value={b.gross_earnings} bold />
          <CtcLine label="Employer Statutory Contributions" value={b.employer_pf + b.employer_esi + b.employer_lwf} bold />
          <CtcLine label="Employer PF" value={b.employer_pf} indent />
          <CtcLine label="Employer ESI / Medical Benefit" value={b.employer_esi} indent />
          <CtcLine label="Employer LWF" value={b.employer_lwf} indent />
          {(b.employer_costs ?? []).length > 0 && (
            <CtcLine label="Employer Benefits" value={b.employer_costs_total} bold />
          )}
          {(b.employer_costs ?? []).map((l: any) => (
            <CtcLine key={l.name} label={l.name} value={l.amount} indent />
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
          <p className="text-sm font-bold text-primary">Total CTC</p>
          <p className="text-lg font-bold text-primary">{formatINR(b.ctc)}</p>
        </div>
      </div>
    </div>
  );
}

function Section({ title, rows, total }: {
  title: string; rows: [string, number][]; total: [string, number];
}) {
  return (
    <div className="bg-card">
      <div className="px-6 py-2.5 bg-muted/40 border-b border-border">
        <p className="text-xs font-semibold text-secondary uppercase">{title}</p>
      </div>
      <div className="px-6 py-3 space-y-2">
        {rows.map(([label, val]) => (
          <div key={label} className="flex items-center justify-between text-sm">
            <span className="text-secondary">{label}</span>
            <span className="text-foreground font-medium">{formatINR(val)}</span>
          </div>
        ))}
      </div>
      <div className="px-6 py-2.5 bg-muted/30 border-t border-border flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">{total[0]}</span>
        <span className="text-sm font-bold text-foreground">{formatINR(total[1])}</span>
      </div>
    </div>
  );
}

function CtcLine({ label, value, indent, bold }: {
  label: string; value: number; indent?: boolean; bold?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between ${indent ? 'pl-4' : ''}`}>
      <span className={bold ? 'font-medium text-foreground' : 'text-secondary'}>{label}</span>
      <span className={bold ? 'font-medium text-foreground' : 'text-foreground'}>{formatINR(value)}</span>
    </div>
  );
}
