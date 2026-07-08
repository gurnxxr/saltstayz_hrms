'use client';

import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/lib/auth';
import LeaveTab from '@/components/attendance/LeaveTab';

export default function MyLeavePage() {
  const { user } = useAuth();
  const isAdmin = user?.roleName === 'admin';

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">My Leave</h1>
          <p className="text-secondary mt-1">Your leave balances, requests, and holidays</p>
        </div>

        <LeaveTab isAdmin={isAdmin} />
      </div>
    </AppShell>
  );
}
