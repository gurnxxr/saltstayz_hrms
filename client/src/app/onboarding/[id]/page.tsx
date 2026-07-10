'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Onboarding checklists were folded into Recruitment. Redirect old checklist links to
// the Recruitment pipeline.
export default function OnboardingChecklistRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/recruitment'); }, [router]);
  return null;
}
