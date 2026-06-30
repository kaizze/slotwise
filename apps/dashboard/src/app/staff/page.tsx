'use client';

import { RequireAuth } from '@/components/RequireAuth';
import { AppShell } from '@/components/AppShell';
import { StaffPage } from '@/components/StaffPage';

export default function Page() {
  return (
    <RequireAuth>
      <AppShell>
        <StaffPage />
      </AppShell>
    </RequireAuth>
  );
}
