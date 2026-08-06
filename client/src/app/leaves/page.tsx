import { redirect } from 'next/navigation';

/**
 * /leaves had no page at all, and live notifications link straight to it: "your leave was
 * approved" and "…was rejected" (leave.service). NotificationBell does router.push(n.link), so
 * employees and managers have been landing on a 404 from the bell.
 *
 * Both are about a REQUEST, so the module's home is the self-service screen. Balances and Control
 * Panel are places you go on purpose from the sidebar — never somewhere a notification should drop
 * you — so no role is read here and there is nothing to get wrong per role.
 *
 * A Server Component on purpose. The 'use client' + useEffect shape used elsewhere paints an empty
 * frame before it redirects; this resolves before any HTML ships.
 */
export default function LeavesIndex() {
  redirect('/leaves/my');
}
