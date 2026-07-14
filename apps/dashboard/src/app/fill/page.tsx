'use client';

import { RequireAuth } from '@/components/RequireAuth';
import { AppShell } from '@/components/AppShell';
import { FillPage } from '@/components/FillPage';

export default function FillRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <FillPage />
      </AppShell>
    </RequireAuth>
  );
}
