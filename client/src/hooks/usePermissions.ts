'use client';

import { useAuth } from '@/lib/auth';
import type { RoleName } from '@/lib/types';

export function usePermissions() {
  const { user, can } = useAuth();

  const isAdmin = user?.roleName === 'admin';
  const isCHRO = user?.roleName === 'chro';
  const isHR = user?.roleName === 'hr';
  const isHRManager = user?.roleName === 'hr_manager';
  const isClusterHR = user?.roleName === 'cluster_hr';
  const isPM = user?.roleName === 'property_manager';
  const isEmployee = user?.roleName === 'employee';
  const isFinance = user?.roleName === 'finance';

  function hasRole(...roles: RoleName[]) {
    return user ? roles.includes(user.roleName as RoleName) : false;
  }

  return {
    can,
    hasRole,
    isAdmin,
    isCHRO,
    isHR,
    isHRManager,
    isClusterHR,
    isPM,
    isEmployee,
    isFinance,
  };
}
