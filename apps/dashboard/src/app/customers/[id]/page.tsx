'use client';

import { RequireAuth } from '@/components/RequireAuth';
import { AppShell } from '@/components/AppShell';
import { CustomerDetailPage } from '@/components/CustomerDetailPage';

export default function CustomerDetailRoute({
  params,
}: {
  params: { id: string };
}) {
  return (
    <RequireAuth>
      <AppShell>
        <CustomerDetailPage customerId={params.id} />
      </AppShell>
    </RequireAuth>
  );
}
