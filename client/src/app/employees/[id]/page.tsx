'use client';

import { use, useEffect, useState } from 'react';
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
  ArrowLeft, User, Phone, Mail, Calendar, Briefcase, MapPin,
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

  // Department is a pick-list, sourced from the official catalog (same list every
  // other screen uses) so a department created in Admin is immediately selectable.
  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: () => api.get('/admin/departments').then(r => r.data),
  });

  // Branch is the same shape of thing, and matters more: it is the work location, and the
  // location's state decides Professional Tax, Labour Welfare Fund and the minimum-wage floor.
  // Typed free-hand, a name that matches no property silently costs the employee their state
  // holidays and drops their statutory rates onto a default.
  const { data: properties = [] } = useQuery({
    queryKey: ['properties'],
    queryFn: () => api.get('/admin/properties').then(r => r.data),
  });

  // Branches are a managed list too (Admin → Organization → Branches), for the same reason:
  // typed by hand, "Corporate Office" and "Corp Office" become two units no report can add up.
  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => api.get('/admin/branches').then(r => r.data),
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

  // Warn before leaving with unsaved employee edits. Only the fields that can actually be
  // edited — the onboarding-fixed ones can never differ, and testing them would be dead code.
  const dirty = editing && !!emp && (
    form.first_name !== emp.first_name ||
    form.last_name !== emp.last_name ||
    String(form.reporting_manager_id) !== String(emp.reporting_manager_id || '') ||
    form.email !== (emp.email || '') ||
    form.phone !== (emp.phone || '') ||
    form.aadhaar_number !== (emp.aadhaar_number || '') ||
    form.dept_name !== (emp.dept_name || '') ||
    form.branch_name !== (emp.branch_name || '') ||
    form.branch_unit !== (emp.branch_unit || '') ||
    String(form.job_title_id) !== String(emp.job_title_id || '')
  );
  useUnsavedChangesWarning(dirty);

  function startEditing() {
    if (!emp) return;
    // The onboarding-fixed fields are deliberately absent: the server strips them from any
    // update, so carrying them in the form would only invite them to be sent and dropped.
    setForm({
      first_name: emp.first_name,
      last_name: emp.last_name,
      reporting_manager_id: emp.reporting_manager_id || '',
      email: emp.email || '',
      phone: emp.phone || '',
      aadhaar_number: emp.aadhaar_number || '',
      dept_name: emp.dept_name || '',
      branch_name: emp.branch_name || '',
      branch_unit: emp.branch_unit || '',
      job_title_id: emp.job_title_id || '',
      is_active: emp.is_active ? 1 : 0,
    });
    setEditing(true);
  }

  // "Edit" in the Employee Details list links here with ?edit=1, so the editor opens
  // straight away instead of making the user click Edit again. useSearchParams() would
  // force a Suspense boundary on this page; read the query directly, as the Leaves page
  // does. Runs once, after the employee loads.
  const [autoEditDone, setAutoEditDone] = useState(false);
  useEffect(() => {
    if (autoEditDone || !emp || editing || !canEditStatus) return;
    if (new URLSearchParams(window.location.search).get('edit') === '1') {
      startEditing();
      setAutoEditDone(true);
    }
  }, [emp, editing, canEditStatus, autoEditDone]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Department options: the catalog, plus the employee's current department if it's
  // an off-catalog value (e.g. "Security") — so switching to a dropdown never
  // silently drops a value the record already holds.
  const deptNames: string[] = departments.map((d: any) => d.name as string);
  const currentDept = (form.dept_name ?? '').trim();
  // Holidays are given department by department, so an off-catalog department is no longer
  // merely untidy — it costs this person every holiday that is limited to particular
  // departments, silently. Keep the value, label it, and say what it costs.
  const deptOffCatalog = !!currentDept && !deptNames.includes(currentDept);
  if (deptOffCatalog) deptNames.push(currentDept);
  const deptOptions = deptNames.map((n) => ({
    value: n,
    label: deptOffCatalog && n === currentDept ? `${n} — not a department` : n,
  }));
  const deptHint = deptOffCatalog
    ? `"${currentDept}" isn't in the department list. Until it's corrected, this employee won't see any holiday that's limited to particular departments.`
    : !currentDept
      ? "Without a department, this employee won't see any holiday that's limited to particular departments."
      : undefined;

  // Same treatment for branch, with one addition: a value that matches no property is kept but
  // LABELLED, because it is not merely off-catalog — it is the state of an employee whose
  // statutory rates are currently resolved from a fallback rather than from where they work.
  const activeProps = (properties as any[]).filter((p) => p.is_active !== false);
  const propNames: string[] = activeProps.map((p) => p.name as string);
  const currentBranch = (form.branch_name ?? '').trim();
  const branchOptions = propNames.map((n) => ({ value: n, label: n }));
  if (currentBranch && !propNames.includes(currentBranch)) {
    branchOptions.unshift({ value: currentBranch, label: `${currentBranch} — not a property` });
  }

  // Same off-catalog guard as the property picker: an existing value that is not yet in the list
  // stays selectable, so turning this into a dropdown never blanks somebody's record.
  const unitNames: string[] = (branches as any[]).filter((b) => b.is_active !== false).map((b) => b.name as string);
  const currentUnit = (form.branch_unit ?? '').trim();
  const unitOptions = [{ value: '', label: '—' }, ...unitNames.map((n) => ({ value: n, label: n }))];
  if (currentUnit && !unitNames.includes(currentUnit)) {
    unitOptions.splice(1, 0, { value: currentUnit, label: `${currentUnit} — not in the branch list` });
  }

  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Breadcrumb items={[{ label: 'Employee Details', href: '/employees' }, { label: `${emp.first_name} ${emp.last_name}` }]} />
          {!editing ? (
            // Only admin/CHRO/HR may write (EMPLOYEE_WRITE_ROLES on PUT /employees/:id).
            // Offering the button to anyone else just earns them a 403.
            canEditStatus && (
              <button
                onClick={startEditing}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <Pencil size={14} /> Edit Employee
              </button>
            )
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
              {/* Fixed at onboarding — see FIXED_AT_ONBOARDING in employee.service.ts. These come
                  off the UID/PAN card and are verified once; editing them later would leave the
                  record no longer matching the document it was checked against. Date of joining
                  is set by the hire at the end of recruitment, and moving it would shift payable
                  days and leave accrual. The server drops them on save, so these are shown
                  read-only rather than left editable and silently ignored. */}
              <ReadOnlyField label="Date of Birth (As per UID)" value={fmtDate(emp.date_of_birth)} />
              <ReadOnlyField label="Gender" value={emp.gender ? emp.gender[0].toUpperCase() + emp.gender.slice(1) : ''} />
              <ReadOnlyField label="Father's Name (As per UID)" value={emp.father_name} />
              <ReadOnlyField label="PAN Card No" value={emp.pan_number} />
              <ReadOnlyField label="Date of Joining" value={fmtDate(emp.date_of_joining)} hint="Set when the hire is completed in Recruitment" />
              <SelectField label="Reporting Manager" value={form.reporting_manager_id} onChange={(v) => setForm((p: any) => ({ ...p, reporting_manager_id: v ? Number(v) : null }))} options={managers.filter((m: any) => m.id !== Number(id)).map((m: any) => ({ value: m.id, label: `${m.first_name} ${m.last_name}` }))} />
              <FormField label="Email Address" value={form.email} onChange={(v) => setForm((p: any) => ({ ...p, email: v }))} type="email" />
              <FormField label="Phone Number" value={form.phone} onChange={(v) => setForm((p: any) => ({ ...p, phone: v }))} />
              <FormField label="Aadhaar Card No" value={form.aadhaar_number} onChange={(v) => setForm((p: any) => ({ ...p, aadhaar_number: v.replace(/\D/g, '') }))} maxLength={12} />
              <SelectField label="Dept Name" value={form.dept_name} onChange={(v) => setForm((p: any) => ({ ...p, dept_name: v }))} options={deptOptions} hint={deptHint} />
              <SelectField label="Designation Name" value={form.job_title_id} onChange={(v) => setForm((p: any) => ({ ...p, job_title_id: v ? Number(v) : null }))} options={jobTitles.map((j: any) => ({ value: j.id, label: j.title || j.name }))} />
              <SelectField label="Property Name" value={form.branch_name} onChange={(v) => setForm((p: any) => ({ ...p, branch_name: v }))} options={branchOptions} />
              <SelectField label="Branch Name" value={form.branch_unit} onChange={(v) => setForm((p: any) => ({ ...p, branch_unit: v }))} options={unitOptions} />
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
              {/* HR's own copy, captured with the identity documents. Finance keeps a separate
                  PAN on the bank-details record, and that is the one payroll and TDS use — the
                  two are not synchronised, so they can disagree. */}
              <InfoRow icon={Shield} label="PAN Card No" value={emp.pan_number ? maskValue(emp.pan_number, 4) : 'Not set'} />
              <InfoRow icon={Briefcase} label="Dept Name" value={emp.dept_name || 'N/A'} />
              <InfoRow icon={Briefcase} label="Designation Name" value={emp.designation_name || 'N/A'} />
              <InfoRow icon={Briefcase} label="Property Name" value={emp.branch_name || 'N/A'} />
              <InfoRow icon={Briefcase} label="Branch Name" value={emp.branch_unit || 'N/A'} />
              {/* Derived from the property, never stored on the employee — it decides
                  Professional Tax, LWF, minimum wage and per-state holidays. Change it
                  via the property in Admin → Organization. */}
              <InfoRow
                icon={MapPin}
                label="State"
                value={emp.state || 'Not set — payroll falls back to Haryana'}
              />
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

/** A date the way the rest of the page shows them, or an em dash when there isn't one. */
function fmtDate(v?: string | null) {
  if (!v) return '';
  return new Date(v).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * A field shown inside the edit form that cannot be edited.
 *
 * Deliberately not a disabled <input>: a greyed-out box invites people to click it and wonder
 * why nothing happens. This reads as a stated fact, with a note saying where it comes from.
 */
function ReadOnlyField({ label, value, hint }: { label: string; value?: string | null; hint?: string }) {
  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1.5">
        {label}
        <span className="ml-2 text-xs font-normal text-secondary">· not editable</span>
      </label>
      <div className="w-full px-3 py-2.5 border border-border border-dashed rounded-lg bg-muted/40 text-sm text-secondary">
        {value || 'Not set'}
      </div>
      {hint && <p className="mt-1 text-xs text-secondary">{hint}</p>}
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

function SelectField({ label, value, onChange, options, hint }: {
  label: string; value: string | number; onChange: (v: string) => void;
  options: { value: number | string; label: string }[];
  /** Shown in amber under the field. For a value that saves fine but costs the employee something. */
  hint?: string;
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
      {hint && <p className="mt-1 text-xs text-amber-700">{hint}</p>}
    </div>
  );
}

function maskValue(value: string, visibleChars: number) {
  if (value.length <= visibleChars) return value;
  return '•'.repeat(value.length - visibleChars) + value.slice(-visibleChars);
}
