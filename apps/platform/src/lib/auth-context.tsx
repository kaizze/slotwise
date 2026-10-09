'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { platformApi, type PlatformUser } from './api-client';

interface AuthState {
  user: PlatformUser | null;
  status: 'loading' | 'authenticated' | 'unauthenticated';
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    status: 'loading',
  });

  useEffect(() => {
    let cancelled = false;
    platformApi.restoreSession().then((session) => {
      if (cancelled) return;
      if (session) {
        setState({ user: session.user, status: 'authenticated' });
      } else {
        setState({ user: null, status: 'unauthenticated' });
      }
    });
    return () => { cancelled = true; };
  }, []);

  const login = async (email: string, password: string) => {
    const result = await platformApi.login(email, password);
    setState({ user: result.user, status: 'authenticated' });
  };

  const logout = async () => {
    try {
      await platformApi.logout();
    } finally {
      setState({ user: null, status: 'unauthenticated' });
    }
  };

  return (
    <AuthContext.Provider value={{ ...state, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
