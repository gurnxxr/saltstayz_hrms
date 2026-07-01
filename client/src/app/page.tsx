'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ROLE_DEFAULT_DASHBOARD } from '@/lib/constants';
import type { RoleName } from '@/lib/types';

export default function Home() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace('/login');
    } else {
      const defaultRoute = ROLE_DEFAULT_DASHBOARD[user.roleName as RoleName] || '/dashboard';
      router.replace(defaultRoute);
    }
  }, [user, isLoading]);

  return (
    <div className="h-screen flex items-center justify-center bg-muted">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>
  );
}
