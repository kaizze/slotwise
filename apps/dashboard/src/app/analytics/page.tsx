'use client';

import { RequireAuth } from '@/components/RequireAuth';
import { AppShell } from '@/components/AppShell';
import { AnalyticsPage } from '@/components/AnalyticsPage';

export default function AnalyticsRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <AnalyticsPage />
      </AppShell>
    </RequireAuth>
  );
}
