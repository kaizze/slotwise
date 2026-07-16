'use client';

import { useCallback, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { waitlistApi, ApiError, type DashboardWaitlistEntry } from '@/lib/api-client';
import { formStyles } from '@/components/form-styles';

export function WaitlistPage() {
  const [entries, setEntries] = useState<DashboardWaitlistEntry[]>([]);
  const [includeNotified, setIncludeNotified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await waitlistApi.list(includeNotified);
      setEntries(rows);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load waitlist.');
    } finally {
      setLoading(false);
    }
  }, [includeNotified]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRemove(id: string) {
    setRemovingId(id);
    setError(null);
    try {
      await waitlistApi.remove(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove entry.');
    } finally {
      setRemovingId(null);
    }
  }

  const activeCount = entries.filter((e) => !e.notified).length;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Waitlist</h1>
          <p style={styles.subtitle}>
            Customers waiting for an opening. When a booking is cancelled, the next match gets an offer automatically.
          </p>
        </div>
        <button type="button" style={styles.refreshButton} onClick={load} disabled={loading}>
          Refresh
        </button>
      </div>

      <label style={styles.checkbox}>
        <input
          type="checkbox"
          checked={includeNotified}
          onChange={(e) => setIncludeNotified(e.target.checked)}
        />
        Show already notified
      </label>

      {error && <div style={formStyles.error}>{error}</div>}

      {loading ? (
        <div style={styles.loadingState}>Loading…</div>
      ) : entries.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={styles.emptyTitle}>
            {includeNotified ? 'No waitlist history yet' : 'Waitlist is empty'}
          </div>
          <div style={styles.emptySubtitle}>
            Customers can join from the booking widget (“Notify me”) or through the AI agent when no slots fit.
          </div>
        </div>
      ) : (
        <>
          {!includeNotified && (
            <p style={styles.countNote}>{activeCount} waiting</p>
          )}
          <div style={styles.list}>
            {entries.map((w) => (
              <div key={w.id} style={styles.row}>
                <div style={styles.rowMain}>
                  <div style={styles.rowName}>
                    {w.customerName}
                    {w.notified && <span style={styles.notifiedBadge}>Notified</span>}
                  </div>
                  <div style={styles.rowMeta}>
                    {w.serviceName}
                    {w.staffName ? ` · prefers ${w.staffName}` : ''}
                    {' · '}
                    {w.customerPhone}
                    {w.customerEmail ? ` · ${w.customerEmail}` : ''}
                  </div>
                  <div style={styles.rowMeta}>
                    Joined {dayjs(w.createdAt).format('D MMM YYYY, HH:mm')}
                    {w.preferredWindowStart && (
                      <> · wants {dayjs(w.preferredWindowStart).format('D MMM')}</>
                    )}
                  </div>
                </div>
                {!w.notified && (
                  <button
                    type="button"
                    style={styles.removeButton}
                    onClick={() => handleRemove(w.id)}
                    disabled={removingId === w.id}
                  >
                    {removingId === w.id ? 'Removing…' : 'Remove'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 720,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 16,
  },
  title: {
    margin: 0,
    fontSize: 22,
    fontWeight: 600,
  },
  subtitle: {
    margin: '4px 0 0',
    color: 'var(--ink-muted)',
    fontSize: 13,
    maxWidth: 480,
  },
  refreshButton: {
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--ink-muted)',
    borderRadius: 'var(--radius-sm)',
    padding: '8px 12px',
    fontSize: 13,
    cursor: 'pointer',
    flexShrink: 0,
  },
  checkbox: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    color: 'var(--ink-muted)',
    marginBottom: 16,
  },
  loadingState: {
    color: 'var(--ink-muted)',
    padding: '40px 0',
  },
  emptyState: {
    padding: '36px 20px',
    textAlign: 'center',
    border: '1px dashed var(--border)',
    borderRadius: 'var(--radius)',
    background: 'var(--surface)',
  },
  emptyTitle: {
    fontWeight: 600,
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 13,
    color: 'var(--ink-muted)',
  },
  countNote: {
    margin: '0 0 10px',
    fontSize: 12,
    color: 'var(--ink-faint)',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '14px 16px',
  },
  rowMain: {
    minWidth: 0,
  },
  rowName: {
    fontWeight: 600,
    fontSize: 14,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  rowMeta: {
    fontSize: 12,
    color: 'var(--ink-muted)',
    marginTop: 3,
  },
  notifiedBadge: {
    fontSize: 11,
    fontWeight: 500,
    padding: '2px 7px',
    borderRadius: 999,
    background: '#f0fdf4',
    color: '#15803d',
  },
  removeButton: {
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--danger)',
    borderRadius: 'var(--radius-sm)',
    padding: '7px 10px',
    fontSize: 12,
    cursor: 'pointer',
    flexShrink: 0,
  },
};
