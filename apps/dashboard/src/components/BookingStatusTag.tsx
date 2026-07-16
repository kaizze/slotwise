'use client';

export type BookingStatusValue =
  | 'confirmed'
  | 'pending'
  | 'requested'
  | 'cancelled'
  | 'no_show'
  | 'completed'
  | string;

interface StatusStyle {
  label: string;
  color: string;
  background: string;
  border: string;
}

const STATUS_STYLES: Record<string, StatusStyle> = {
  confirmed: {
    label: 'Confirmed',
    color: '#15803d',
    background: '#f0fdf4',
    border: '#bbf7d0',
  },
  pending: {
    label: 'Pending',
    color: '#a16207',
    background: '#fefce8',
    border: '#fde68a',
  },
  requested: {
    label: 'Requested',
    color: '#1d4ed8',
    background: '#eff6ff',
    border: '#bfdbfe',
  },
  cancelled: {
    label: 'Cancelled',
    color: '#b91c1c',
    background: '#fef2f2',
    border: '#fecaca',
  },
  no_show: {
    label: 'No show',
    color: '#3f3f46',
    background: '#f4f4f5',
    border: '#d4d4d8',
  },
  completed: {
    label: 'Completed',
    color: '#0f766e',
    background: '#f0fdfa',
    border: '#99f6e4',
  },
};

export function getBookingStatusStyle(status: BookingStatusValue): StatusStyle {
  return STATUS_STYLES[status] ?? {
    label: status.replace(/_/g, ' '),
    color: '#52525b',
    background: '#f4f4f5',
    border: '#e4e4e7',
  };
}

/** Compact colored status pill used on booking cards and calendar chips. */
export function BookingStatusTag({
  status,
  size = 'md',
}: {
  status: BookingStatusValue;
  size?: 'sm' | 'md';
}) {
  const style = getBookingStatusStyle(status);
  const compact = size === 'sm';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: compact ? 4 : 6,
        fontSize: compact ? 10 : 11,
        fontWeight: 600,
        lineHeight: 1,
        color: style.color,
        background: style.background,
        border: `1px solid ${style.border}`,
        padding: compact ? '2px 6px' : '3px 8px',
        borderRadius: 999,
        textTransform: 'capitalize' as const,
        whiteSpace: 'nowrap' as const,
      }}
    >
      <span
        aria-hidden
        style={{
          width: compact ? 6 : 7,
          height: compact ? 6 : 7,
          borderRadius: 999,
          background: style.color,
          flexShrink: 0,
        }}
      />
      {style.label}
    </span>
  );
}

export function BookingStatusLegend() {
  const order = ['confirmed', 'pending', 'requested', 'cancelled', 'no_show'] as const;
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        alignItems: 'center',
      }}
    >
      <span style={{ fontSize: 11, color: 'var(--ink-faint)', fontWeight: 500, marginRight: 2 }}>
        Status
      </span>
      {order.map((status) => (
        <BookingStatusTag key={status} status={status} size="sm" />
      ))}
    </div>
  );
}
