'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import LeaveTab from '@/components/attendance/LeaveTab';
import LeaveApprovals from '@/components/leaves/LeaveApprovals';
import MyHolidays from '@/components/leaves/MyHolidays';

// Merged Leaves page: Apply/My Leave (everyone), Approvals (managers + HR/Admin),
// Holidays (everyone). Replaces the old separate "My Leave" and "Application" pages.
export default function LeavesPage() {
  const { isAdmin, isCHRO, isHR } = usePermissions();
  const isStaff = isAdmin || isCHRO || isHR;
  const [tab, setTab] = useState<'mine' | 'approvals' | 'holidays'>('mine');

  // Deep-link support (e.g. the "leave to review" notification → ?tab=approvals).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'approvals') setTab('approvals');
    else if (t === 'holidays') setTab('holidays');
  }, []);

  // Approvals appear for HR/Admin/CHRO, or a reporting manager who has pending
  // reports (the endpoint returns only their reports, empty otherwise).
  const { data: pending = [] } = useQuery({
    queryKey: ['leave-approvals'],
    queryFn: () => api.get('/leave/approvals').then(r => r.data),
  });
  const canApprove = isStaff || pending.length > 0;
  const activeTab = tab === 'approvals' && !canApprove ? 'mine' : tab;

  const tabCls = (active: boolean) =>
    `px-4 py-2 rounded-md text-sm font-medium transition-colors ${active ? 'bg-card text-foreground shadow-sm' : 'text-secondary hover:text-foreground'}`;

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Leaves</h1>
          <p className="text-secondary mt-1">
            Apply for leave{canApprove ? ', review requests,' : ''} and see the holidays that apply to you.
          </p>
        </div>

        <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit">
          <button onClick={() => setTab('mine')} className={tabCls(activeTab === 'mine')}>My Leave</button>
          {canApprove && (
            <button onClick={() => setTab('approvals')} className={tabCls(activeTab === 'approvals')}>
              Approvals{pending.length ? ` (${pending.length})` : ''}
            </button>
          )}
          <button onClick={() => setTab('holidays')} className={tabCls(activeTab === 'holidays')}>Holidays</button>
        </div>

        {activeTab === 'mine' && <LeaveTab />}
        {activeTab === 'approvals' && canApprove && <LeaveApprovals canFilterAll={isStaff} />}
        {activeTab === 'holidays' && <MyHolidays />}
      </div>
    </AppShell>
  );
}
