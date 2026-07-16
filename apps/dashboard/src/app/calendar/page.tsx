'use client';

import { RequireAuth } from '@/components/RequireAuth';
import { AppShell } from '@/components/AppShell';
import { BookingCalendar } from '@/components/BookingCalendar';

export default function CalendarPage() {
  return (
    <RequireAuth>
      <AppShell>
        <BookingCalendar />
      </AppShell>
    </RequireAuth>
  );
}
