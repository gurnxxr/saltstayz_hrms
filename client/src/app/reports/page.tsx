'use client';

import AppShell from '@/components/layout/AppShell';

export default function ReportsPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Reports</h1>
          <p className="text-secondary mt-1">Employee report generation</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-8 text-center">
          <p className="text-secondary">This module is under development.</p>
        </div>
      </div>
    </AppShell>
  );
}
