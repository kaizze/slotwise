'use client';

import dayjs from 'dayjs';
import type { DashboardBooking } from '@/lib/api-client';
import { BookingStatusTag, NoShowRiskTag } from './BookingStatusTag';

const SERVICE_COLOR_FALLBACK = '#a1a1aa';

export function BookingCard({
  booking,
  onCancel,
  onMarkNoShow,
}: {
  booking: DashboardBooking;
  onCancel: (booking: DashboardBooking) => void;
  onMarkNoShow?: (booking: DashboardBooking) => void;
}) {
  const start = dayjs(booking.startsAt);
  const end = dayjs(booking.endsAt);
  const isCancellable =
    booking.status === 'confirmed'
    || booking.status === 'pending'
    || booking.status === 'requested';
  // Admin can mark no-show on confirmed or completed (after auto-complete)
  const canMarkNoShow =
    (booking.status === 'confirmed' || booking.status === 'completed')
    && !!onMarkNoShow;

  return (
    <div style={styles.card}>
      <div style={{ ...styles.edge, background: booking.serviceColor ?? SERVICE_COLOR_FALLBACK }} />
      <div style={styles.body}>
        <div style={styles.row}>
          <span style={styles.time}>
            {start.format('HH:mm')}–{end.format('HH:mm')}
          </span>
          <BookingStatusTag status={booking.status} />
          <NoShowRiskTag score={booking.noShowRisk} />
        </div>
        <div style={styles.service}>{booking.serviceName ?? 'Service'}</div>
        <div style={styles.meta}>
          {booking.customerName ?? 'Customer'} · {booking.staffName ?? 'Staff'}
          {booking.customerPhone && ` · ${booking.customerPhone}`}
        </div>
      </div>
      {(isCancellable || canMarkNoShow) && (
        <div style={styles.actions}>
          {canMarkNoShow && (
            <button
              type="button"
              style={styles.noShowButton}
              onClick={() => onMarkNoShow?.(booking)}
            >
              No-show
            </button>
          )}
          {isCancellable && (
            <button
              type="button"
              style={styles.cancelButton}
              onClick={() => onCancel(booking)}
              aria-label="Cancel booking"
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    display: 'flex',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    overflow: 'hidden',
    marginBottom: 8,
  },
  edge: {
    width: 4,
    flexShrink: 0,
  },
  body: {
    flex: 1,
    padding: '10px 14px',
    minWidth: 0,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  time: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--ink)',
  },
  service: {
    fontSize: 14,
    fontWeight: 500,
    color: 'var(--ink)',
    marginTop: 2,
  },
  meta: {
    fontSize: 12,
    color: 'var(--ink-muted)',
    marginTop: 2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    alignSelf: 'center',
    marginRight: 12,
    flexShrink: 0,
  },
  cancelButton: {
    padding: '6px 12px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--ink-muted)',
    fontSize: 12,
    cursor: 'pointer',
  },
  noShowButton: {
    padding: '6px 12px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid #d4d4d8',
    background: '#f4f4f5',
    color: '#3f3f46',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
};
