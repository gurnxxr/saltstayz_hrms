'use client';

import AppShell from '@/components/layout/AppShell';
import Breadcrumb from '@/components/ui/Breadcrumb';
import { SlidersHorizontal } from 'lucide-react';

export default function LeaveControlPanelPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <Breadcrumb items={[{ label: 'Leaves' }, { label: 'Control Panel' }]} />

        <div>
          <h1 className="text-2xl font-bold text-foreground">Leave Control Panel</h1>
          <p className="text-secondary mt-1">Bulk-manage leave configuration and allocations.</p>
        </div>

        <div className="bg-card rounded-xl border border-border p-10 text-center">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <SlidersHorizontal className="w-6 h-6 text-primary" />
          </div>
          <p className="text-sm font-medium text-foreground">Leave Control Panel coming soon</p>
          <p className="text-sm text-secondary mt-1 max-w-md mx-auto">This section is being built.</p>
        </div>
      </div>
    </AppShell>
  );
}
