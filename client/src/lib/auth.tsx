'use client';

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
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
  const queryClient = useQueryClient();
  // Monotonic guard: a completed login/logout must win over any in-flight
  // checkAuth(). The provider mounts once (persisted in the root layout) and
  // fires checkAuth() → GET /auth/me; on a cold start that request can resolve
  // *after* a successful login and clobber the session back to null, bouncing
  // the user to /login — which is why login sometimes needed a second attempt.
  const authSeq = useRef(0);

  useEffect(() => {
    checkAuth();
  }, []);

  const emptyOverrides = { granted: [], denied: [] };

  // Better Auth (mounted on the API) owns identity + the session cookie; the app owns
  // authorization, so we hydrate the signed-in user + permissions + overrides from
  // /session-context. The session cookie rides along automatically (axios withCredentials).
  async function checkAuth() {
    const seq = ++authSeq.current;
    try {
      const { data } = await api.get('/session-context');
      if (seq !== authSeq.current) return; // superseded by a login/logout — ignore
      setState({ user: data.user, permissions: data.permissions, overrides: data.overrides ?? emptyOverrides, isLoading: false });
    } catch {
      if (seq !== authSeq.current) return; // superseded — don't clobber a fresh session
      setState({ user: null, permissions: [], overrides: emptyOverrides, isLoading: false });
    }
  }

  async function login(email: string, password: string) {
    // Better Auth signs the user in and sets the session cookie; then hydrate context.
    await api.post('/auth/sign-in/email', { email, password });
    authSeq.current++; // this session supersedes any in-flight checkAuth()
    const { data } = await api.get('/session-context');
    // THE cross-user cache-safety mechanism: per-user query keys stay unscoped
    // everywhere because login/logout wipe the whole cache here.
    queryClient.clear();
    setState({ user: data.user, permissions: data.permissions, overrides: data.overrides ?? emptyOverrides, isLoading: false });
    const defaultRoute = ROLE_DEFAULT_DASHBOARD[data.user.roleName as RoleName] || '/dashboard';
    router.push(defaultRoute);
  }

  async function logout() {
    authSeq.current++; // supersede any in-flight checkAuth()
    await api.post('/auth/sign-out'); // Better Auth revokes the session + clears the cookie
    queryClient.clear(); // wipe cached per-user data so the next sign-in starts fresh
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
