'use client';

import AppShell from '@/components/layout/AppShell';
import AttendanceCalendar from '@/components/attendance/AttendanceCalendar';

export default function AttendancePage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Attendance</h1>
          <p className="text-secondary mt-1">Track your attendance</p>
        </div>

        <AttendanceCalendar />
      </div>
    </AppShell>
  );
}
