'use client';

import { RequireAuth } from '@/components/RequireAuth';
import { AppShell } from '@/components/AppShell';
import { WaitlistPage } from '@/components/WaitlistPage';

export default function WaitlistRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <WaitlistPage />
      </AppShell>
    </RequireAuth>
  );
}
