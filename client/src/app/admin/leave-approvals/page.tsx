'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Leave approvals moved to the Leaves module (Leaves → Application).
export default function LeaveApprovalsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/leaves/application'); }, [router]);
  return null;
}
