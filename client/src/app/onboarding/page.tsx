'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Onboarding was folded into Recruitment: steps 9-11 (pre-joining → transfer) now live
// under Recruitment → Onboarding. Redirect old links there.
export default function OnboardingRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/recruitment/joining'); }, [router]);
  return null;
}
