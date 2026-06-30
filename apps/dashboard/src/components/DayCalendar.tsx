'use client';

import { useEffect, useState, useCallback } from 'react';
import dayjs from 'dayjs';
import { bookingsApi, ApiError, type DashboardBooking } from '@/lib/api-client';
import { BookingCard } from './BookingCard';

export function DayCalendar() {
  const [selectedDate, setSelectedDate] = useState(() => dayjs().format('YYYY-MM-DD'));
  const [bookings, setBookings] = useState<DashboardBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<DashboardBooking | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const loadDay = useCallback(async (dateIso: string) => {
    setLoading(true);
    setError(null);
    try {
      const from = dayjs(dateIso).startOf('day').toISOString();
      const to = dayjs(dateIso).endOf('day').toISOString();
      const result = await bookingsApi.list(from, to);
      // Sort by start time — the API already does this, but defend against
      // any future change to that ordering since the UI depends on it.
      result.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      setBookings(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load bookings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDay(selectedDate);
  }, [selectedDate, loadDay]);

  async function confirmCancel() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await bookingsApi.cancel(cancelTarget.ref);
      setCancelTarget(null);
      await loadDay(selectedDate);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel booking.');
      setCancelTarget(null);
    } finally {
      setCancelling(false);
    }
  }

  const isToday = selectedDate === dayjs().format('YYYY-MM-DD');

  return (
    <div style={styles.container}>
      <div style={styles.toolbar}>
        <button style={styles.navButton} onClick={() => setSelectedDate((d) => dayjs(d).subtract(1, 'day').format('YYYY-MM-DD'))} aria-label="Previous day">
          ‹
        </button>
        <div style={styles.dateLabel}>
          <span style={styles.dateMain}>{dayjs(selectedDate).format('dddd, D MMMM')}</span>
          {isToday && <span style={styles.todayBadge}>Today</span>}
        </div>
        <button style={styles.navButton} onClick={() => setSelectedDate((d) => dayjs(d).add(1, 'day').format('YYYY-MM-DD'))} aria-label="Next day">
          ›
        </button>
        {!isToday && (
          <button style={styles.todayButton} onClick={() => setSelectedDate(dayjs().format('YYYY-MM-DD'))}>
            Today
          </button>
        )}
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {loading ? (
        <div style={styles.loadingState}>Loading…</div>
      ) : bookings.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={styles.emptyTitle}>No bookings on this day</div>
          <div style={styles.emptySubtitle}>New bookings from the widget or AI agent will show up here.</div>
        </div>
      ) : (
        <div style={styles.list}>
          {bookings.map((b) => (
            <BookingCard key={b.id} booking={b} onCancel={setCancelTarget} />
          ))}
        </div>
      )}

      {cancelTarget && (
        <div style={styles.modalOverlay} onClick={() => !cancelling && setCancelTarget(null)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalTitle}>Cancel this booking?</div>
            <div style={styles.modalBody}>
              {cancelTarget.customerName ?? 'This customer'}'s {cancelTarget.serviceName ?? 'appointment'} at{' '}
              {dayjs(cancelTarget.startsAt).format('HH:mm')} will be cancelled and they'll be notified by SMS.
            </div>
            <div style={styles.modalActions}>
              <button style={styles.modalSecondaryButton} onClick={() => setCancelTarget(null)} disabled={cancelling}>
                Keep booking
              </button>
              <button style={styles.modalDangerButton} onClick={confirmCancel} disabled={cancelling}>
                {cancelling ? 'Cancelling…' : 'Cancel booking'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 640,
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 20,
  },
  navButton: {
    width: 30,
    height: 30,
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--ink-muted)',
    fontSize: 16,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateLabel: {
    flex: 1,
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
  },
  dateMain: {
    fontSize: 16,
    fontWeight: 600,
  },
  todayBadge: {
    fontSize: 11,
    color: 'var(--accent)',
    background: '#eef2ff',
    padding: '2px 7px',
    borderRadius: 999,
    fontWeight: 500,
  },
  todayButton: {
    padding: '6px 12px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    fontSize: 12,
    color: 'var(--ink-muted)',
    cursor: 'pointer',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
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
  emptyTitle: {
    fontSize: 14,
    fontWeight: 500,
    color: 'var(--ink)',
  },
  emptySubtitle: {
    fontSize: 13,
    color: 'var(--ink-muted)',
    marginTop: 4,
  },
  error: {
    background: 'var(--danger-bg)',
    color: 'var(--danger)',
    fontSize: 13,
    padding: '9px 12px',
    borderRadius: 'var(--radius-sm)',
    marginBottom: 14,
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.35)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  modal: {
    width: 360,
    background: 'var(--surface)',
    borderRadius: 'var(--radius)',
    padding: 22,
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: 600,
    marginBottom: 8,
  },
  modalBody: {
    fontSize: 13,
    color: 'var(--ink-muted)',
    lineHeight: 1.5,
  },
  modalActions: {
    display: 'flex',
    gap: 8,
    marginTop: 18,
  },
  modalSecondaryButton: {
    flex: 1,
    padding: 10,
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    fontSize: 13,
    cursor: 'pointer',
  },
  modalDangerButton: {
    flex: 1,
    padding: 10,
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    background: 'var(--danger)',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
};
