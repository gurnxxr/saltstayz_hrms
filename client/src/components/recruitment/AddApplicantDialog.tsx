'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import { CANDIDATE_QUERY_KEYS } from '@/lib/constants';
import { X, Loader2 } from 'lucide-react';

const inputCls = 'w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';

const emptyForm = { vacancy_id: '', name: '', email: '', phone: '', address: '', resume_url: '', notes: '' };

/**
 * Add one applicant. The fields mirror the CSV importer's columns so both routes into
 * the pipeline capture the same thing.
 *
 * Every applicant belongs to a vacancy (candidates.vacancy_id is required), so the picker
 * is part of the form. Pass `vacancy` to lock it when the caller already knows which one.
 */
export default function AddApplicantDialog({
  vacancy,
  onClose,
}: {
  vacancy?: { id: number; label: string };
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ ...emptyForm, vacancy_id: vacancy ? String(vacancy.id) : '' });

  const { data: vacancies = [] } = useQuery({
    queryKey: ['vacancies'],
    queryFn: () => api.get('/recruitment/vacancies').then(r => r.data),
    enabled: !vacancy,
  });
  // A closed vacancy takes no new applicants — the server refuses it either way, so don't
  // offer it here.
  const openVacancies = vacancies.filter((v: any) => v.status !== 'closed');

  const mutation = useMutation({
    mutationFn: () => api.post('/recruitment/candidates', {
      vacancy_id: Number(form.vacancy_id),
      name: form.name,
      email: form.email,
      phone: form.phone,
      address: form.address,
      resume_url: form.resume_url,
      notes: form.notes,
    }).then(r => r.data),
    onSuccess: (candidate: any) => {
      CANDIDATE_QUERY_KEYS.forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
      toast.success(`${candidate?.name || 'Applicant'} added to Shortlisting`);
      onClose();
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to add the applicant'),
  });

  const set = (k: keyof typeof emptyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const canSubmit = Boolean(form.vacancy_id) && form.name.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card rounded-xl border border-border shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-base font-semibold text-foreground">Add Applicant</h3>
          <button onClick={onClose} className="p-1 rounded-lg text-secondary hover:text-foreground hover:bg-muted transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {vacancy ? (
            <div className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
              <span className="text-secondary">Vacancy: </span>
              <span className="font-medium text-foreground">{vacancy.label}</span>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Vacancy<span className="text-red-600"> *</span></label>
              <select className={inputCls} value={form.vacancy_id} onChange={set('vacancy_id')}>
                <option value="">Select a vacancy…</option>
                {openVacancies.map((v: any) => (
                  <option key={v.id} value={v.id}>{v.job_title} — {v.property_name}</option>
                ))}
              </select>
              {openVacancies.length === 0 && (
                <p className="mt-1.5 text-xs text-amber-600">
                  No open vacancies — an applicant has to be added against one.{' '}
                  <Link href="/recruitment/vacancies/new" className="underline font-medium">Create a vacancy</Link>{' '}
                  or reopen a closed one first.
                </p>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Name<span className="text-red-600"> *</span></label>
            <input className={inputCls} value={form.name} onChange={set('name')} placeholder="Full name" autoFocus />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Email</label>
              <input type="email" className={inputCls} value={form.email} onChange={set('email')} placeholder="name@example.com" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Phone</label>
              <input className={inputCls} value={form.phone} onChange={set('phone')} placeholder="10-digit mobile" />
            </div>
          </div>
          {/* Matches the importer: a repeat applicant on the same vacancy is matched on
              email, or on phone when there's no email. */}
          <p className="text-xs text-secondary -mt-1">
            Email or phone is used to spot someone who has already applied to this vacancy.
          </p>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Address</label>
            <input className={inputCls} value={form.address} onChange={set('address')} placeholder="City or full address" />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Resume link</label>
            <input className={inputCls} value={form.resume_url} onChange={set('resume_url')} placeholder="https://…" />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Notes</label>
            <textarea rows={2} className={`${inputCls} resize-none`} value={form.notes} onChange={set('notes')} placeholder="Optional" />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-border">
          <p className="text-xs text-secondary">Enters the funnel at Shortlisting.</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors">
              Cancel
            </button>
            <button
              onClick={() => mutation.mutate()}
              disabled={!canSubmit || mutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {mutation.isPending && <Loader2 size={14} className="animate-spin" />} Add Applicant
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
