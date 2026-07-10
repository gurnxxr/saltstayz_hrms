'use client';

import { use, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import { formatINR } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Breadcrumb from '@/components/ui/Breadcrumb';
import LoadError from '@/components/ui/LoadError';
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning';
import {
  ArrowLeft, User, Phone, Mail, Calendar, Briefcase,
  CreditCard, Shield, Hash, Save, Loader2, Pencil,
} from 'lucide-react';

export default function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canEditStatus = user?.roleName === 'admin' || user?.roleName === 'hr' || user?.roleName === 'chro';
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>({});
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const { data: emp, isLoading, isError, refetch } = useQuery({
    queryKey: ['employee-detail', id],
    queryFn: () => api.get(`/employees/${id}`).then(r => r.data),
  });

  const { data: jobTitles = [] } = useQuery({
    queryKey: ['job-titles-lookup'],
    queryFn: () => api.get('/admin/job-titles').then(r => r.data),
  });

  const { data: managers = [] } = useQuery({
    queryKey: ['managers-lookup'],
    queryFn: () => api.get('/employees/managers').then(r => r.data),
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) => api.put(`/employees/${id}`, data).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employee-detail', id] });
      queryClient.invalidateQueries({ queryKey: ['employees-list'] });
      toast.success('Employee updated');
      setEditing(false);
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Update failed'),
  });

  const statusMutation = useMutation({
    mutationFn: (active: boolean) => api.put(`/employees/${id}`, { is_active: active }).then(r => r.data),
    onSuccess: (_data, active) => {
      queryClient.invalidateQueries({ queryKey: ['employee-detail', id] });
      queryClient.invalidateQueries({ queryKey: ['employees-list'] });
      toast.success(`Employee marked as ${active ? 'Active' : 'Inactive'}`);
      setConfirmDeactivate(false);
    },
    onError: (err: any) => { toast.error(err.response?.data?.error || 'Status update failed'); setConfirmDeactivate(false); },
  });

  // Warn before leaving with unsaved employee edits.
  const dirty = editing && !!emp && (
    form.first_name !== emp.first_name ||
    form.last_name !== emp.last_name ||
    form.date_of_birth !== (emp.date_of_birth || '') ||
    form.father_name !== (emp.father_name || '') ||
    String(form.reporting_manager_id) !== String(emp.reporting_manager_id || '') ||
    form.email !== (emp.email || '') ||
    form.date_of_joining !== (emp.date_of_joining || '') ||
    form.phone !== (emp.phone || '') ||
    form.aadhaar_number !== (emp.aadhaar_number || '') ||
    form.dept_name !== (emp.dept_name || '') ||
    form.branch_name !== (emp.branch_name || '') ||
    form.gender !== (emp.gender || '') ||
    String(form.job_title_id) !== String(emp.job_title_id || '')
  );
  useUnsavedChangesWarning(dirty);

  function startEditing() {
    if (!emp) return;
    setForm({
      first_name: emp.first_name,
      last_name: emp.last_name,
      date_of_birth: emp.date_of_birth || '',
      gender: emp.gender || '',
      father_name: emp.father_name || '',
      reporting_manager_id: emp.reporting_manager_id || '',
      email: emp.email || '',
      date_of_joining: emp.date_of_joining || '',
      phone: emp.phone || '',
      aadhaar_number: emp.aadhaar_number || '',
      dept_name: emp.dept_name || '',
      branch_name: emp.branch_name || '',
      job_title_id: emp.job_title_id || '',
      is_active: emp.is_active ? 1 : 0,
    });
    setEditing(true);
  }

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      </AppShell>
    );
  }

  if (isError) {
    return (
      <AppShell>
        <LoadError message="Couldn't load this employee." onRetry={() => refetch()} />
      </AppShell>
    );
  }

  if (!emp) {
    return (
      <AppShell>
        <div className="text-center py-20 text-secondary">Employee not found.</div>
      </AppShell>
    );
  }

  const managerName = [emp.manager_first_name, emp.manager_last_name].filter(Boolean).join(' ') || 'N/A';

  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Breadcrumb items={[{ label: 'Employee Details', href: '/employees' }, { label: `${emp.first_name} ${emp.last_name}` }]} />
          {!editing ? (
            <button
              onClick={startEditing}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Pencil size={14} /> Edit Employee
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => setEditing(false)}
                className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => updateMutation.mutate(form)}
                disabled={updateMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {updateMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save
              </button>
            </div>
          )}
        </div>

        {/* Profile Card */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="bg-primary px-8 py-6">
            <div className="flex items-center gap-5">
              <div className="w-20 h-20 rounded-full bg-white/20 flex items-center justify-center text-white text-2xl font-bold">
                {emp.first_name[0]}{emp.last_name[0]}
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">{emp.first_name} {emp.last_name}</h2>
                <p className="text-blue-200 text-sm">{emp.designation_name || 'No Designation'}</p>
                <p className="text-blue-200 text-xs mt-0.5">{emp.employee_code}</p>
              </div>
              <div className="ml-auto flex items-center gap-3">
                {canEditStatus && !editing && (
                  <button
                    onClick={() => emp.is_active ? setConfirmDeactivate(true) : statusMutation.mutate(true)}
                    disabled={statusMutation.isPending}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${emp.is_active ? 'bg-green-500' : 'bg-gray-400'} ${statusMutation.isPending ? 'opacity-50' : 'cursor-pointer'}`}
                    title={`Click to mark ${emp.is_active ? 'Inactive' : 'Active'}`}
                  >
                    <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${emp.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                )}
                <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${emp.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {emp.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          </div>

          {editing ? (
            <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField label="First Name" value={form.first_name} onChange={(v) => setForm((p: any) => ({ ...p, first_name: v }))} />
              <FormField label="Last Name" value={form.last_name} onChange={(v) => setForm((p: any) => ({ ...p, last_name: v }))} />
              <FormField label="Date of Birth" value={form.date_of_birth} onChange={(v) => setForm((p: any) => ({ ...p, date_of_birth: v }))} type="date" />
              {/* Gender drives eligibility for gender-restricted leave (Maternity / Paternity). */}
              <SelectField label="Gender" value={form.gender} onChange={(v) => setForm((p: any) => ({ ...p, gender: v }))} options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'other', label: 'Other' }]} />
              <FormField label="Father's Name (As per UID)" value={form.father_name} onChange={(v) => setForm((p: any) => ({ ...p, father_name: v }))} />
              <SelectField label="Reporting Manager" value={form.reporting_manager_id} onChange={(v) => setForm((p: any) => ({ ...p, reporting_manager_id: v ? Number(v) : null }))} options={managers.filter((m: any) => m.id !== Number(id)).map((m: any) => ({ value: m.id, label: `${m.first_name} ${m.last_name}` }))} />
              <FormField label="Email Address" value={form.email} onChange={(v) => setForm((p: any) => ({ ...p, email: v }))} type="email" />
              <FormField label="Date of Joining" value={form.date_of_joining} onChange={(v) => setForm((p: any) => ({ ...p, date_of_joining: v }))} type="date" />
              <FormField label="Phone Number" value={form.phone} onChange={(v) => setForm((p: any) => ({ ...p, phone: v }))} />
              <FormField label="Aadhaar Card No" value={form.aadhaar_number} onChange={(v) => setForm((p: any) => ({ ...p, aadhaar_number: v.replace(/\D/g, '') }))} maxLength={12} />
              <FormField label="Dept Name" value={form.dept_name} onChange={(v) => setForm((p: any) => ({ ...p, dept_name: v }))} />
              <SelectField label="Designation Name" value={form.job_title_id} onChange={(v) => setForm((p: any) => ({ ...p, job_title_id: v ? Number(v) : null }))} options={jobTitles.map((j: any) => ({ value: j.id, label: j.title || j.name }))} />
              <FormField label="Branch Name" value={form.branch_name} onChange={(v) => setForm((p: any) => ({ ...p, branch_name: v }))} />
              {canEditStatus && (
                <SelectField label="Status" value={form.is_active} onChange={(v) => setForm((p: any) => ({ ...p, is_active: Number(v) }))} options={[{ value: 1, label: 'Active' }, { value: 0, label: 'Inactive' }]} />
              )}
            </div>
          ) : (
            <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-6">
              <InfoRow icon={Hash} label="Emp Code" value={emp.employee_code} />
              <InfoRow icon={User} label="Emp Name (As per UID)" value={`${emp.first_name} ${emp.last_name}`} />
              <InfoRow icon={Calendar} label="DOB (As per UID)" value={emp.date_of_birth ? new Date(emp.date_of_birth).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Not set'} />
              <InfoRow icon={User} label="Gender" value={emp.gender ? emp.gender[0].toUpperCase() + emp.gender.slice(1) : 'Not set'} />
              <InfoRow icon={User} label="F_Name (As per UID)" value={emp.father_name || 'Not set'} />
              <InfoRow icon={User} label="Reporting Manager" value={managerName} />
              <InfoRow icon={Mail} label="Email Address" value={emp.email || 'N/A'} />
              <InfoRow icon={Calendar} label="Date of Joining" value={emp.date_of_joining ? new Date(emp.date_of_joining).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A'} />
              <InfoRow icon={Phone} label="Phone Number" value={emp.phone || 'Not set'} />
              <InfoRow icon={Shield} label="Aadhaar Card No" value={emp.aadhaar_number ? maskValue(emp.aadhaar_number, 4) : 'Not set'} />
              <InfoRow icon={Briefcase} label="Dept Name" value={emp.dept_name || 'N/A'} />
              <InfoRow icon={Briefcase} label="Designation Name" value={emp.designation_name || 'N/A'} />
              <InfoRow icon={Briefcase} label="Branch Name" value={emp.branch_name || 'N/A'} />
              <InfoRow icon={CreditCard} label="Status" value={emp.is_active ? 'Active' : 'Inactive'} />
              {emp.offered_ctc != null && (
                <InfoRow icon={CreditCard} label="Offered Salary" value={
                  `${formatINR(emp.offered_ctc)}/yr · ${formatINR(emp.offered_base)}/mo`
                  + (Number(emp.offer_adjustment_pct) ? ` (${Number(emp.offer_adjustment_pct) > 0 ? '+' : ''}${emp.offer_adjustment_pct}% vs structure)` : '')
                } />
              )}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDeactivate}
        title="Mark employee inactive?"
        message={emp ? <><strong className="text-foreground">{emp.first_name} {emp.last_name}</strong> will be moved to Inactive and excluded from active rosters, payroll, and headcount.</> : undefined}
        confirmLabel="Mark inactive"
        loading={statusMutation.isPending}
        onConfirm={() => statusMutation.mutate(false)}
        onCancel={() => setConfirmDeactivate(false)}
      />
    </AppShell>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 p-2 rounded-lg bg-muted/50">
        <Icon size={16} className="text-primary" />
      </div>
      <div>
        <p className="text-xs text-secondary">{label}</p>
        <p className="text-sm font-medium text-foreground">{value}</p>
      </div>
    </div>
  );
}

function FormField({ label, value, onChange, type = 'text', maxLength }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; maxLength?: number;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        className="w-full px-3 py-2.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
      />
    </div>
  );
}

function SelectField({ label, value, onChange, options }: {
  label: string; value: string | number; onChange: (v: string) => void;
  options: { value: number | string; label: string }[];
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1.5">{label}</label>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
      >
        <option value="">Select {label}</option>
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function maskValue(value: string, visibleChars: number) {
  if (value.length <= visibleChars) return value;
  return '•'.repeat(value.length - visibleChars) + value.slice(-visibleChars);
}
