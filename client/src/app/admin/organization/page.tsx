'use client';

import { useState } from 'react';
import AppShell from '@/components/layout/AppShell';
import { ArrowLeft, Building2, Layers, Briefcase, Tag, DollarSign, BadgeCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { PropertiesTab, SimpleListTab, PayGradesTab } from '@/components/admin/OrgTabs';

type Tab = 'properties' | 'departments' | 'job-titles' | 'categories' | 'pay-grades' | 'statuses';

const TABS: { key: Tab; label: string; icon: typeof Building2 }[] = [
  { key: 'properties', label: 'Properties', icon: Building2 },
  { key: 'departments', label: 'Departments', icon: Layers },
  { key: 'job-titles', label: 'Job Titles', icon: Briefcase },
  { key: 'categories', label: 'Categories', icon: Tag },
  { key: 'pay-grades', label: 'Pay Grades', icon: DollarSign },
  { key: 'statuses', label: 'Statuses', icon: BadgeCheck },
];

export default function OrganizationPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('properties');

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <button
            onClick={() => router.push('/admin')}
            className="flex items-center gap-2 text-secondary hover:text-foreground text-sm transition-colors mb-2"
          >
            <ArrowLeft size={16} /> Back to Admin
          </button>
          <h1 className="text-2xl font-bold text-foreground">Organization Structure</h1>
          <p className="text-secondary mt-1">Manage properties, departments, job titles, and more</p>
        </div>

        <div className="flex gap-1 bg-muted p-1 rounded-lg flex-wrap">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                tab === t.key ? 'bg-card text-foreground shadow-sm' : 'text-secondary hover:text-foreground'
              }`}
            >
              <t.icon size={14} />
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'properties' && <PropertiesTab />}
        {tab === 'departments' && <SimpleListTab endpoint="departments" label="Department" fieldName="name" queryKey="org-departments" />}
        {tab === 'job-titles' && <SimpleListTab endpoint="job-titles" label="Job Title" fieldName="title" queryKey="org-job-titles" />}
        {tab === 'categories' && <SimpleListTab endpoint="employee-categories" label="Category" fieldName="name" queryKey="org-categories" />}
        {tab === 'pay-grades' && <PayGradesTab />}
        {tab === 'statuses' && <SimpleListTab endpoint="employment-statuses" label="Status" fieldName="name" queryKey="org-statuses" />}
      </div>
    </AppShell>
  );
}
