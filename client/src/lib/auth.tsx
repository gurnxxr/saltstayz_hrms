'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import api from './api';
import { User, Permission, AuthState, type RoleName } from './types';
import { ROLE_DEFAULT_DASHBOARD } from './constants';

interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (module: string, action: string) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    permissions: [],
    overrides: { granted: [], denied: [] },
    isLoading: true,
  });
  const router = useRouter();

  useEffect(() => {
    checkAuth();
  }, []);

  const emptyOverrides = { granted: [], denied: [] };

  async function checkAuth() {
    try {
      const { data } = await api.get('/auth/me');
      setState({ user: data.user, permissions: data.permissions, overrides: data.overrides ?? emptyOverrides, isLoading: false });
    } catch {
      setState({ user: null, permissions: [], overrides: emptyOverrides, isLoading: false });
    }
  }

  async function login(email: string, password: string) {
    const { data } = await api.post('/auth/login', { email, password });
    setState({ user: data.user, permissions: data.permissions, overrides: data.overrides ?? emptyOverrides, isLoading: false });
    const defaultRoute = ROLE_DEFAULT_DASHBOARD[data.user.roleName as RoleName] || '/dashboard';
    router.push(defaultRoute);
  }

  async function logout() {
    await api.post('/auth/logout');
    setState({ user: null, permissions: [], overrides: emptyOverrides, isLoading: false });
    router.push('/login');
  }

  function can(module: string, action: string) {
    return state.permissions.some(p => p.module === module && p.action === action);
  }

  return (
    <AuthContext.Provider value={{ ...state, login, logout, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
