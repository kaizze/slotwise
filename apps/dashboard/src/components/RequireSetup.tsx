'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { fetchSetupStatus } from '@/lib/onboarding';

/**
 * Sends authenticated merchants who have no services/staff to /onboarding
 * so the calendar isn't empty on first login.
 */
export function RequireSetup({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (status !== 'authenticated') return;
    if (pathname.startsWith('/onboarding')) {
      setReady(true);
      return;
    }

    let cancelled = false;
    setReady(false);

    fetchSetupStatus()
      .then((setup) => {
        if (cancelled) return;
        if (!setup.complete) {
          router.replace('/onboarding');
          return;
        }
        setReady(true);
      })
      .catch(() => {
        // Don't trap the user if the check fails — let the app load.
        if (!cancelled) setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [status, pathname, router]);

  if (!ready) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-muted)' }}>
        Loading…
      </div>
    );
  }

  return <>{children}</>;
}
