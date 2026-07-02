'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import LoadError from '@/components/ui/LoadError';
import { ArrowLeft, IndianRupee, AlertCircle } from 'lucide-react';

export default function NewVacancyPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [form, setForm] = useState(() => ({
    job_title_id: '',
    department_id: '',
    property_id: '',
    reporting_manager_id: '',
    positions: '1',
    description: '',
    // Prefilled from ?backfill_job_id when raising a vacancy from Manpower → Replacements.
    backfill_job_id: typeof window !== 'undefined' ? (new URLSearchParams(window.location.search).get('backfill_job_id') || '') : '',
  }));

  const { data: properties = [], isError: pErr, refetch: rP } = useQuery({
    queryKey: ['properties'],
    queryFn: () => api.get('/admin/properties').then(r => r.data),
  });

  // Departments are organization-wide (not scoped to a property)
  const { data: departments = [], isError: dErr, refetch: rD } = useQuery({
    queryKey: ['departments'],
    queryFn: () => api.get('/admin/departments').then(r => r.data),
  });

  // Job titles enriched with salary-structure status; only configured ones are postable.
  const { data: jobTitles = [], isError: jErr, refetch: rJ } = useQuery({
    queryKey: ['postable-job-titles'],
    queryFn: () => api.get('/recruitment/job-titles').then(r => r.data),
  });

  // Active employees — any can be tagged as the new hire's reporting manager.
  const { data: managers = [], isError: mErr, refetch: rM } = useQuery({
    queryKey: ['managers'],
    queryFn: () => api.get('/employees/managers').then(r => r.data),
  });

  // If the form's reference data fails, say so — don't leave silently-empty dropdowns.
  const refError = pErr || dErr || jErr || mErr;
  const retryRef = () => { rP(); rD(); rJ(); rM(); };

  const selectedTitle = jobTitles.find((j: any) => String(j.id) === form.job_title_id);
  const hasUnconfigured = jobTitles.some((j: any) => !j.configured);

  const mutation = useMutation({
    mutationFn: (data: typeof form) =>
      api.post('/recruitment/vacancies', {
        job_title_id: Number(data.job_title_id),
        department_id: Number(data.department_id),
        property_id: Number(data.property_id),
        reporting_manager_id: Number(data.reporting_manager_id),
        positions: Number(data.positions),
        description: data.description,
        backfill_job_id: data.backfill_job_id?.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vacancies'] });
      queryClient.invalidateQueries({ queryKey: ['vacancy-stats'] });
      toast.success('Vacancy created successfully');
      router.push('/recruitment');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to create vacancy'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.job_title_id || !form.department_id || !form.property_id || !form.reporting_manager_id) {
      toast.error('Please fill all required fields');
      return;
    }
    if (selectedTitle && !selectedTitle.configured) {
      toast.error('This designation has no salary structure. Set it up in Admin → Salary Structure first.');
      return;
    }
    mutation.mutate(form);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto space-y-6">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-secondary hover:text-foreground text-sm transition-colors"
        >
          <ArrowLeft size={16} />
          Back to Recruitment
        </button>

        <div>
          <h1 className="text-2xl font-bold text-foreground">Create Vacancy</h1>
          <p className="text-secondary mt-1">Open a new position for recruitment</p>
        </div>

        {refError && (
          <div className="bg-card rounded-xl border border-border">
            <LoadError compact message="Couldn't load form options (properties, departments, roles, or managers)." onRetry={retryRef} />
          </div>
        )}

        <form onSubmit={handleSubmit} className="bg-card rounded-xl border border-border p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Property *</label>
            <select
              name="property_id"
              value={form.property_id}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="">Select property</option>
              {properties.map((p: any) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Department *</label>
            <select
              name="department_id"
              value={form.department_id}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="">Select department</option>
              {departments.map((d: any) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Job Title *</label>
            <select
              name="job_title_id"
              value={form.job_title_id}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="">Select job title</option>
              {jobTitles.map((j: any) => (
                <option key={j.id} value={j.id} disabled={!j.configured}>
                  {j.title}{j.configured ? '' : ' — no salary structure'}
                </option>
              ))}
            </select>

            {selectedTitle?.configured && (
              <div className="mt-2 flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/20 px-3 py-2">
                <IndianRupee size={15} className="text-primary shrink-0" />
                <p className="text-sm text-foreground">
                  CTC: <span className="font-semibold">{selectedTitle.ctc_label}</span>
                  <span className="text-secondary"> · from salary structure</span>
                </p>
              </div>
            )}

            {hasUnconfigured && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-secondary">
                <AlertCircle size={13} className="shrink-0" />
                Some designations are greyed out until their salary structure is set in{' '}
                <a href="/admin/salary-structure" className="text-primary hover:underline">Admin → Salary Structure</a>.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Reporting Manager *</label>
            <select
              name="reporting_manager_id"
              value={form.reporting_manager_id}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="">Select reporting manager</option>
              {managers.map((m: any) => (
                <option key={m.id} value={m.id}>{m.first_name} {m.last_name} ({m.employee_code})</option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-secondary">The hired applicant will report to this manager.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Number of Positions</label>
            <input
              type="number"
              name="positions"
              min="1"
              value={form.positions}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Backfill JOB ID (optional)</label>
            <input
              type="text"
              name="backfill_job_id"
              value={form.backfill_job_id}
              onChange={handleChange}
              placeholder="e.g. JOB-000123"
              className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <p className="mt-1.5 text-xs text-secondary">Map this vacancy to the JOB ID it replaces (from Manpower &rarr; Replacements).</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Description</label>
            <textarea
              name="description"
              rows={4}
              value={form.description}
              onChange={handleChange}
              placeholder="Job description, requirements, etc."
              className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => router.back()}
              className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {mutation.isPending ? 'Creating...' : 'Create Vacancy'}
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
