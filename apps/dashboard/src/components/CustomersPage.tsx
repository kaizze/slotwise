'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { customersApi, ApiError, type CrmCustomerSummary } from '@/lib/api-client';
import { formatLastVisit, formatMoney } from '@/lib/format';
import { formStyles } from '@/components/form-styles';

export function CustomersPage() {
  const [query, setQuery] = useState('');
  const [customers, setCustomers] = useState<CrmCustomerSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (q?: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await customersApi.list(q);
      setCustomers(result.customers);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load customers.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      load(query);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [query, load]);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Customers</h1>
          <p style={styles.subtitle}>
            CRM profiles with spend, visits, and preferences.
          </p>
        </div>
      </div>

      <input
        type="search"
        placeholder="Search name, phone, or email…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ ...formStyles.input, marginBottom: 16, maxWidth: 360 }}
      />

      {error && <div style={formStyles.error}>{error}</div>}

      {loading ? (
        <div style={styles.muted}>Loading…</div>
      ) : customers.length === 0 ? (
        <div style={styles.empty}>
          <div style={styles.emptyTitle}>No customers yet</div>
          <div style={styles.muted}>
            Profiles appear when someone books via the widget or AI agent.
          </div>
        </div>
      ) : (
        <>
          <p style={styles.count}>{total} customer{total === 1 ? '' : 's'}</p>
          <div style={styles.list}>
            {customers.map((c) => (
              <Link key={c.id} href={`/customers/${c.id}`} style={styles.row}>
                <div style={styles.avatar}>{c.name.charAt(0).toUpperCase()}</div>
                <div style={styles.rowMain}>
                  <div style={styles.rowName}>{c.name}</div>
                  <div style={styles.rowMeta}>
                    {c.phone}
                    {c.email ? ` · ${c.email}` : ''}
                  </div>
                </div>
                <div style={styles.rowStats}>
                  <span>{formatLastVisit(c.lastVisitAt)}</span>
                  <span>{formatMoney(c.totalSpent, c.currency)}</span>
                  <span>{c.bookingsCount} bookings</span>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { maxWidth: 820 },
  header: { marginBottom: 16 },
  title: { margin: 0, fontSize: 22, fontWeight: 600 },
  subtitle: { margin: '4px 0 0', color: 'var(--ink-muted)', fontSize: 13 },
  muted: { color: 'var(--ink-muted)', fontSize: 13 },
  count: { margin: '0 0 10px', fontSize: 12, color: 'var(--ink-faint)' },
  empty: {
    padding: '40px 20px',
    textAlign: 'center',
    border: '1px dashed var(--border)',
    borderRadius: 'var(--radius)',
  },
  emptyTitle: { fontWeight: 600, marginBottom: 4 },
  list: { display: 'flex', flexDirection: 'column', gap: 8 },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '14px 16px',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    textDecoration: 'none',
    color: 'inherit',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 999,
    background: '#eef2ff',
    color: 'var(--accent)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 600,
    flexShrink: 0,
  },
  rowMain: { flex: 1, minWidth: 0 },
  rowName: { fontWeight: 600, fontSize: 14 },
  rowMeta: { fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 },
  rowStats: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 2,
    fontSize: 12,
    color: 'var(--ink-muted)',
    flexShrink: 0,
  },
};
