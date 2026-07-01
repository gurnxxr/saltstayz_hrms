'use client';

import { useState } from 'react';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/lib/auth';
import { Calendar, ClipboardCheck } from 'lucide-react';
import LeaveTab from '@/components/attendance/LeaveTab';
import AttendanceCalendar from '@/components/attendance/AttendanceCalendar';

type TopTab = 'leave' | 'attendance';

export default function LeaveAttendancePage() {
  const { user } = useAuth();
  const isAdmin = user?.roleName === 'admin';
  const [topTab, setTopTab] = useState<TopTab>('leave');

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Page Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">Leave & Attendance</h1>
          <p className="text-secondary mt-1">Manage your leaves and track attendance</p>
        </div>

        {/* Top-level Tabs */}
        <div className="border-b border-border">
          <div className="flex gap-6">
            <button
              onClick={() => setTopTab('leave')}
              className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${
                topTab === 'leave'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-secondary hover:text-foreground'
              }`}
            >
              <span className="flex items-center gap-2">
                <Calendar size={16} />
                Leave Management
              </span>
            </button>
            <button
              onClick={() => setTopTab('attendance')}
              className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${
                topTab === 'attendance'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-secondary hover:text-foreground'
              }`}
            >
              <span className="flex items-center gap-2">
                <ClipboardCheck size={16} />
                Attendance
              </span>
            </button>
          </div>
        </div>

        {topTab === 'leave' && <LeaveTab isAdmin={isAdmin} />}
        {topTab === 'attendance' && <AttendanceCalendar />}
      </div>
    </AppShell>
  );
}
