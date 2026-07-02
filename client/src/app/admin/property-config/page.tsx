'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import LoadError from '@/components/ui/LoadError';
import {
  ArrowLeft, SlidersHorizontal, IndianRupee, Users, Wallet, TrendingUp, X, MapPin, CalendarRange, ChevronRight, UserCheck, AlertTriangle,
} from 'lucide-react';
import Breadcrumb from '@/components/ui/Breadcrumb';
import { formatINR } from '@/lib/utils';
import EmployeeStatusChip from '@/components/employees/EmployeeStatusChip';
import EmployeeStatusDialog from '@/components/employees/EmployeeStatusDialog';

export default function PropertyConfigPage() {
  const router = useRouter();
  const [city, setCity] = useState('');
  const [propertyId, setPropertyId] = useState('');

  const { data: properties = [] } = useQuery({
    queryKey: ['pc-properties'],
    queryFn: () => api.get('/manpower/properties').then(r => r.data),
  });

  const cities = useMemo(
    () => Array.from(new Set(properties.map((p: any) => p.city).filter(Boolean))).sort(),
    [properties]
  );
  const propsInCity = useMemo(
    () => properties.filter((p: any) => !city || p.city === city),
    [properties, city]
  );

  return (
    <AppShell>
      <div className="space-y-6">
        <Breadcrumb items={[{ label: 'Admin', href: '/admin' }, { label: 'Property Configuration' }]} />
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><SlidersHorizontal className="text-primary" size={20} /></div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Property Configuration</h1>
            <p className="text-secondary text-sm">Pick a city and property to configure workers, salaries, spend, budget and status.</p>
          </div>
        </div>

        {/* Selectors */}
        <div className="bg-card rounded-xl border border-border p-5 flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-secondary mb-1 flex items-center gap-1"><MapPin size={12} /> City</label>
            <select value={city} onChange={e => { setCity(e.target.value); setPropertyId(''); }}
              className="px-3 py-2 border border-border rounded-lg bg-background text-sm min-w-[200px]">
              <option value="">All cities</option>
              {cities.map((c: any) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">Property</label>
            <select value={propertyId} onChange={e => setPropertyId(e.target.value)}
              className="px-3 py-2 border border-border rounded-lg bg-background text-sm min-w-[280px]">
              <option value="">Select property</option>
              {propsInCity.map((p: any) => <option key={p.id} value={p.id}>{p.name}{p.city ? ` — ${p.city}` : ''}</option>)}
            </select>
          </div>
        </div>

        {propertyId ? <Console propertyId={Number(propertyId)} /> : (
          <div className="bg-card rounded-xl border border-dashed border-border p-10 text-center text-secondary text-sm">
            Select a property to open its configuration.
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Console({ propertyId }: { propertyId: number }) {
  const qc = useQueryClient();
  const [statusTarget, setStatusTarget] = useState<any | null>(null);
  const [selectedDept, setSelectedDept] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['property-console', propertyId],
    queryFn: () => api.get(`/manpower/property-console?property_id=${propertyId}`).then(r => r.data),
  });

  if (isLoading) return <div className="bg-card rounded-xl border border-border p-10 text-center text-secondary text-sm">Loading…</div>;
  if (isError) return <div className="bg-card rounded-xl border border-border"><LoadError message="Couldn't load this property's configuration." onRetry={() => refetch()} /></div>;
  if (!data) return null;

  const { budget, totals, byDepartment, employees } = data;
  const deptEmployees = selectedDept ? employees.filter((e: any) => (e.dept_name || 'Unassigned') === selectedDept) : [];
  const hired = totals.worker_count;
  const sanctionedTotal = totals.total_sanctioned_workers;
  const overLimit = sanctionedTotal > 0 && hired > sanctionedTotal;

  return (
    <div className="space-y-5">
      {/* Headline metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Kpi icon={<Wallet size={16} />} label="Total Manpower Budget" value={formatINR(budget.sanctioned_budget_monthly)} sub={`${formatINR(budget.remaining)} remaining`} danger={budget.committed > budget.sanctioned_budget_monthly} />
        <Kpi icon={<Users size={16} />} label="Sanctioned Employee Count" value={String(budget.sanctioned_headcount)} sub={`${budget.filled} filled`} />
        <Kpi icon={<UserCheck size={16} />} label="Workers Hired" value={String(hired)} sub={sanctionedTotal > 0 ? `of ${sanctionedTotal} sanctioned` : 'no dept limits set'} danger={overLimit} />
        <Kpi icon={<IndianRupee size={16} />} label="Monthly Spend" value={formatINR(totals.total_spend)} sub={`${totals.worker_count} workers`} />
        <Kpi icon={<CalendarRange size={16} />} label="Yearly Spend" value={formatINR(totals.total_spend_yearly)} sub="monthly × 12" />
        <Kpi icon={<TrendingUp size={16} />} label="Avg Salary / Worker" value={formatINR(totals.avg_salary)} />
      </div>

      {overLimit && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-800">
          <AlertTriangle size={16} className="text-red-600 shrink-0" />
          <span><b>{hired}</b> workers hired exceed the sanctioned limit of <b>{sanctionedTotal}</b> for this property — over by <b>{hired - sanctionedTotal}</b>.</span>
        </div>
      )}

      {totals.on_pip > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 text-sm text-amber-800">
          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 border border-amber-200">PIP</span>
          <span><b>{totals.on_pip}</b> employee{totals.on_pip > 1 ? 's are' : ' is'} on PIP — HR can hire a backup for each while they remain on payroll.</span>
        </div>
      )}

      {selectedDept ? (
        <DeptEmployees dept={selectedDept} employees={deptEmployees} onBack={() => setSelectedDept(null)} onChangeStatus={(e) => setStatusTarget(e)} />
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">Departments</h3>
            <p className="text-[11px] text-secondary mt-0.5">Sanctioned employees per department are set in Admin → Budget Control. Click a department to view its employees.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-secondary">
                <tr className="text-left">
                  <th className="px-5 py-2.5 font-medium">Department</th>
                  <th className="px-5 py-2.5 font-medium">No. of Workers</th>
                  <th className="px-5 py-2.5 font-medium">No. of Sanctioned Employees</th>
                  <th className="px-5 py-2.5 font-medium text-right">Total Spend</th>
                  <th className="px-5 py-2.5 font-medium text-right">Avg Salary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {byDepartment.length === 0 ? (
                  <tr><td colSpan={5} className="px-5 py-6 text-center text-secondary">No departments configured.</td></tr>
                ) : byDepartment.map((d: any) => (
                  <tr key={d.dept_name} className="hover:bg-muted/30">
                    <td className="px-5 py-2.5">
                      <button onClick={() => setSelectedDept(d.dept_name)} className="font-medium text-foreground hover:text-primary inline-flex items-center gap-1">
                        {d.dept_name}<ChevronRight size={13} className="text-secondary" />
                      </button>
                    </td>
                    <td className={`px-5 py-2.5 ${d.over_limit ? 'text-red-600 font-medium' : ''}`} title={d.over_limit ? 'Over the sanctioned limit' : undefined}>{d.actual_workers}</td>
                    <td className="px-5 py-2.5">{d.sanctioned_workers ?? 0}</td>
                    <td className="px-5 py-2.5 text-right">{formatINR(d.spend)}</td>
                    <td className="px-5 py-2.5 text-right">{formatINR(d.avg_salary)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                  <td className="px-5 py-2.5 text-foreground">All departments</td>
                  <td className={`px-5 py-2.5 ${overLimit ? 'text-red-600' : 'text-foreground'}`}>{totals.worker_count}</td>
                  <td className="px-5 py-2.5">{totals.total_sanctioned_workers}</td>
                  <td className="px-5 py-2.5 text-right">{formatINR(totals.total_spend)}</td>
                  <td className="px-5 py-2.5 text-right">{formatINR(totals.avg_salary)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {statusTarget && (
        <EmployeeStatusDialog employee={statusTarget} onClose={() => setStatusTarget(null)}
          onSaved={() => { setStatusTarget(null); qc.invalidateQueries({ queryKey: ['property-console', propertyId] }); }} />
      )}
    </div>
  );
}

// Per-department employee sub-view — shown inline when a department is clicked
// (a drill-in, not a pop-up). Salary is read-only.
function DeptEmployees({ dept, employees, onBack, onChangeStatus }: { dept: string; employees: any[]; onBack: () => void; onChangeStatus: (e: any) => void }) {
  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-border">
        <button onClick={onBack} className="flex items-center gap-1 text-secondary hover:text-foreground text-sm"><ArrowLeft size={15} /> Departments</button>
        <span className="text-secondary">/</span>
        <h3 className="text-sm font-semibold text-foreground">{dept}</h3>
        <span className="text-[11px] text-secondary">· {employees.length} employee{employees.length === 1 ? '' : 's'}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-secondary">
            <tr className="text-left">
              <th className="px-5 py-2.5 font-medium">Employee</th>
              <th className="px-5 py-2.5 font-medium">Department</th>
              <th className="px-5 py-2.5 font-medium">Designation</th>
              <th className="px-5 py-2.5 font-medium">Salary (monthly)</th>
              <th className="px-5 py-2.5 font-medium">Status</th>
              <th className="px-5 py-2.5 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {employees.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-6 text-center text-secondary">No employees in this department.</td></tr>
            ) : employees.map((e: any) => {
              return (
                <tr key={e.id} className="hover:bg-muted/30">
                  <td className="px-5 py-2.5">
                    <div className="font-medium text-foreground">{e.name}</div>
                    <div className="text-[11px] text-secondary">{e.job_id ? `${e.job_id} · ` : ''}{e.employee_code}</div>
                  </td>
                  <td className="px-5 py-2.5 text-secondary">{e.dept_name}</td>
                  <td className="px-5 py-2.5 text-secondary">{e.job_title || '—'}</td>
                  <td className="px-5 py-2.5">{formatINR(e.monthly_ctc)}</td>
                  <td className="px-5 py-2.5"><EmployeeStatusChip status={e.employment_status} /></td>
                  <td className="px-5 py-2.5 text-right">
                    <button onClick={() => onChangeStatus(e)} className="px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/5 rounded-lg">Change status</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, sub, danger }: { icon: React.ReactNode; label: string; value: string; sub?: string; danger?: boolean }) {
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center gap-1.5 text-secondary text-[11px] uppercase tracking-wide">{icon}<span className="truncate">{label}</span></div>
      <p className={`text-2xl font-bold mt-1.5 ${danger ? 'text-red-600' : 'text-foreground'}`}>{value}</p>
      {sub && <p className="text-xs text-secondary mt-0.5">{sub}</p>}
    </div>
  );
}
