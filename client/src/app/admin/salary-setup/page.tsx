'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import Breadcrumb from '@/components/ui/Breadcrumb';
import LoadError from '@/components/ui/LoadError';
import { formatINR } from '@/lib/utils';
import { Search, Loader2, Save, Download, AlertCircle } from 'lucide-react';

// Salary Assignments: which salary structure each employee is on, and at what base.
// Structures themselves are defined in Admin → Salary Structures.

const inputCls = 'px-2 py-1.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';

interface RowDraft { structure_id: string; base: string; tds: string }

export default function SalaryAssignmentsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState<Record<number, RowDraft>>({});
  const [savingId, setSavingId] = useState<number | null>(null);

  const { data: rows = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['salary-assignments'],
    queryFn: () => api.get('/payroll/assignments').then(r => r.data),
  });
  const { data: structures = [] } = useQuery({
    queryKey: ['salary-structures'],
    queryFn: () => api.get('/admin/salary-structures').then(r => r.data),
  });

  const activeStructures = useMemo(() => structures.filter((s: any) => s.is_active), [structures]);
  const structureById = useMemo(() => new Map(structures.map((s: any) => [s.id, s])), [structures]);

  const draftFor = (r: any): RowDraft =>
    drafts[r.employee_id] ?? {
      structure_id: r.structure_id != null ? String(r.structure_id) : '',
      base: r.base != null ? String(Math.round(Number(r.base))) : '',
      tds: r.tds_amount ? String(Math.round(Number(r.tds_amount))) : '',
    };

  const setDraft = (employeeId: number, patch: Partial<RowDraft>, row: any) =>
    setDrafts((p) => ({ ...p, [employeeId]: { ...draftFor(row), ...(p[employeeId] ?? {}), ...patch } }));

  const isDirty = (r: any) => {
    const d = drafts[r.employee_id];
    if (!d) return false;
    const origStructure = r.structure_id != null ? String(r.structure_id) : '';
    const origBase = r.base != null ? String(Math.round(Number(r.base))) : '';
    const origTds = r.tds_amount ? String(Math.round(Number(r.tds_amount))) : '';
    return d.structure_id !== origStructure || d.base !== origBase || d.tds !== origTds;
  };

  const saveMutation = useMutation({
    mutationFn: ({ employeeId, draft }: { employeeId: number; draft: RowDraft }) =>
      api.put(`/payroll/assignments/${employeeId}`, {
        structure_id: Number(draft.structure_id),
        base: Number(draft.base),
        tds_amount: Number(draft.tds) || 0,
      }),
    onSuccess: (_res, { employeeId }) => {
      queryClient.invalidateQueries({ queryKey: ['salary-assignments'] });
      setDrafts((p) => { const n = { ...p }; delete n[employeeId]; return n; });
      toast.success('Assignment saved');
      setSavingId(null);
    },
    onError: (e: any) => { toast.error(e.response?.data?.error || 'Failed to save'); setSavingId(null); },
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return rows.filter((r: any) => !q
      || `${r.first_name} ${r.last_name}`.toLowerCase().includes(q)
      || r.employee_code?.toLowerCase().includes(q)
      || r.designation?.toLowerCase().includes(q)
      || r.structure_name?.toLowerCase().includes(q));
  }, [rows, search]);

  const unassigned = useMemo(() => rows.filter((r: any) => !r.structure_id).length, [rows]);

  async function downloadPayslip(r: any) {
    try {
      const now = new Date();
      const m = now.getMonth() === 0 ? 12 : now.getMonth();
      const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
      const res = await api.get(`/payroll/employees/${r.employee_id}/payslip/pdf?month=${m}&year=${y}`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url; a.download = `Payslip_${r.first_name}_${r.last_name}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Could not generate a payslip preview for this employee');
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <Breadcrumb className="mb-2" items={[{ label: 'Admin', href: '/admin' }, { label: 'Salary Assignments' }]} />
          <h1 className="text-2xl font-bold text-foreground">Salary Assignments</h1>
          <p className="text-secondary mt-1">Assign each employee a salary structure and their base amount. Structures are defined in <a href="/admin/salary-structure" className="underline hover:text-foreground">Salary Structures</a>.</p>
        </div>

        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="p-3 border-b border-border flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-56">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee, designation, structure..."
                className="w-full pl-9 pr-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
            {unassigned > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-amber-700">
                <AlertCircle size={13} className="shrink-0" /> {unassigned} employee{unassigned === 1 ? '' : 's'} without an assignment (falls back to the designation structure)
              </p>
            )}
          </div>

          {isLoading ? (
            <div className="p-4 space-y-2">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-11 bg-muted rounded animate-pulse" />)}</div>
          ) : isError ? (
            <LoadError message="Couldn't load assignments." onRetry={() => refetch()} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-secondary">
                    <th className="px-4 py-3 font-medium">Employee</th>
                    <th className="px-4 py-3 font-medium">Designation</th>
                    <th className="px-4 py-3 font-medium w-64">Structure</th>
                    <th className="px-4 py-3 font-medium w-36">Base ₹/mo</th>
                    <th className="px-4 py-3 font-medium w-28">TDS ₹/mo</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((r: any) => {
                    const d = draftFor(r);
                    const dirty = isDirty(r);
                    const structure: any = d.structure_id ? structureById.get(Number(d.structure_id)) : null;
                    return (
                      <tr key={r.employee_id} className="hover:bg-muted/20">
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-foreground">{r.first_name} {r.last_name}</p>
                          <p className="text-xs text-secondary">{r.employee_code} · {r.branch_name || '—'}</p>
                        </td>
                        <td className="px-4 py-2.5 text-secondary">{r.designation || '—'}</td>
                        <td className="px-4 py-2.5">
                          <select className={`${inputCls} w-full`} value={d.structure_id}
                            onChange={(e) => setDraft(r.employee_id, { structure_id: e.target.value }, r)}>
                            <option value="">— Unassigned —</option>
                            {activeStructures.map((s: any) => (
                              <option key={s.id} value={s.id}>{s.name}{s.payment_basis === 'hourly' ? ' (hourly)' : ''}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-2.5">
                          <input type="number" className={`${inputCls} w-full`} value={d.base}
                            placeholder={structure ? String(Math.round(structure.default_base)) : ''}
                            onChange={(e) => setDraft(r.employee_id, { base: e.target.value }, r)} />
                        </td>
                        <td className="px-4 py-2.5">
                          <input type="number" min={0} className={`${inputCls} w-full`} value={d.tds}
                            placeholder="0" title="Manual monthly TDS — deducted as a TDS line on the payslip"
                            onChange={(e) => setDraft(r.employee_id, { tds: e.target.value }, r)} />
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => { setSavingId(r.employee_id); saveMutation.mutate({ employeeId: r.employee_id, draft: d }); }}
                              disabled={!dirty || !d.structure_id || !d.base || savingId === r.employee_id}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors"
                            >
                              {savingId === r.employee_id ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
                            </button>
                            <button onClick={() => downloadPayslip(r)} title="Download last month's payslip preview"
                              className="p-1.5 rounded-lg text-secondary hover:text-foreground hover:bg-muted transition-colors">
                              <Download size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {rows.length > 0 && (
          <p className="text-xs text-secondary">
            {rows.filter((r: any) => r.structure_id).length} of {rows.length} active employees assigned ·
            {' '}monthly base total {formatINR(rows.reduce((s: number, r: any) => s + (Number(r.base) || 0), 0))}
          </p>
        )}
      </div>
    </AppShell>
  );
}
