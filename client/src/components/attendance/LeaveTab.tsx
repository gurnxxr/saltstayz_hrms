'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import {
  Plus, Calendar, Clock, CheckCircle, XCircle, AlertCircle,
} from 'lucide-react';
import HolidaysPanel from '@/components/attendance/HolidaysPanel';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

const STATUS_ICONS: Record<string, typeof Clock> = {
  pending: Clock,
  approved: CheckCircle,
  rejected: XCircle,
  cancelled: AlertCircle,
};

export default function LeaveTab({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [leaveSubTab, setLeaveSubTab] = useState<'requests' | 'holidays'>('requests');
  const [statusFilter, setStatusFilter] = useState('');

  const { data: balances = [] } = useQuery({
    queryKey: ['leave-balances'],
    queryFn: () => api.get('/leave/balances').then(r => r.data),
  });

  const { data: leaves = [] } = useQuery({
    queryKey: ['my-leaves', statusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      return api.get(`/leave/my?${params}`).then(r => r.data);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => api.put(`/leave/${id}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-leaves'] });
      queryClient.invalidateQueries({ queryKey: ['leave-balances'] });
      toast.success('Leave request cancelled');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to cancel'),
  });

  return (
    <div className="space-y-6">
      {/* Action Buttons */}
      <div className="flex justify-end gap-3">
        <button
          onClick={() => router.push('/attendance/leave/apply')}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus size={16} />
          Apply Leave
        </button>
      </div>

      {/* Leave Balances */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {balances.map((b: any) => {
          const remaining = b.total_days - b.used_days;
          const pct = b.total_days > 0 ? (b.used_days / b.total_days) * 100 : 0;
          return (
            <div key={b.id} className="bg-card rounded-xl border border-border p-4">
              <p className="text-xs font-medium text-secondary truncate">{b.leave_type}</p>
              <div className="mt-2 flex items-end gap-1">
                <span className="text-2xl font-bold text-foreground">{remaining}</span>
                <span className="text-xs text-secondary mb-1">/ {b.total_days}</span>
              </div>
              <div className="mt-2 w-full h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-yellow-500' : 'bg-green-500'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-xs text-secondary mt-1">{b.used_days} used</p>
            </div>
          );
        })}
      </div>

      {/* Leave Sub-tabs */}
      <div className="flex items-center gap-4">
        <div className="flex gap-1 bg-muted p-1 rounded-lg">
          <button
            onClick={() => setLeaveSubTab('requests')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${leaveSubTab === 'requests' ? 'bg-card text-foreground shadow-sm' : 'text-secondary hover:text-foreground'}`}
          >
            My Requests
          </button>
          <button
            onClick={() => setLeaveSubTab('holidays')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${leaveSubTab === 'holidays' ? 'bg-card text-foreground shadow-sm' : 'text-secondary hover:text-foreground'}`}
          >
            Holidays
          </button>
        </div>
        {leaveSubTab === 'requests' && (
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
        )}
      </div>

      {/* Requests Sub-tab */}
      {leaveSubTab === 'requests' && (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {leaves.length === 0 ? (
            <div className="p-8 text-center text-secondary">
              <Calendar size={32} className="mx-auto mb-2 opacity-40" />
              <p>No leave requests found.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {leaves.map((leave: any) => {
                const Icon = STATUS_ICONS[leave.status] || Clock;
                return (
                  <div key={leave.id} className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${STATUS_COLORS[leave.status]}`}>
                        <Icon size={18} />
                      </div>
                      <div>
                        <p className="font-medium text-foreground">{leave.leave_type}</p>
                        <p className="text-sm text-secondary">
                          {new Date(leave.start_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                          {leave.start_date !== leave.end_date && ` — ${new Date(leave.end_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                          {' '}&middot; {leave.days} day{leave.days > 1 ? 's' : ''}
                        </p>
                        {leave.reason && <p className="text-xs text-secondary mt-0.5 line-clamp-1">{leave.reason}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {leave.rejection_reason && (
                        <p className="text-xs text-red-600 max-w-48 truncate" title={leave.rejection_reason}>
                          {leave.rejection_reason}
                        </p>
                      )}
                      {leave.approved_by_name && leave.status !== 'pending' && (
                        <p className="text-xs text-secondary">by {leave.approved_by_name}</p>
                      )}
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[leave.status]}`}>
                        {leave.status}
                      </span>
                      {leave.status === 'pending' && (
                        <button
                          onClick={() => cancelMutation.mutate(leave.id)}
                          className="text-xs px-3 py-1 border border-red-200 text-red-600 rounded-lg hover:bg-red-50"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Holidays Sub-tab */}
      {leaveSubTab === 'holidays' && <HolidaysPanel isAdmin={isAdmin} />}
    </div>
  );
}
