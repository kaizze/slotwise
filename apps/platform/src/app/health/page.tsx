'use client';

import { useEffect, useState } from 'react';
import { PlatformShell } from '@/components/PlatformShell';
import { ApiError, platformApi, type PlatformHealth } from '@/lib/api-client';

export default function HealthPage() {
  const [health, setHealth] = useState<PlatformHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      platformApi
        .health()
        .then((data) => {
          if (!cancelled) {
            setHealth(data);
            setError(null);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setError(err instanceof ApiError ? err.message : 'Failed to load health');
          }
        });
    };
    load();
    const id = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <PlatformShell>
      <h1 style={styles.title}>System health</h1>
      <p style={styles.sub}>Refreshes every 15s</p>

      {error && <div style={styles.error}>{error}</div>}

      {health && (
        <>
          <div style={styles.grid}>
            <Stat
              label="Status"
              value={health.status.toUpperCase()}
              tone={health.status === 'ok' ? 'ok' : 'warn'}
            />
            <Stat label="Businesses" value={String(health.fleet.businesses)} />
            <Stat label="Active staff" value={String(health.fleet.activeStaff)} />
            <Stat label="Bookings today" value={String(health.fleet.bookingsToday)} />
          </div>

          <h2 style={styles.section}>Notifications (24h)</h2>
          <div style={styles.grid}>
            <Stat label="Pending" value={String(health.notifications.pending)} />
            <Stat label="Processing" value={String(health.notifications.processing)} />
            <Stat label="Sent" value={String(health.notifications.sent24h)} />
            <Stat
              label="Failed"
              value={String(health.notifications.failed24h)}
              tone={health.notifications.failed24h > 0 ? 'warn' : 'ok'}
            />
          </div>

          <h2 style={styles.section}>Environment</h2>
          <div style={styles.envList}>
            {Object.entries(health.env).map(([key, ok]) => (
              <div key={key} style={styles.envRow}>
                <span style={styles.envKey}>{key}</span>
                <span style={{ color: ok ? 'var(--ok)' : 'var(--danger)' }}>
                  {ok ? 'configured' : 'missing'}
                </span>
              </div>
            ))}
          </div>

          <p style={styles.meta}>DB healthy: {health.db.healthy ? 'yes' : 'no'} · {health.ts}</p>
        </>
      )}
    </PlatformShell>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'warn';
}) {
  return (
    <div style={styles.stat}>
      <div style={styles.statLabel}>{label}</div>
      <div
        style={{
          ...styles.statValue,
          color: tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : 'var(--ink)',
        }}
      >
        {value}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  title: { margin: 0, fontSize: 22, fontWeight: 700 },
  sub: { margin: '4px 0 20px', color: 'var(--ink-muted)', fontSize: 13 },
  section: {
    margin: '28px 0 12px',
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: 'var(--ink-faint)',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
    gap: 12,
  },
  stat: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: 16,
  },
  statLabel: { fontSize: 12, color: 'var(--ink-muted)', marginBottom: 6 },
  statValue: { fontSize: 22, fontWeight: 700 },
  envList: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    overflow: 'hidden',
  },
  envRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '10px 14px',
    borderBottom: '1px solid var(--border)',
    fontSize: 13,
  },
  envKey: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  meta: { marginTop: 16, color: 'var(--ink-faint)', fontSize: 12 },
  error: {
    background: 'rgba(239, 68, 68, 0.12)',
    color: '#fca5a5',
    borderRadius: 8,
    padding: '10px 12px',
    marginBottom: 14,
  },
};
