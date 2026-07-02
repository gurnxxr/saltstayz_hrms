'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  Search, Pencil, Download, Loader2, X, Save, IndianRupee,
} from 'lucide-react';
import Breadcrumb from '@/components/ui/Breadcrumb';
import { formatINR } from '@/lib/utils';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const CITIES = ['Delhi', 'Gurugram', 'Noida', 'Mumbai', 'Bengaluru', 'Chandigarh', 'Haryana', 'Maharashtra', 'Karnataka'];

export default function SalarySetupPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canManage = ['admin', 'chro', 'hr', 'finance'].includes(user?.roleName || '');
  const canEdit = ['admin', 'chro', 'hr', 'finance'].includes(user?.roleName || '');

  const now = new Date();
  const [search, setSearch] = useState('');
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [editing, setEditing] = useState<any>(null);

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);
  const isFutureMonth = (m: number, y: number) =>
    y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth() + 1);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['salary-setups'],
    queryFn: () => api.get('/payroll/salary-setups').then(r => r.data),
    enabled: canManage,
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return rows.filter((r: any) =>
      !q ||
      `${r.first_name} ${r.last_name}`.toLowerCase().includes(q) ||
      r.employee_code?.toLowerCase().includes(q) ||
      r.dept_name?.toLowerCase().includes(q),
    );
  }, [rows, search]);

  async function downloadFor(employeeId: number, name: string) {
    try {
      const res = await api.get(
        `/payroll/employees/${employeeId}/payslip/pdf?month=${month}&year=${year}`,
        { responseType: 'blob' },
      );
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `Payslip_${name.replace(/\s+/g, '_')}_${MONTHS[month - 1]}_${year}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      if (err.response?.status === 422) toast.error('Salary not configured for this employee');
      else toast.error('Failed to download payslip');
    }
  }

  if (!canManage) {
    return (
      <AppShell>
        <div className="text-center py-20 text-secondary">You do not have access to salary setup.</div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <Breadcrumb className="mb-2" items={[{ label: 'Admin', href: '/admin' }, { label: 'Salary Setup' }]} />
          <h1 className="text-2xl font-bold text-foreground">Salary Setup</h1>
          <p className="text-secondary mt-1">Configure salary components used to generate payslips</p>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, code, or department..."
              className="w-full pl-9 pr-3 py-2.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">Payslip Month</label>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
              className="px-3 py-2.5 border border-border rounded-lg bg-background text-sm min-w-[130px]">
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1} disabled={isFutureMonth(i + 1, year)}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">Year</label>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}
              className="px-3 py-2.5 border border-border rounded-lg bg-background text-sm">
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Code</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Employee</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Department</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-secondary uppercase">Gross</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">City</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-secondary uppercase">PLI</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-secondary uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((r: any) => {
                    const configured = r.gross !== null && r.gross !== undefined;
                    return (
                      <tr key={r.employee_id} className="hover:bg-muted/20">
                        <td className="px-4 py-3 text-sm font-medium text-foreground">{r.employee_code}</td>
                        <td className="px-4 py-3 text-sm text-foreground">{r.first_name} {r.last_name}</td>
                        <td className="px-4 py-3 text-sm text-secondary">{r.dept_name || '—'}</td>
                        <td className="px-4 py-3 text-sm text-right font-medium text-foreground">
                          {configured ? formatINR(r.gross) : <span className="text-amber-600 text-xs">Not set</span>}
                        </td>
                        <td className="px-4 py-3 text-sm text-secondary">{r.city || '—'}</td>
                        <td className="px-4 py-3 text-sm text-right text-foreground">{configured ? formatINR(r.pli) : '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {canEdit && (
                              <button
                                onClick={() => setEditing(r)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted rounded-lg transition-colors"
                              >
                                <Pencil size={13} /> Edit
                              </button>
                            )}
                            <button
                              onClick={() => downloadFor(r.employee_id, `${r.first_name} ${r.last_name}`)}
                              disabled={!configured}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/5 rounded-lg transition-colors disabled:opacity-40"
                            >
                              <Download size={13} /> PDF
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filtered.length === 0 && (
              <p className="text-center py-10 text-sm text-secondary">No employees match your search.</p>
            )}
          </div>
        )}
      </div>

      {editing && (
        <EditDrawer
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['salary-setups'] });
            setEditing(null);
          }}
        />
      )}
    </AppShell>
  );
}

function EditDrawer({ row, onClose, onSaved }: { row: any; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    gross: row.gross ?? '',
    city: row.city ?? 'Gurugram',
    pli: row.pli ?? 0,
    meal: row.meal ?? 0,
    accommodation: row.accommodation ?? 0,
    accommodation_allowance: row.accommodation_allowance ?? 0,
    lwf_employee: row.lwf_employee ?? '',
    lwf_employer: row.lwf_employer ?? '',
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload: any = {
        gross: Number(form.gross),
        city: form.city,
        pli: Number(form.pli) || 0,
        meal: Number(form.meal) || 0,
        accommodation: Number(form.accommodation) || 0,
        accommodation_allowance: Number(form.accommodation_allowance) || 0,
      };
      if (form.lwf_employee !== '') payload.lwf_employee = Number(form.lwf_employee);
      if (form.lwf_employer !== '') payload.lwf_employer = Number(form.lwf_employer);
      return api.put(`/payroll/salary-setups/${row.employee_id}`, payload).then(r => r.data);
    },
    onSuccess: () => { toast.success('Salary updated'); onSaved(); },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to save'),
  });

  const set = (k: string, v: any) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md bg-card h-full overflow-y-auto shadow-xl border-l border-border">
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-foreground">{row.first_name} {row.last_name}</h3>
            <p className="text-xs text-secondary">{row.employee_code} · {row.dept_name || '—'}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg transition-colors">
            <X size={18} className="text-secondary" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <Field label="Gross Salary (per MW) *" hint="Basic = 50%, HRA = 50% of Basic, rest is Other Allowance" prefix>
            <input type="number" value={form.gross} onChange={(e) => set('gross', e.target.value)}
              className="w-full pl-7 pr-3 py-2.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </Field>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">City <span className="text-secondary font-normal">(for LWF)</span></label>
            <select value={form.city} onChange={(e) => set('city', e.target.value)}
              className="w-full px-3 py-2.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
              {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="PLI (Variable)" prefix>
              <input type="number" value={form.pli} onChange={(e) => set('pli', e.target.value)}
                className="w-full pl-7 pr-3 py-2.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </Field>
            <Field label="Meal (Deduction)" prefix>
              <input type="number" value={form.meal} onChange={(e) => set('meal', e.target.value)}
                className="w-full pl-7 pr-3 py-2.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </Field>
            <Field label="Accommodation (Deduction)" prefix>
              <input type="number" value={form.accommodation} onChange={(e) => set('accommodation', e.target.value)}
                className="w-full pl-7 pr-3 py-2.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </Field>
            <Field label="Accom. Allowance (Benefit)" prefix>
              <input type="number" value={form.accommodation_allowance} onChange={(e) => set('accommodation_allowance', e.target.value)}
                className="w-full pl-7 pr-3 py-2.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="LWF Employee" hint="Override city default" prefix>
              <input type="number" value={form.lwf_employee} onChange={(e) => set('lwf_employee', e.target.value)} placeholder="auto"
                className="w-full pl-7 pr-3 py-2.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </Field>
            <Field label="LWF Employer" hint="Override city default" prefix>
              <input type="number" value={form.lwf_employer} onChange={(e) => set('lwf_employer', e.target.value)} placeholder="auto"
                className="w-full pl-7 pr-3 py-2.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </Field>
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors">
              Cancel
            </button>
            <button
              onClick={() => {
                if (!form.gross || Number(form.gross) <= 0) { toast.error('Enter a valid gross salary'); return; }
                saveMutation.mutate();
              }}
              disabled={saveMutation.isPending}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {saveMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, prefix, children }: {
  label: string; hint?: string; prefix?: boolean; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1.5">{label}</label>
      <div className="relative">
        {prefix && <IndianRupee size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-secondary" />}
        {children}
      </div>
      {hint && <p className="text-xs text-secondary mt-1">{hint}</p>}
    </div>
  );
}
