'use client';

import AppShell from '@/components/layout/AppShell';
import Breadcrumb from '@/components/ui/Breadcrumb';
import { Coins } from 'lucide-react';

export default function SalaryComponentsPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <Breadcrumb items={[{ label: 'Setup & Configuration' }, { label: 'Salary Components' }]} />
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><Coins className="text-primary" size={20} /></div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Salary Components</h1>
            <p className="text-secondary text-sm">Earnings and deductions that make up the salary structure.</p>
          </div>
        </div>

        <div className="bg-card rounded-xl border border-dashed border-border p-10 text-center text-secondary text-sm">
          This section is being set up. Share the Salary Components requirements and it will be built here.
        </div>
      </div>
    </AppShell>
  );
}
