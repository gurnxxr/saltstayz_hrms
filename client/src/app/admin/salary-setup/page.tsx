'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Superseded by Payroll → Salary Structures → "By Employee" tab, which now owns
// per-employee structure + base + TDS. Redirect any old links there.
export default function SalarySetupRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/setup/salary-structure'); }, [router]);
  return null;
}
