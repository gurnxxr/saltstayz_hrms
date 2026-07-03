'use client';

import AppShell from '@/components/layout/AppShell';
import Breadcrumb from '@/components/ui/Breadcrumb';
import { Landmark } from 'lucide-react';

export default function StatutoryComponentsPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <Breadcrumb items={[{ label: 'Setup & Configuration' }, { label: 'Statutory Components' }]} />
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><Landmark className="text-primary" size={20} /></div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Statutory Components</h1>
            <p className="text-secondary text-sm">PF, ESI, LWF, bonus and other statutory rates — effective-dated and editable.</p>
          </div>
        </div>

        <div className="bg-card rounded-xl border border-dashed border-border p-10 text-center text-secondary text-sm">
          This section is being set up. Share the Statutory Components requirements and it will be built here.
        </div>
      </div>
    </AppShell>
  );
}
