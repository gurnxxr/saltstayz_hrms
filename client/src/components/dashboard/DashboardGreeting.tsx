'use client';

import { useAuth } from '@/lib/auth';

/** A friendly display name from an email handle when no employee record is linked. */
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
 * Personalised dashboard header: greets the signed-in user by first name with a
 * time-of-day message. The name comes from the auth session itself (/auth/me and the
 * login payload carry the linked employee's first_name), so there is no extra fetch
 * here and nothing user-specific cached outside the auth state — cross-user cache
 * safety lives in one place: the queryClient.clear() on login/logout in lib/auth.tsx.
 * `suppressHydrationWarning` because the greeting depends on the client's clock and
 * the client-side session.
 */
export default function DashboardGreeting({ subtitle }: { subtitle?: string }) {
  const { user } = useAuth();
  const name = user?.firstName?.trim() || nameFromEmail(user?.email);

  return (
    <div>
      <h1 suppressHydrationWarning className="text-2xl font-bold text-foreground">
        Good {partOfDay()}, {name}! <span aria-hidden="true">👋</span>
      </h1>
      <p className="text-secondary mt-1">{subtitle ?? 'Here’s your workspace at a glance.'}</p>
    </div>
  );
}
