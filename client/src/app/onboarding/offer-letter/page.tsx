'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// The offer letter now lives inside Recruitment (issued at Offer Release). Redirect old
// offer-letter links to the Recruitment pipeline.
export default function OnboardingOfferLetterRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/recruitment'); }, [router]);
  return null;
}
