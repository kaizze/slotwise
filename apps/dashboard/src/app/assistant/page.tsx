'use client';

import { RequireAuth } from '@/components/RequireAuth';
import { AppShell } from '@/components/AppShell';
import { AdminAssistantPage } from '@/components/AdminAssistantPage';

export default function AssistantRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <AdminAssistantPage />
      </AppShell>
    </RequireAuth>
  );
}
