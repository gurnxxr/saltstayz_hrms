'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import {
  ClipboardList, FileText, Users, CheckCircle, Plus, Search,
  UserCheck, Download, Check, X, Loader2, IndianRupee,
} from 'lucide-react';

const OFFER_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  sent: 'bg-blue-100 text-blue-700',
  accepted: 'bg-green-100 text-green-700',
  declined: 'bg-red-100 text-red-700',
};
const OFFER_STATUS_LABELS: Record<string, string> = {
  pending: 'Awaiting offer', sent: 'Offer sent', accepted: 'Accepted', declined: 'Declined',
};

export default function OnboardingPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'offers' | 'checklists' | 'offer-letters'>('offers');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Offer-flow UI state
  const [offerModal, setOfferModal] = useState<{ id: number; name: string } | null>(null);
  const [joiningDate, setJoiningDate] = useState('');
  const [confirmAction, setConfirmAction] = useState<{ type: 'accept' | 'decline'; id: number; name: string } | null>(null);

  const { data: stats } = useQuery({
    queryKey: ['onboarding-stats'],
    queryFn: () => api.get('/onboarding/stats').then(r => r.data),
  });

  const { data: offerCandidates = [] } = useQuery({
    queryKey: ['offer-candidates'],
    queryFn: () => api.get('/onboarding/offer-candidates').then(r => r.data),
    enabled: tab === 'offers',
  });

  const { data: checklists = [] } = useQuery({
    queryKey: ['onboarding-checklists', search, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      return api.get(`/onboarding/checklists?${params}`).then(r => r.data);
    },
    enabled: tab === 'checklists',
  });

  const { data: offerLetters = [] } = useQuery({
    queryKey: ['offer-letters'],
    queryFn: () => api.get('/onboarding/offer-letters').then(r => r.data),
    enabled: tab === 'offer-letters',
  });

  const { data: offerReady = [] } = useQuery({
    queryKey: ['offer-ready'],
    queryFn: () => api.get('/onboarding/offer-ready').then(r => r.data),
    enabled: tab === 'offer-letters',
  });

  const invalidateOffers = () => {
    queryClient.invalidateQueries({ queryKey: ['offer-candidates'] });
    queryClient.invalidateQueries({ queryKey: ['onboarding-stats'] });
    queryClient.invalidateQueries({ queryKey: ['onboarding-checklists'] });
    queryClient.invalidateQueries({ queryKey: ['offer-letters'] });
  };

  const generateMutation = useMutation({
    mutationFn: ({ id, joining_date }: { id: number; joining_date: string }) =>
      api.post(`/onboarding/offer-candidates/${id}/offer`, { joining_date }),
    onSuccess: () => {
      invalidateOffers();
      toast.success('Offer letter generated');
      setOfferModal(null);
      setJoiningDate('');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to generate offer'),
  });

  const acceptMutation = useMutation({
    mutationFn: (id: number) => api.post(`/onboarding/offer-candidates/${id}/accept`),
    onSuccess: () => { invalidateOffers(); toast.success('Offer accepted — document collection started'); setConfirmAction(null); },
    onError: (e: any) => { toast.error(e.response?.data?.error || 'Failed to accept offer'); setConfirmAction(null); },
  });

  const declineMutation = useMutation({
    mutationFn: (id: number) => api.post(`/onboarding/offer-candidates/${id}/decline`),
    onSuccess: () => { invalidateOffers(); toast.success('Offer marked declined'); setConfirmAction(null); },
    onError: (e: any) => { toast.error(e.response?.data?.error || 'Failed to decline offer'); setConfirmAction(null); },
  });


  async function downloadOfferPdf(candidateId: number, name: string) {
    try {
      const res = await api.get(`/onboarding/offer-candidates/${candidateId}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `Offer_Letter_${name.replace(/\s+/g, '_')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to download offer letter');
    }
  }

  const statCards = [
    { label: 'Offers Pending', value: (stats?.offersPending ?? 0) + (stats?.offersSent ?? 0), icon: UserCheck, color: 'text-amber-600 bg-amber-50' },
    { label: 'In Onboarding', value: stats?.inProgress ?? 0, icon: Users, color: 'text-orange-600 bg-orange-50' },
    { label: 'Completed', value: stats?.completed ?? 0, icon: CheckCircle, color: 'text-green-600 bg-green-50' },
    { label: 'Offer Letters', value: stats?.offerLetters ?? 0, icon: FileText, color: 'text-purple-600 bg-purple-50' },
  ];

  const STATUS_COLORS: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-700',
    in_progress: 'bg-blue-100 text-blue-700',
    completed: 'bg-green-100 text-green-700',
  };

  const tabBtn = (key: typeof tab, label: string) => (
    <button
      onClick={() => setTab(key)}
      className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
        tab === key ? 'bg-card text-foreground shadow-sm' : 'text-secondary hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Onboarding</h1>
          <p className="text-secondary mt-1">Offer letters, acceptance, and new-hire document collection</p>
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {statCards.map(card => (
            <div key={card.label} className="bg-card rounded-xl border border-border p-5">
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-lg ${card.color}`}>
                  <card.icon size={20} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{card.value}</p>
                  <p className="text-sm text-secondary">{card.label}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-muted p-1 rounded-lg w-fit">
          {tabBtn('offers', 'Offer Candidates')}
          {tabBtn('checklists', 'Onboarding')}
          {tabBtn('offer-letters', 'Offer Letters')}
        </div>

        {/* Offer Candidates Tab */}
        {tab === 'offers' && (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            {offerCandidates.length === 0 ? (
              <div className="p-10 text-center text-secondary">
                <UserCheck size={28} className="mx-auto opacity-30 mb-2" />
                No candidates offered yet. Mark a candidate <b>Offered</b> in Recruitment to start here.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Candidate</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Designation</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Property</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">CTC</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Status</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-secondary uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {offerCandidates.map((c: any) => (
                      <tr key={c.id} className={`hover:bg-muted/30 ${c.offer_status === 'declined' ? 'opacity-60' : ''}`}>
                        <td className="px-4 py-3">
                          <p className="text-sm font-medium text-foreground">{c.name}</p>
                          <p className="text-xs text-secondary">{c.email || c.phone || '—'}</p>
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">{c.designation}</td>
                        <td className="px-4 py-3 text-sm text-secondary">{c.property_name}</td>
                        <td className="px-4 py-3 text-sm text-secondary">{c.ctc_configured ? c.ctc_label : '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${OFFER_STATUS_COLORS[c.offer_status] || 'bg-gray-100 text-gray-700'}`}>
                            {OFFER_STATUS_LABELS[c.offer_status] || c.offer_status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            {c.offer_status === 'pending' && (
                              <button
                                onClick={() => { setOfferModal({ id: c.id, name: c.name }); setJoiningDate(''); }}
                                disabled={!c.ctc_configured}
                                title={c.ctc_configured ? '' : 'No salary structure for this designation'}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-50"
                              >
                                <FileText size={13} /> Generate Offer Letter
                              </button>
                            )}
                            {c.offer_status === 'sent' && (
                              <>
                                <button onClick={() => downloadOfferPdf(c.id, c.name)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-xs font-medium hover:bg-muted">
                                  <Download size={13} /> PDF
                                </button>
                                <button onClick={() => setConfirmAction({ type: 'accept', id: c.id, name: c.name })}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700">
                                  <Check size={13} /> Accept
                                </button>
                                <button onClick={() => setConfirmAction({ type: 'decline', id: c.id, name: c.name })}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-red-200 text-red-600 rounded-lg text-xs font-medium hover:bg-red-50">
                                  <X size={13} /> Decline
                                </button>
                              </>
                            )}
                            {c.offer_status === 'accepted' && (
                              <button onClick={() => router.push('/onboarding?tab=checklists')}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700">
                                <CheckCircle size={13} /> In onboarding
                              </button>
                            )}
                            {c.offer_status === 'declined' && <span className="text-xs text-secondary">—</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Checklists (Onboarding) Tab */}
        {tab === 'checklists' && (
          <>
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name or code..."
                  className="w-full pl-9 pr-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 border border-border rounded-lg bg-background text-sm"
              >
                <option value="">Active</option>
                <option value="pending">Pending</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
              </select>
            </div>

            <div className="bg-card rounded-xl border border-border overflow-hidden">
              {(() => {
                // "Active" (no filter) hides completed — those move to the Offer Letter tab.
                const visible = statusFilter ? checklists : checklists.filter((c: any) => c.status !== 'completed');
                return visible.length === 0 ? (
                  <div className="p-8 text-center text-secondary">
                    No {statusFilter ? statusFilter.replace('_', ' ') : 'active'} onboarding. Completed checklists move to <b>Offer Letter</b> to issue the letter.
                  </div>
                ) : (
                <div className="divide-y divide-border">
                  {visible.map((cl: any) => (
                    <div
                      key={cl.id}
                      onClick={() => router.push(`/onboarding/${cl.id}`)}
                      className="p-4 flex items-center justify-between hover:bg-muted/50 cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                          {cl.first_name?.[0]}{cl.last_name?.[0]}
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{cl.first_name} {cl.last_name}</p>
                          <p className="text-sm text-secondary">{cl.employee_code} &middot; {cl.dept_name} &middot; {cl.branch_name}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-sm font-medium text-foreground">{cl.completed_items}/{cl.total_items}</p>
                          <p className="text-xs text-secondary">items done</p>
                        </div>
                        <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${cl.total_items ? (cl.completed_items / cl.total_items) * 100 : 0}%` }}
                          />
                        </div>
                        <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[cl.status] || 'bg-gray-100 text-gray-700'}`}>
                          {cl.status.replace('_', ' ')}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                );
              })()}
            </div>
          </>
        )}

        {/* Offer Letters Tab */}
        {tab === 'offer-letters' && (
          <div className="space-y-6">
            {/* Ready for offer letter — onboarding complete, not yet issued */}
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-muted/30">
                <h3 className="text-sm font-semibold text-foreground">Ready for offer letter</h3>
                <p className="text-xs text-secondary">Employees who finished onboarding — generate their offer letter.</p>
              </div>
              {offerReady.length === 0 ? (
                <div className="p-8 text-center text-secondary text-sm">No one is waiting. An employee appears here once their onboarding checklist is complete.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Employee</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Designation</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Property</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">CTC</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-secondary uppercase">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {offerReady.map((e: any) => (
                        <tr key={e.employee_id} className="hover:bg-muted/30">
                          <td className="px-4 py-3">
                            <p className="text-sm font-medium text-foreground">{e.first_name} {e.last_name}</p>
                            <p className="text-xs text-secondary">{e.employee_code} &middot; {e.dept_name} &middot; {e.branch_name}</p>
                          </td>
                          <td className="px-4 py-3 text-sm text-foreground">{e.designation || '—'}</td>
                          <td className="px-4 py-3 text-sm text-secondary">{e.branch_name}</td>
                          <td className="px-4 py-3 text-sm text-secondary">{e.ctc_configured ? e.ctc_label : '—'}</td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => router.push(`/onboarding/offer-letter?employeeId=${e.employee_id}`)}
                              disabled={!e.ctc_configured}
                              title={e.ctc_configured ? '' : 'No salary structure for this designation'}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-50"
                            >
                              <FileText size={13} /> Generate Offer Letter
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Issued offer letters */}
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-muted/30">
                <h3 className="text-sm font-semibold text-foreground">Issued</h3>
              </div>
            {offerLetters.length === 0 ? (
              <div className="p-8 text-center text-secondary">No offer letters issued yet.</div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Employee</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Generated By</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-secondary uppercase">Date</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-secondary uppercase">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {offerLetters.map((ol: any) => (
                    <tr key={ol.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-foreground">{ol.first_name} {ol.last_name}</p>
                        <p className="text-xs text-secondary">{ol.employee_code}</p>
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground">{ol.generated_by_email}</td>
                      <td className="px-4 py-3 text-sm text-secondary">{new Date(ol.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => router.push(`/onboarding/offer-letter?id=${ol.id}`)}
                          className="text-xs px-3 py-1 border border-border rounded-lg hover:bg-muted"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            </div>
          </div>
        )}
      </div>

      {/* Generate offer modal */}
      {offerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOfferModal(null)}>
          <div className="bg-card rounded-xl border border-border w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <FileText size={18} className="text-primary" /> Generate Offer Letter
            </h3>
            <p className="text-sm text-secondary mt-1">For <b>{offerModal.name}</b>. Designation & CTC are pulled from the salary structure.</p>
            <label className="block text-sm font-medium text-foreground mt-4 mb-1">Date of Joining</label>
            <input type="date" value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setOfferModal(null)} className="px-4 py-2 border border-border rounded-lg text-sm">Cancel</button>
              <button
                onClick={() => generateMutation.mutate({ id: offerModal.id, joining_date: joiningDate })}
                disabled={!joiningDate || generateMutation.isPending}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {generateMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <IndianRupee size={15} />} Generate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Accept / Decline confirm */}
      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction?.type === 'accept' ? 'Accept offer?' : 'Decline offer?'}
        message={
          confirmAction?.type === 'accept'
            ? `This creates the employee record for ${confirmAction?.name} and starts document collection.`
            : `Mark ${confirmAction?.name}'s offer as declined? No employee record will be created.`
        }
        confirmLabel={confirmAction?.type === 'accept' ? 'Accept & Create' : 'Decline'}
        danger={confirmAction?.type === 'decline'}
        loading={acceptMutation.isPending || declineMutation.isPending}
        onConfirm={() => {
          if (!confirmAction) return;
          if (confirmAction.type === 'accept') acceptMutation.mutate(confirmAction.id);
          else declineMutation.mutate(confirmAction.id);
        }}
        onCancel={() => setConfirmAction(null)}
      />
    </AppShell>
  );
}
