'use client';

import { RequireAuth } from '@/components/RequireAuth';
import { AppShell } from '@/components/AppShell';
import { DayCalendar } from '@/components/DayCalendar';

export default function HomePage() {
  return (
    <RequireAuth>
      <AppShell>
        <DayCalendar />
      </AppShell>
    </RequireAuth>
  );
}
