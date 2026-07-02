'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import Breadcrumb from '@/components/ui/Breadcrumb';
import { Check, X, Clock, Calendar } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function LeaveApprovalsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [viewMode, setViewMode] = useState<'pending' | 'all'>('pending');
  const [statusFilter, setStatusFilter] = useState('');
  const [propertyFilter, setPropertyFilter] = useState('');

  const { data: pending = [] } = useQuery({
    queryKey: ['leave-approvals'],
    queryFn: () => api.get('/leave/approvals').then(r => r.data),
    enabled: viewMode === 'pending',
  });

  const { data: allLeaves = [] } = useQuery({
    queryKey: ['all-leaves', statusFilter, propertyFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (propertyFilter) params.set('property_id', propertyFilter);
      return api.get(`/leave/all?${params}`).then(r => r.data);
    },
    enabled: viewMode === 'all',
  });

  const { data: properties = [] } = useQuery({
    queryKey: ['properties'],
    queryFn: () => api.get('/admin/properties').then(r => r.data),
    enabled: viewMode === 'all',
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => api.put(`/leave/${id}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['all-leaves'] });
      toast.success('Leave approved');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to approve'),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      api.put(`/leave/${id}/reject`, { rejection_reason: reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['all-leaves'] });
      toast.success('Leave rejected');
      setRejectingId(null);
      setRejectionReason('');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to reject'),
  });

  const STATUS_COLORS: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-700',
    approved: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-700',
    cancelled: 'bg-gray-100 text-gray-500',
  };

  const renderLeaveCard = (leave: any, showActions: boolean) => (
    <div key={leave.id} className="p-4 flex items-start justify-between gap-4">
      <div className="flex items-start gap-4 min-w-0">
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
          {leave.first_name[0]}{leave.last_name[0]}
        </div>
        <div className="min-w-0">
          <p className="font-medium text-foreground">{leave.first_name} {leave.last_name}</p>
          <p className="text-xs text-secondary">{leave.employee_code} &middot; {leave.department_name} &middot; {leave.property_name}</p>
          <div className="mt-2 flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-foreground">{leave.leave_type}</span>
            <span className="text-sm text-secondary">
              {new Date(leave.start_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              {leave.start_date !== leave.end_date && ` — ${new Date(leave.end_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
            </span>
            <span className="text-xs px-2 py-0.5 bg-muted rounded-full">{leave.days} day{leave.days > 1 ? 's' : ''}</span>
          </div>
          {leave.reason && <p className="text-sm text-secondary mt-1">{leave.reason}</p>}
          {leave.rejection_reason && <p className="text-sm text-red-600 mt-1">Reason: {leave.rejection_reason}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {!showActions && (
          <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[leave.status]}`}>
            {leave.status}
          </span>
        )}
        {showActions && leave.status === 'pending' && (
          <>
            {rejectingId === leave.id ? (
              <div className="flex items-center gap-2">
                <input
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="Reason (optional)"
                  className="px-2 py-1.5 border border-border rounded-lg text-xs w-40 focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
                <button
                  onClick={() => rejectMutation.mutate({ id: leave.id, reason: rejectionReason })}
                  className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium"
                >
                  Confirm
                </button>
                <button onClick={() => { setRejectingId(null); setRejectionReason(''); }} className="text-xs text-secondary">
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={() => approveMutation.mutate(leave.id)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700"
                >
                  <Check size={12} /> Approve
                </button>
                <button
                  onClick={() => setRejectingId(leave.id)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700"
                >
                  <X size={12} /> Reject
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Breadcrumb className="mb-2" items={[{ label: 'Admin', href: '/admin' }, { label: 'Leave Approvals' }]} />
            <h1 className="text-2xl font-bold text-foreground">Leave Approvals</h1>
            <p className="text-secondary mt-1">Review and manage leave requests</p>
          </div>
        </div>

        {/* View Toggle */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex gap-1 bg-muted p-1 rounded-lg">
            <button
              onClick={() => setViewMode('pending')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${viewMode === 'pending' ? 'bg-card text-foreground shadow-sm' : 'text-secondary hover:text-foreground'}`}
            >
              Pending ({pending.length})
            </button>
            <button
              onClick={() => setViewMode('all')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${viewMode === 'all' ? 'bg-card text-foreground shadow-sm' : 'text-secondary hover:text-foreground'}`}
            >
              All Requests
            </button>
          </div>
          {viewMode === 'all' && (
            <>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 border border-border rounded-lg bg-background text-sm"
              >
                <option value="">All Status</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <select
                value={propertyFilter}
                onChange={(e) => setPropertyFilter(e.target.value)}
                className="px-3 py-2 border border-border rounded-lg bg-background text-sm"
              >
                <option value="">All Properties</option>
                {properties.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </>
          )}
        </div>

        {/* Pending View */}
        {viewMode === 'pending' && (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            {pending.length === 0 ? (
              <div className="p-8 text-center text-secondary">
                <Clock size={32} className="mx-auto mb-2 opacity-40" />
                <p>No pending leave requests.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {pending.map((leave: any) => renderLeaveCard(leave, true))}
              </div>
            )}
          </div>
        )}

        {/* All View */}
        {viewMode === 'all' && (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            {allLeaves.length === 0 ? (
              <div className="p-8 text-center text-secondary">
                <Calendar size={32} className="mx-auto mb-2 opacity-40" />
                <p>No leave requests found.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {allLeaves.map((leave: any) => renderLeaveCard(leave, leave.status === 'pending'))}
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
