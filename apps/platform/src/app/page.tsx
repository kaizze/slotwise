'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { PlatformShell } from '@/components/PlatformShell';
import { ApiError, platformApi, type PlatformBusiness } from '@/lib/api-client';

export default function BusinessesPage() {
  const [businesses, setBusinesses] = useState<PlatformBusiness[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    platformApi
      .listBusinesses(q || undefined)
      .then((data) => {
        if (!cancelled) setBusinesses(data.businesses);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load businesses');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [q]);

  return (
    <PlatformShell>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Businesses</h1>
          <p style={styles.sub}>All tenants on this SlotWise instance</p>
        </div>
        <input
          style={styles.search}
          placeholder="Search name or slug…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Business</th>
              <th style={styles.th}>Plan</th>
              <th style={styles.th}>Channels</th>
              <th style={styles.th}>Staff</th>
              <th style={styles.th}>Bookings 7d</th>
              <th style={styles.th}>Created</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} style={styles.empty}>Loading…</td>
              </tr>
            )}
            {!loading && businesses.length === 0 && (
              <tr>
                <td colSpan={6} style={styles.empty}>No businesses found.</td>
              </tr>
            )}
            {businesses.map((b) => (
              <tr key={b.id}>
                <td style={styles.td}>
                  <div style={styles.name}>{b.name}</div>
                  <div style={styles.slug}>{b.slug} · {b.timezone}</div>
                </td>
                <td style={styles.td}>{b.plan ?? '—'}</td>
                <td style={styles.td}>
                  <span style={chip(b.emailEnabled)}>Email</span>{' '}
                  <span style={chip(b.smsEnabled)}>SMS{b.smsProvider ? `/${b.smsProvider}` : ''}</span>{' '}
                  <span style={chip(b.agentEnabled)}>Agent</span>
                </td>
                <td style={styles.td}>{b.staffCount}</td>
                <td style={styles.td}>{b.bookings7d}</td>
                <td style={styles.td}>{new Date(b.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PlatformShell>
  );
}

function chip(on: boolean): CSSProperties {
  return {
    display: 'inline-block',
    fontSize: 11,
    padding: '2px 7px',
    borderRadius: 999,
    marginRight: 4,
    background: on ? 'rgba(34, 197, 94, 0.15)' : 'rgba(92, 107, 126, 0.2)',
    color: on ? '#86efac' : 'var(--ink-faint)',
  };
}

const styles: Record<string, CSSProperties> = {
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: 16,
    marginBottom: 20,
  },
  title: { margin: 0, fontSize: 22, fontWeight: 700 },
  sub: { margin: '4px 0 0', color: 'var(--ink-muted)', fontSize: 13 },
  search: {
    width: 260,
    padding: '9px 12px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--ink)',
  },
  tableWrap: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    overflow: 'auto',
  },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    textAlign: 'left',
    padding: '12px 14px',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: 'var(--ink-faint)',
    borderBottom: '1px solid var(--border)',
  },
  td: {
    padding: '12px 14px',
    borderBottom: '1px solid var(--border)',
    verticalAlign: 'top',
  },
  name: { fontWeight: 600 },
  slug: { color: 'var(--ink-muted)', fontSize: 12, marginTop: 2 },
  empty: { padding: 28, textAlign: 'center', color: 'var(--ink-muted)' },
  error: {
    background: 'rgba(239, 68, 68, 0.12)',
    color: '#fca5a5',
    borderRadius: 8,
    padding: '10px 12px',
    marginBottom: 14,
  },
};
