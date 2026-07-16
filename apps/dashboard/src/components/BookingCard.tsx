'use client';

import dayjs from 'dayjs';
import type { DashboardBooking } from '@/lib/api-client';
import { BookingStatusTag } from './BookingStatusTag';

const SERVICE_COLOR_FALLBACK = '#a1a1aa';

// Risk badge thresholds mirror the optimizer's noShowRisk scale (0–1).
function riskLabel(risk: number): { label: string; tone: 'warn' | 'danger' } | null {
  if (risk >= 0.5) return { label: 'High no-show risk', tone: 'danger' };
  if (risk >= 0.3) return { label: 'Elevated risk', tone: 'warn' };
  return null;
}

export function BookingCard({
  booking,
  onCancel,
}: {
  booking: DashboardBooking;
  onCancel: (booking: DashboardBooking) => void;
}) {
  const start = dayjs(booking.startsAt);
  const end = dayjs(booking.endsAt);
  const risk = riskLabel(booking.noShowRisk);
  const isCancellable =
    booking.status === 'confirmed'
    || booking.status === 'pending'
    || booking.status === 'requested';

  return (
    <div style={styles.card}>
      <div style={{ ...styles.edge, background: booking.serviceColor ?? SERVICE_COLOR_FALLBACK }} />
      <div style={styles.body}>
        <div style={styles.row}>
          <span style={styles.time}>
            {start.format('HH:mm')}–{end.format('HH:mm')}
          </span>
          <BookingStatusTag status={booking.status} />
          {risk && (
            <span style={risk.tone === 'danger' ? styles.riskBadgeDanger : styles.riskBadgeWarn}>
              {risk.label}
            </span>
          )}
        </div>
        <div style={styles.service}>{booking.serviceName ?? 'Service'}</div>
        <div style={styles.meta}>
          {booking.customerName ?? 'Customer'} · {booking.staffName ?? 'Staff'}
          {booking.customerPhone && ` · ${booking.customerPhone}`}
        </div>
      </div>
      {isCancellable && (
        <button style={styles.cancelButton} onClick={() => onCancel(booking)} aria-label="Cancel booking">
          Cancel
        </button>
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
  riskBadgeWarn: {
    fontSize: 11,
    color: 'var(--warning)',
    background: 'var(--warning-bg)',
    padding: '2px 7px',
    borderRadius: 999,
  },
  riskBadgeDanger: {
    fontSize: 11,
    color: 'var(--danger)',
    background: 'var(--danger-bg)',
    padding: '2px 7px',
    borderRadius: 999,
  },
  cancelButton: {
    flexShrink: 0,
    alignSelf: 'center',
    marginRight: 12,
    padding: '6px 12px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--ink-muted)',
    fontSize: 12,
    cursor: 'pointer',
  },
};
