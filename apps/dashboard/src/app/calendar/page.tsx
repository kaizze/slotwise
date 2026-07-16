'use client';

import { RequireAuth } from '@/components/RequireAuth';
import { AppShell } from '@/components/AppShell';
import { DayCalendar } from '@/components/DayCalendar';

export default function CalendarPage() {
  return (
    <RequireAuth>
      <AppShell>
        <DayCalendar />
      </AppShell>
    </RequireAuth>
  );
}
