'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// "Application" was merged into the single Leaves page. Redirect old links to the
// Approvals tab there.
export default function LeaveApplicationRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/leaves/my?tab=approvals'); }, [router]);
  return null;
}
