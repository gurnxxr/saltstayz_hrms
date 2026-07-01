'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function PayslipsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/payroll');
  }, [router]);
  return null;
}
