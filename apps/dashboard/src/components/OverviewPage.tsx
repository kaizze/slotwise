'use client';

import { useCallback, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import Link from 'next/link';
import {
  analyticsApi,
  bookingsApi,
  ApiError,
  type DashboardBooking,
  type TodayOverview,
} from '@/lib/api-client';
import { BookingCard } from './BookingCard';

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount.toFixed(0)} ${currency}`;
  }
}

export function OverviewPage() {
  const [overview, setOverview] = useState<TodayOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<DashboardBooking | null>(null);
  const [noShowTarget, setNoShowTarget] = useState<DashboardBooking | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [markingNoShow, setMarkingNoShow] = useState(false);
  const [cancelNotice, setCancelNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await analyticsApi.today();
      setOverview(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load overview.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  async function confirmCancel() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await bookingsApi.cancel(cancelTarget.ref);
      setCancelTarget(null);
      setCancelNotice('Booking cancelled. Checking waitlist…');
      await load();
      setTimeout(() => {
        load();
        setCancelNotice(null);
      }, 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel booking.');
      setCancelTarget(null);
    } finally {
      setCancelling(false);
    }
  }

  async function confirmNoShow() {
    if (!noShowTarget) return;
    setMarkingNoShow(true);
    try {
      await bookingsApi.markNoShow(noShowTarget.ref);
      setNoShowTarget(null);
      setCancelNotice('Marked as no-show. Customer profile updated.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not mark no-show.');
      setNoShowTarget(null);
    } finally {
      setMarkingNoShow(false);
    }
  }

  const t = overview?.totals;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Today</h1>
          <p style={styles.subtitle}>
            {overview
              ? dayjs(overview.date).format('dddd, D MMMM')
              : dayjs().format('dddd, D MMMM')}
            {overview ? ` · ${overview.timezone}` : ''}
          </p>
        </div>
        <div style={styles.headerActions}>
          <button type="button" style={styles.secondaryButton} onClick={load} disabled={loading}>
            Refresh
          </button>
          <Link href="/calendar" style={styles.secondaryLink}>
            Full calendar
          </Link>
        </div>
      </div>

      {error && <div style={styles.error}>{error}</div>}
      {cancelNotice && <div style={styles.notice}>{cancelNotice}</div>}

      {loading && !overview ? (
        <div style={styles.loadingState}>Loading…</div>
      ) : t ? (
        <>
          <div style={styles.metrics}>
            <Metric label="Today's bookings" value={String(t.bookingsToday)} />
            <Metric
              label="Revenue today"
              value={formatMoney(t.revenueToday, overview!.currency)}
            />
            <Metric
              label="Occupancy"
              value={t.occupancyPercent == null ? '—' : `${t.occupancyPercent}%`}
              hint={t.occupancyPercent == null ? 'No staff hours today' : 'Booked vs staff capacity'}
            />
            <Metric label="Upcoming in 30 min" value={String(t.upcomingIn30Min)} />
            <Metric
              label="Waiting list"
              value={String(t.waitlistActive)}
              href="/waitlist"
            />
            <Metric label="Cancelled today" value={String(t.cancelledToday)} />
          </div>

          <section style={styles.timelineSection}>
            <div style={styles.timelineHeader}>
              <h2 style={styles.timelineTitle}>Today&apos;s timeline</h2>
              <Link href="/calendar" style={styles.timelineLink}>
                Open calendar
              </Link>
            </div>

            {overview!.timeline.length === 0 ? (
              <div style={styles.emptyState}>
                <div style={styles.emptyTitle}>No bookings today</div>
                <div style={styles.emptySubtitle}>
                  New bookings from the widget or AI agent will show up here.
                </div>
              </div>
            ) : (
              <div style={styles.list}>
                {overview!.timeline.map((b) => (
                  <BookingCard
                    key={b.id}
                    booking={b}
                    onCancel={setCancelTarget}
                    onMarkNoShow={setNoShowTarget}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}

      {cancelTarget && (
        <div style={styles.modalBackdrop}>
          <div style={styles.modal}>
            <h3 style={styles.modalTitle}>Cancel booking?</h3>
            <p style={styles.modalText}>
              {cancelTarget.customerName} · {dayjs(cancelTarget.startsAt).format('HH:mm')} ·{' '}
              {cancelTarget.serviceName}
            </p>
            <div style={styles.modalActions}>
              <button
                type="button"
                style={styles.secondaryButton}
                onClick={() => setCancelTarget(null)}
                disabled={cancelling}
              >
                Keep
              </button>
              <button
                type="button"
                style={styles.dangerButton}
                onClick={confirmCancel}
                disabled={cancelling}
              >
                {cancelling ? 'Cancelling…' : 'Cancel booking'}
              </button>
            </div>
          </div>
        </div>
      )}

      {noShowTarget && (
        <div style={styles.modalBackdrop}>
          <div style={styles.modal}>
            <h3 style={styles.modalTitle}>Mark as no-show?</h3>
            <p style={styles.modalText}>
              {noShowTarget.customerName} · {dayjs(noShowTarget.startsAt).format('HH:mm')} ·{' '}
              {noShowTarget.serviceName}. Updates their no-show history for future risk scoring.
            </p>
            <div style={styles.modalActions}>
              <button
                type="button"
                style={styles.secondaryButton}
                onClick={() => setNoShowTarget(null)}
                disabled={markingNoShow}
              >
                Back
              </button>
              <button
                type="button"
                style={styles.noShowButton}
                onClick={confirmNoShow}
                disabled={markingNoShow}
              >
                {markingNoShow ? 'Saving…' : 'Mark no-show'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  href?: string;
}) {
  const inner = (
    <>
      <div style={styles.metricLabel}>{label}</div>
      <div style={styles.metricValue}>{value}</div>
      {hint && <div style={styles.metricHint}>{hint}</div>}
    </>
  );

  if (href) {
    return (
      <Link href={href} style={{ ...styles.metric, textDecoration: 'none', color: 'inherit' }}>
        {inner}
      </Link>
    );
  }

  return <div style={styles.metric}>{inner}</div>;
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 960,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 20,
    flexWrap: 'wrap',
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
  },
  headerActions: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },
  secondaryButton: {
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--ink-muted)',
    borderRadius: 'var(--radius-sm)',
    padding: '8px 12px',
    fontSize: 13,
    cursor: 'pointer',
  },
  secondaryLink: {
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--ink-muted)',
    borderRadius: 'var(--radius-sm)',
    padding: '8px 12px',
    fontSize: 13,
    textDecoration: 'none',
  },
  error: {
    background: 'var(--danger-bg)',
    color: 'var(--danger)',
    fontSize: 13,
    padding: '9px 11px',
    borderRadius: 'var(--radius-sm)',
    marginBottom: 12,
  },
  notice: {
    background: 'var(--warning-bg)',
    color: 'var(--warning)',
    fontSize: 13,
    padding: '9px 11px',
    borderRadius: 'var(--radius-sm)',
    marginBottom: 12,
  },
  loadingState: {
    color: 'var(--ink-muted)',
    padding: '40px 0',
  },
  metrics: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: 12,
    marginBottom: 28,
  },
  metric: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '16px 18px',
  },
  metricLabel: {
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--ink-muted)',
    marginBottom: 8,
  },
  metricValue: {
    fontSize: 28,
    fontWeight: 600,
    lineHeight: 1.1,
  },
  metricHint: {
    marginTop: 6,
    fontSize: 11,
    color: 'var(--ink-faint)',
  },
  timelineSection: {
    marginTop: 8,
  },
  timelineHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 12,
  },
  timelineTitle: {
    margin: 0,
    fontSize: 16,
    fontWeight: 600,
  },
  timelineLink: {
    fontSize: 13,
    color: 'var(--accent)',
    textDecoration: 'none',
    fontWeight: 500,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
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
  modalBackdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.35)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
    padding: 16,
  },
  modal: {
    background: 'var(--surface)',
    borderRadius: 'var(--radius)',
    padding: 24,
    width: '100%',
    maxWidth: 360,
    border: '1px solid var(--border)',
  },
  modalTitle: {
    margin: '0 0 8px',
    fontSize: 16,
  },
  modalText: {
    margin: '0 0 18px',
    fontSize: 13,
    color: 'var(--ink-muted)',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
  },
  dangerButton: {
    border: 'none',
    background: 'var(--danger)',
    color: '#fff',
    borderRadius: 'var(--radius-sm)',
    padding: '8px 12px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  noShowButton: {
    border: 'none',
    background: '#3f3f46',
    color: '#fff',
    borderRadius: 'var(--radius-sm)',
    padding: '8px 12px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
};
