'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import {
  Plus, Calendar, Clock, CheckCircle, XCircle, AlertCircle,
  CalendarDays, Upload, Trash2, Loader2, FileSpreadsheet,
} from 'lucide-react';

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
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const { data: holidays = [], isLoading: holidaysLoading } = useQuery({
    queryKey: ['holidays'],
    queryFn: () => api.get('/leave/holidays').then(r => r.data),
    enabled: leaveSubTab === 'holidays',
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

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return api.post('/leave/holidays/upload-csv', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }).then(r => r.data);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['holidays'] });
      toast.success(`${data.inserted} holidays uploaded successfully`);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Upload failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/leave/holidays/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['holidays'] });
      toast.success('Holiday deleted');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Delete failed'),
  });

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.csv')) {
      toast.error('Please upload a .csv file');
      return;
    }
    uploadMutation.mutate(file);
  }

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
      {leaveSubTab === 'holidays' && (
        <div className="space-y-4">
          {isAdmin && (
            <div className="bg-card rounded-xl border border-border p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Upload Holiday List</h3>
                  <p className="text-xs text-secondary mt-1">Upload a CSV file with columns: Holiday Name, Date (DD-MM-YYYY). This will replace all existing holidays.</p>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadMutation.isPending}
                    className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                  >
                    {uploadMutation.isPending ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Upload size={16} />
                    )}
                    {uploadMutation.isPending ? 'Uploading...' : 'Upload CSV'}
                  </button>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg">
                <FileSpreadsheet size={14} className="text-secondary" />
                <p className="text-xs text-secondary">Example: <code className="bg-muted px-1 py-0.5 rounded text-xs">Holiday Name,Date</code> &rarr; <code className="bg-muted px-1 py-0.5 rounded text-xs">Republic Day,26-01-2026</code></p>
              </div>
            </div>
          )}

          <div className="bg-card rounded-xl border border-border overflow-hidden">
            {holidaysLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : holidays.length === 0 ? (
              <div className="p-8 text-center text-secondary">
                <CalendarDays size={32} className="mx-auto mb-2 opacity-40" />
                <p>No holidays configured.</p>
                {isAdmin && <p className="text-xs mt-1">Upload a CSV to add holidays.</p>}
              </div>
            ) : (
              <>
                <div className="px-4 py-3 bg-muted/50 border-b border-border flex items-center justify-between">
                  <p className="text-sm font-semibold text-foreground">{holidays.length} Holidays</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Holiday Name</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Date</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Day</th>
                        {isAdmin && <th className="text-right px-4 py-3 text-xs font-semibold text-secondary uppercase">Actions</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {holidays.map((h: any) => (
                        <tr key={h.id} className="hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center text-orange-600">
                                <CalendarDays size={16} />
                              </div>
                              <span className="text-sm font-medium text-foreground">{h.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-foreground">
                            {new Date(h.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                          </td>
                          <td className="px-4 py-3 text-sm text-secondary">
                            {new Date(h.date).toLocaleDateString('en-IN', { weekday: 'long' })}
                          </td>
                          {isAdmin && (
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={() => deleteMutation.mutate(h.id)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              >
                                <Trash2 size={12} /> Delete
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
