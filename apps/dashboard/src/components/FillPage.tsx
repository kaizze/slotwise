'use client';

import { useCallback, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import {
  waitlistApi,
  offersApi,
  ApiError,
  type DashboardWaitlistEntry,
  type DashboardSlotOffer,
} from '@/lib/api-client';
import { formStyles } from '@/components/form-styles';

type Tab = 'offers' | 'waitlist';

function statusBadgeStyle(status: string): React.CSSProperties {
  const base: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 500,
    padding: '2px 7px',
    borderRadius: 999,
    textTransform: 'capitalize',
  };
  switch (status) {
    case 'pending':
      return { ...base, color: '#b45309', background: '#fffbeb' };
    case 'accepted':
      return { ...base, color: '#15803d', background: '#f0fdf4' };
    case 'expired':
    case 'cancelled':
      return { ...base, color: 'var(--ink-muted)', background: 'var(--bg)' };
    default:
      return { ...base, color: 'var(--ink-muted)', background: 'var(--bg)' };
  }
}

export function FillPage() {
  const [tab, setTab] = useState<Tab>('offers');
  const [offers, setOffers] = useState<DashboardSlotOffer[]>([]);
  const [waitlist, setWaitlist] = useState<DashboardWaitlistEntry[]>([]);
  const [includeNotified, setIncludeNotified] = useState(false);
  const [offerFilter, setOfferFilter] = useState<'all' | 'pending' | 'accepted'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [offerRows, waitlistRows] = await Promise.all([
        offersApi.list(offerFilter === 'all' ? 'all' : offerFilter),
        waitlistApi.list(includeNotified),
      ]);
      setOffers(offerRows);
      setWaitlist(waitlistRows);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load slot-filling data.');
    } finally {
      setLoading(false);
    }
  }, [includeNotified, offerFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const pendingCount = offers.filter((o) => o.status === 'pending').length;
  const activeWaitlistCount = waitlist.filter((w) => !w.notified).length;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Slot filling</h1>
          <p style={styles.subtitle}>
            Waitlist and rebook offers after cancellations.
          </p>
        </div>
        <button style={styles.refreshButton} onClick={load} disabled={loading}>
          Refresh
        </button>
      </div>

      <div style={styles.tabs}>
        <button
          style={tab === 'offers' ? styles.tabActive : styles.tab}
          onClick={() => setTab('offers')}
        >
          Offers{pendingCount > 0 ? ` (${pendingCount})` : ''}
        </button>
        <button
          style={tab === 'waitlist' ? styles.tabActive : styles.tab}
          onClick={() => setTab('waitlist')}
        >
          Waitlist{activeWaitlistCount > 0 ? ` (${activeWaitlistCount})` : ''}
        </button>
      </div>

      {error && <div style={formStyles.error}>{error}</div>}

      {loading ? (
        <div style={styles.loadingState}>Loading…</div>
      ) : tab === 'offers' ? (
        <>
          <div style={styles.filterRow}>
            {(['all', 'pending', 'accepted'] as const).map((f) => (
              <button
                key={f}
                style={offerFilter === f ? styles.chipActive : styles.chip}
                onClick={() => setOfferFilter(f)}
              >
                {f === 'all' ? 'All' : f === 'pending' ? 'Pending' : 'Accepted'}
              </button>
            ))}
          </div>

          {offers.length === 0 ? (
            <div style={styles.emptyState}>
              <div style={styles.emptyTitle}>No offers yet</div>
              <div style={styles.emptySubtitle}>
                When a booking is cancelled, rebook and waitlist offers show up here.
              </div>
            </div>
          ) : (
            <div style={styles.list}>
              {offers.map((o) => (
                <div key={o.id} style={styles.row}>
                  <div style={styles.rowTop}>
                    <span style={styles.rowName}>{o.customerName}</span>
                    <span style={statusBadgeStyle(o.status)}>{o.status}</span>
                  </div>
                  <div style={styles.rowMeta}>
                    <span style={styles.typeBadge}>{o.offerType}</span>
                    {o.serviceName} · {o.staffName}
                  </div>
                  <div style={styles.rowMeta}>
                    Slot {dayjs(o.slotStartsAt).format('ddd D MMM, HH:mm')}
                    {o.bookingRef ? ` · ${o.bookingRef}` : ''}
                  </div>
                  <div style={styles.rowFooter}>
                    <span>Code {o.offerToken}</span>
                    <span>
                      {o.status === 'accepted' && o.acceptedAt
                        ? `Accepted ${dayjs(o.acceptedAt).format('D MMM HH:mm')}`
                        : `Expires ${dayjs(o.expiresAt).format('D MMM HH:mm')}`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <label style={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={includeNotified}
              onChange={(e) => setIncludeNotified(e.target.checked)}
            />
            <span>Show already notified</span>
          </label>

          {waitlist.length === 0 ? (
            <div style={styles.emptyState}>
              <div style={styles.emptyTitle}>Waitlist is empty</div>
              <div style={styles.emptySubtitle}>
                Customers who join via the widget or agent appear here until a slot opens.
              </div>
            </div>
          ) : (
            <div style={styles.list}>
              {waitlist.map((w) => (
                <div key={w.id} style={styles.row}>
                  <div style={styles.rowTop}>
                    <span style={styles.rowName}>{w.customerName}</span>
                    <span style={statusBadgeStyle(w.notified ? 'accepted' : 'pending')}>
                      {w.notified ? 'Notified' : 'Waiting'}
                    </span>
                  </div>
                  <div style={styles.rowMeta}>
                    {w.serviceName}
                    {w.staffName ? ` · ${w.staffName}` : ' · any staff'}
                  </div>
                  <div style={styles.rowMeta}>
                    {w.customerPhone}
                    {w.customerEmail ? ` · ${w.customerEmail}` : ''}
                  </div>
                  <div style={styles.rowFooter}>
                    <span>
                      {w.preferredWindowStart
                        ? `Prefers ${dayjs(w.preferredWindowStart).format('D MMM')}`
                        : 'Any day'}
                    </span>
                    <span>Joined {dayjs(w.createdAt).format('D MMM HH:mm')}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { maxWidth: 640 },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 16,
  },
  title: { fontSize: 18, fontWeight: 600, margin: 0 },
  subtitle: { fontSize: 13, color: 'var(--ink-muted)', margin: '4px 0 0' },
  refreshButton: {
    padding: '7px 12px',
    fontSize: 12,
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    cursor: 'pointer',
    color: 'var(--ink-muted)',
  },
  tabs: { display: 'flex', gap: 6, marginBottom: 14 },
  tab: {
    padding: '7px 12px',
    fontSize: 13,
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--ink-muted)',
    cursor: 'pointer',
  },
  tabActive: {
    padding: '7px 12px',
    fontSize: 13,
    borderRadius: 'var(--radius-sm)',
    border: '1px solid transparent',
    background: '#eef2ff',
    color: 'var(--accent)',
    fontWeight: 500,
    cursor: 'pointer',
  },
  filterRow: { display: 'flex', gap: 6, marginBottom: 12 },
  chip: {
    padding: '4px 10px',
    fontSize: 12,
    borderRadius: 999,
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--ink-muted)',
    cursor: 'pointer',
  },
  chipActive: {
    padding: '4px 10px',
    fontSize: 12,
    borderRadius: 999,
    border: '1px solid transparent',
    background: '#eef2ff',
    color: 'var(--accent)',
    cursor: 'pointer',
  },
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    color: 'var(--ink-muted)',
    marginBottom: 12,
  },
  list: { display: 'flex', flexDirection: 'column', gap: 8 },
  row: {
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '12px 14px',
    background: 'var(--surface)',
  },
  rowTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  rowName: { fontSize: 14, fontWeight: 550 },
  rowMeta: { fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 },
  rowFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 8,
    fontSize: 11,
    color: 'var(--ink-faint)',
  },
  typeBadge: {
    display: 'inline-block',
    fontSize: 11,
    fontWeight: 500,
    color: 'var(--accent)',
    background: '#eef2ff',
    padding: '1px 6px',
    borderRadius: 999,
    marginRight: 6,
    textTransform: 'capitalize',
  },
  loadingState: {
    padding: '48px 0',
    textAlign: 'center',
    color: 'var(--ink-muted)',
    fontSize: 13,
  },
  emptyState: {
    padding: '48px 20px',
    textAlign: 'center',
    border: '1px dashed var(--border)',
    borderRadius: 'var(--radius)',
  },
  emptyTitle: { fontSize: 14, fontWeight: 500 },
  emptySubtitle: { fontSize: 13, color: 'var(--ink-muted)', marginTop: 4 },
};
