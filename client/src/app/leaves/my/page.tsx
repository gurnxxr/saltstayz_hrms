'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import AppShell from '@/components/layout/AppShell';
import Tabs, { type TabItem } from '@/components/ui/Tabs';
import { btnCls } from '@/components/ui/styles';
import api from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import MyLeave from '@/components/leaves/MyLeave';
import LeaveApprovals from '@/components/leaves/LeaveApprovals';
import MyHolidays from '@/components/leaves/MyHolidays';
import { CalendarCheck, CheckSquare, CalendarDays, Plus } from 'lucide-react';

const TABS = ['mine', 'approvals', 'holidays'] as const;
type Tab = (typeof TABS)[number];
const isTab = (v: string | null): v is Tab => !!v && (TABS as readonly string[]).includes(v);

// The merged Leaves page: My Leave (everyone), Approvals (anyone who can approve), Holidays
// (everyone). Replaces the old separate "My Leave" and "Application" pages.
export default function LeavesPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        {/* Apply lives in the header, beside the title, on all three tabs — the same place
            Encashment puts "New Encashment". It used to sit inside the My Leave tab body in its
            own right-aligned row, so the module's primary action moved depending on which tab you
            were on, and a manager reviewing Approvals had to change tab before they could apply. */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Leaves</h1>
            <p className="text-secondary mt-1">
              Apply for leave, track your requests, and see the holidays that apply to you.
            </p>
          </div>
          <Link href="/leaves/apply" className={btnCls('primary')}>
            <Plus size={16} /> Apply Leave
          </Link>
        </div>

        {/* useSearchParams opts its subtree out of the static prerender, so it needs a boundary.
            Only the tab bar and the panels sit inside it — the heading and the Apply button
            prerender, so nothing above the tabs can move while this resolves. */}
        <Suspense fallback={<div className="h-11 w-80 bg-muted rounded-lg animate-pulse" />}>
          <LeaveTabs />
        </Suspense>
      </div>
    </AppShell>
  );
}

function LeaveTabs() {
  const router = useRouter();
  const params = useSearchParams();
  const { isAdmin, isCHRO, isHR, isPM, managesAnyone } = usePermissions();
  const isStaff = isAdmin || isCHRO || isHR;

  /*
   * A capability, not a row count.
   *
   * This used to be `isStaff || pending.length > 0`, which conflated "can this person approve" with
   * "does this person have something to approve right now". Three things followed: a line manager
   * with an empty queue had no Approvals tab AT ALL — no way to look at what they had already
   * decided; the tab materialised under the cursor when the query landed, shifting the tabs beside
   * it; and the "leave request submitted" notification, which deep-links to ?tab=approvals, fell
   * back to My Leave with no explanation because `pending` had not resolved yet.
   *
   * `managesAnyone` comes from /session-context, which AuthProvider resolves before AppShell paints,
   * so this is right on the first frame. It cannot be derived here: `employee` is a role and says
   * nothing about who reports to you, and leave has no 'approve' permission for can() to test.
   */
  const canApprove = isStaff || isPM || managesAnyone;

  const { data: pending = [] } = useQuery({
    queryKey: ['leave-approvals'],
    queryFn: () => api.get('/leave/approvals').then(r => r.data),
    // Everyone used to fire this on load purely to decide whether to draw a tab. Now only people
    // who can actually approve ask for it.
    enabled: canApprove,
  });

  const requested = params.get('tab');
  // An unknown ?tab= — a typo, a stale link, or ?tab=approvals for somebody who cannot approve —
  // falls back to My Leave. The URL is left alone: rewriting it in an effect would cost a history
  // entry and a second paint to tidy a case nobody hits twice.
  const tab: Tab =
    isTab(requested) && !(requested === 'approvals' && !canApprove) ? requested : 'mine';

  function go(next: Tab) {
    if (next === tab) return; // never stack a duplicate history entry
    const qs = new URLSearchParams(params.toString());
    qs.set('tab', next);
    // push, not replace: these are the page's primary navigation, so Back should undo a tab switch.
    // A manager follows the notification to Approvals, checks a date on Holidays, hits Back — they
    // expect Approvals, not whatever page they were on before this one.
    //
    // scroll: false because AppShell scrolls <main> rather than the window, and MyHolidays parks
    // itself on the current month — a scroll reset would undo that on every tab change.
    router.push(`/leaves/my?${qs}`, { scroll: false });
  }

  const items: TabItem<Tab>[] = [
    { key: 'mine', label: 'My Leave', icon: CalendarCheck },
    ...(canApprove
      ? [{ key: 'approvals' as const, label: 'Approvals', icon: CheckSquare, count: pending.length }]
      : []),
    { key: 'holidays', label: 'Holidays', icon: CalendarDays },
  ];

  return (
    <>
      <Tabs value={tab} onChange={go} items={items} />

      {tab === 'mine' && <MyLeave />}
      {tab === 'approvals' && canApprove && <LeaveApprovals canFilterAll={isStaff} />}
      {tab === 'holidays' && <MyHolidays />}
    </>
  );
}
