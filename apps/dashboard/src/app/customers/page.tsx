'use client';

import { RequireAuth } from '@/components/RequireAuth';
import { AppShell } from '@/components/AppShell';
import { CustomersPage } from '@/components/CustomersPage';

export default function CustomersRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <CustomersPage />
      </AppShell>
    </RequireAuth>
  );
}
