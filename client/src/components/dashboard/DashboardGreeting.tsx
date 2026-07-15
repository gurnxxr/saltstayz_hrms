'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import api from '@/lib/api';

/** A friendly display name from an email handle when we have no employee record. */
function nameFromEmail(email?: string) {
  if (!email) return 'there';
  const handle = (email.split('@')[0] || '').split(/[._+-]/)[0].replace(/[0-9]+/g, '');
  return handle ? handle.charAt(0).toUpperCase() + handle.slice(1) : 'there';
}

function partOfDay() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

/**
 * Personalised dashboard header: greets the signed-in user by their first name
 * (from their employee record, falling back to their email handle) with a
 * time-of-day message. `suppressHydrationWarning` because the greeting depends on
 * the client's clock and the client-side auth session.
 */
export default function DashboardGreeting({ subtitle }: { subtitle?: string }) {
  const { user } = useAuth();

  const { data: me } = useQuery({
    // Keyed by user id so a different sign-in never reuses the previous person's name.
    queryKey: ['me-greeting-name', user?.userId],
    queryFn: () => api.get('/employees/me').then((r) => r.data).catch(() => null),
    enabled: !!user?.employeeId,
    staleTime: 5 * 60 * 1000,
  });

  const name = (me?.first_name && String(me.first_name).trim()) || nameFromEmail(user?.email);

  return (
    <div>
      <h1 suppressHydrationWarning className="text-2xl font-bold text-foreground">
        Good {partOfDay()}, {name}! <span aria-hidden="true">👋</span>
      </h1>
      <p className="text-secondary mt-1">{subtitle ?? 'Here’s your workspace at a glance.'}</p>
    </div>
  );
}
