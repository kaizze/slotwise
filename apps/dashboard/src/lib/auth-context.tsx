'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { authApi, type DashboardUser, type DashboardBusiness } from './api-client';

interface AuthState {
  user: DashboardUser | null;
  business: DashboardBusiness | null;
  status: 'loading' | 'authenticated' | 'unauthenticated';
}

export interface SignupInput {
  businessName: string;
  businessSlug: string;
  businessType: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
  timezone?: string;
  locale?: string;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  signup: (input: SignupInput) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    business: null,
    status: 'loading',
  });

  // On mount, attempt silent re-auth via the refresh cookie. This is what
  // makes a page reload not immediately bounce the user to /login — the
  // access token is gone (it only ever lived in memory) but the httpOnly
  // refresh cookie survives and re-establishes the session.
  useEffect(() => {
    let cancelled = false;

    authApi.restoreSession().then((session) => {
      if (cancelled) return;

      if (session) {
        setState({ user: session.user, business: session.business, status: 'authenticated' });
      } else {
        setState({ user: null, business: null, status: 'unauthenticated' });
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = async (email: string, password: string) => {
    const result = await authApi.login(email, password);
    setState({ user: result.user, business: result.business, status: 'authenticated' });
  };

  const signup = async (input: SignupInput) => {
    const result = await authApi.signup(input);
    setState({ user: result.user, business: result.business, status: 'authenticated' });
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } finally {
      // Always clear local auth so Sign out never appears stuck.
      setState({ user: null, business: null, status: 'unauthenticated' });
    }
  };

  return (
    <AuthContext.Provider value={{ ...state, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
