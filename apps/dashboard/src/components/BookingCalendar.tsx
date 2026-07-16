'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import Link from 'next/link';
import { bookingsApi, offersApi, ApiError, type DashboardBooking, type DashboardSlotOffer } from '@/lib/api-client';
import { BookingCard } from './BookingCard';
import { BookingStatusLegend, BookingStatusTag, getBookingStatusStyle } from './BookingStatusTag';

type CalendarView = 'day' | 'week' | 'month' | 'agenda';

const VIEWS: Array<{ id: CalendarView; label: string }> = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'agenda', label: 'Agenda' },
];

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SERVICE_COLOR_FALLBACK = '#a1a1aa'; // month density dots still use service color

/** Monday-start week (Europe). */
function startOfWeek(d: Dayjs): Dayjs {
  const day = d.day(); // 0=Sun … 6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  return d.add(diff, 'day').startOf('day');
}

function endOfWeek(d: Dayjs): Dayjs {
  return startOfWeek(d).add(6, 'day').endOf('day');
}

function rangeForView(view: CalendarView, anchor: Dayjs): { from: Dayjs; to: Dayjs } {
  if (view === 'day') {
    return { from: anchor.startOf('day'), to: anchor.endOf('day') };
  }
  if (view === 'week') {
    return { from: startOfWeek(anchor), to: endOfWeek(anchor) };
  }
  if (view === 'month') {
    const monthStart = anchor.startOf('month');
    const monthEnd = anchor.endOf('month');
    return { from: startOfWeek(monthStart), to: endOfWeek(monthEnd) };
  }
  // Agenda: 30 days from the selected date
  return { from: anchor.startOf('day'), to: anchor.add(29, 'day').endOf('day') };
}

function groupByDay(bookings: DashboardBooking[]): Map<string, DashboardBooking[]> {
  const map = new Map<string, DashboardBooking[]>();
  for (const b of bookings) {
    const key = dayjs(b.startsAt).format('YYYY-MM-DD');
    const list = map.get(key) ?? [];
    list.push(b);
    map.set(key, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }
  return map;
}

export function BookingCalendar() {
  const [view, setView] = useState<CalendarView>('day');
  const [selectedDate, setSelectedDate] = useState(() => dayjs().format('YYYY-MM-DD'));
  const [bookings, setBookings] = useState<DashboardBooking[]>([]);
  const [recentOffers, setRecentOffers] = useState<DashboardSlotOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<DashboardBooking | null>(null);
  const [noShowTarget, setNoShowTarget] = useState<DashboardBooking | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [markingNoShow, setMarkingNoShow] = useState(false);
  const [cancelNotice, setCancelNotice] = useState<string | null>(null);

  const anchor = useMemo(() => dayjs(selectedDate), [selectedDate]);
  const range = useMemo(() => rangeForView(view, anchor), [view, anchor]);
  const byDay = useMemo(() => groupByDay(bookings), [bookings]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { from, to } = rangeForView(view, dayjs(selectedDate));
      const [result, offers] = await Promise.all([
        bookingsApi.list(from.toISOString(), to.toISOString()),
        view === 'day'
          ? offersApi.list('all').catch(() => [] as DashboardSlotOffer[])
          : Promise.resolve([] as DashboardSlotOffer[]),
      ]);
      result.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      setBookings(result);
      setRecentOffers(offers.slice(0, 5));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load bookings.');
    } finally {
      setLoading(false);
    }
  }, [selectedDate, view]);

  useEffect(() => {
    load();
  }, [load]);

  function shift(delta: number) {
    if (view === 'day' || view === 'agenda') {
      setSelectedDate((d) => dayjs(d).add(delta, 'day').format('YYYY-MM-DD'));
    } else if (view === 'week') {
      setSelectedDate((d) => dayjs(d).add(delta, 'week').format('YYYY-MM-DD'));
    } else {
      setSelectedDate((d) => dayjs(d).add(delta, 'month').format('YYYY-MM-DD'));
    }
  }

  function goToday() {
    setSelectedDate(dayjs().format('YYYY-MM-DD'));
  }

  function openDay(dateIso: string) {
    setSelectedDate(dateIso);
    setView('day');
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await bookingsApi.cancel(cancelTarget.ref);
      setCancelTarget(null);
      setCancelNotice('Booking cancelled. Checking waitlist and rebook opportunities…');
      await load();
      setTimeout(() => {
        load();
        setCancelNotice('If a slot-fill opportunity was found, it appears under Slot filling.');
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

  const title = useMemo(() => {
    if (view === 'day') return anchor.format('dddd, D MMMM YYYY');
    if (view === 'week') {
      const start = startOfWeek(anchor);
      const end = endOfWeek(anchor);
      if (start.month() === end.month()) {
        return `${start.format('D')} – ${end.format('D MMMM YYYY')}`;
      }
      return `${start.format('D MMM')} – ${end.format('D MMM YYYY')}`;
    }
    if (view === 'month') return anchor.format('MMMM YYYY');
    return `From ${anchor.format('D MMMM YYYY')}`;
  }, [view, anchor]);

  const isTodaySelected = selectedDate === dayjs().format('YYYY-MM-DD');

  return (
    <div style={styles.container}>
      <div style={styles.toolbar}>
        <div style={styles.viewTabs}>
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              style={view === v.id ? styles.viewTabActive : styles.viewTab}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div style={styles.navRow}>
          <button type="button" style={styles.navButton} onClick={() => shift(-1)} aria-label="Previous">
            ‹
          </button>
          <div style={styles.dateLabel}>
            <span style={styles.dateMain}>{title}</span>
            {view === 'day' && isTodaySelected && <span style={styles.todayBadge}>Today</span>}
          </div>
          <button type="button" style={styles.navButton} onClick={() => shift(1)} aria-label="Next">
            ›
          </button>
          {!isTodaySelected && (
            <button type="button" style={styles.todayButton} onClick={goToday}>
              Today
            </button>
          )}
        </div>

        <BookingStatusLegend />
      </div>

      {error && <div style={styles.error}>{error}</div>}
      {cancelNotice && <div style={styles.notice}>{cancelNotice}</div>}

      {loading ? (
        <div style={styles.loadingState}>Loading…</div>
      ) : (
        <>
          {view === 'day' && (
            <DayView
              bookings={bookings}
              onCancel={setCancelTarget}
              onMarkNoShow={setNoShowTarget}
            />
          )}
          {view === 'week' && (
            <WeekView
              anchor={anchor}
              byDay={byDay}
              selectedDate={selectedDate}
              onSelectDay={openDay}
            />
          )}
          {view === 'month' && (
            <MonthView
              anchor={anchor}
              byDay={byDay}
              selectedDate={selectedDate}
              onSelectDay={openDay}
            />
          )}
          {view === 'agenda' && (
            <AgendaView
              from={range.from}
              to={range.to}
              byDay={byDay}
              onCancel={setCancelTarget}
              onMarkNoShow={setNoShowTarget}
            />
          )}
        </>
      )}

      {view === 'day' && recentOffers.length > 0 && (
        <div style={styles.activitySection}>
          <div style={styles.activityHeader}>
            <span style={styles.activityTitle}>Recent slot fills</span>
            <Link href="/fill" style={styles.activityLink}>View all</Link>
          </div>
          {recentOffers.map((o) => (
            <div key={o.id} style={styles.activityRow}>
              <span style={styles.activityBadge}>{o.offerType}</span>
              <span style={styles.activityText}>
                {o.customerName} · {dayjs(o.slotStartsAt).format('D MMM HH:mm')} · {o.status}
              </span>
            </div>
          ))}
        </div>
      )}

      {cancelTarget && (
        <div style={styles.modalOverlay} onClick={() => !cancelling && setCancelTarget(null)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalTitle}>Cancel this booking?</div>
            <div style={styles.modalBody}>
              {cancelTarget.customerName ?? 'This customer'}&apos;s {cancelTarget.serviceName ?? 'appointment'} at{' '}
              {dayjs(cancelTarget.startsAt).format('HH:mm')} will be cancelled and they&apos;ll be notified.
            </div>
            <div style={styles.modalActions}>
              <button type="button" style={styles.modalSecondaryButton} onClick={() => setCancelTarget(null)} disabled={cancelling}>
                Keep booking
              </button>
              <button type="button" style={styles.modalDangerButton} onClick={confirmCancel} disabled={cancelling}>
                {cancelling ? 'Cancelling…' : 'Cancel booking'}
              </button>
            </div>
          </div>
        </div>
      )}

      {noShowTarget && (
        <div style={styles.modalOverlay} onClick={() => !markingNoShow && setNoShowTarget(null)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalTitle}>Mark as no-show?</div>
            <div style={styles.modalBody}>
              {noShowTarget.customerName ?? 'This customer'} missed {noShowTarget.serviceName ?? 'their appointment'} at{' '}
              {dayjs(noShowTarget.startsAt).format('HH:mm')}. This updates their no-show history and future risk score.
            </div>
            <div style={styles.modalActions}>
              <button type="button" style={styles.modalSecondaryButton} onClick={() => setNoShowTarget(null)} disabled={markingNoShow}>
                Back
              </button>
              <button type="button" style={styles.modalNoShowButton} onClick={confirmNoShow} disabled={markingNoShow}>
                {markingNoShow ? 'Saving…' : 'Mark no-show'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DayView({
  bookings,
  onCancel,
  onMarkNoShow,
}: {
  bookings: DashboardBooking[];
  onCancel: (b: DashboardBooking) => void;
  onMarkNoShow: (b: DashboardBooking) => void;
}) {
  if (bookings.length === 0) {
    return (
      <div style={styles.emptyState}>
        <div style={styles.emptyTitle}>No bookings on this day</div>
        <div style={styles.emptySubtitle}>New bookings from the widget or AI agent will show up here.</div>
      </div>
    );
  }
  return (
    <div style={styles.list}>
      {bookings.map((b) => (
        <BookingCard key={b.id} booking={b} onCancel={onCancel} onMarkNoShow={onMarkNoShow} />
      ))}
    </div>
  );
}

function WeekView({
  anchor,
  byDay,
  selectedDate,
  onSelectDay,
}: {
  anchor: Dayjs;
  byDay: Map<string, DashboardBooking[]>;
  selectedDate: string;
  onSelectDay: (dateIso: string) => void;
}) {
  const start = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, i) => start.add(i, 'day'));
  const today = dayjs().format('YYYY-MM-DD');

  return (
    <div style={styles.weekGrid}>
      {days.map((day) => {
        const key = day.format('YYYY-MM-DD');
        const dayBookings = byDay.get(key) ?? [];
        const isToday = key === today;
        const isSelected = key === selectedDate;
        return (
          <div
            key={key}
            style={{
              ...styles.weekCol,
              ...(isSelected ? styles.weekColSelected : {}),
            }}
          >
            <button type="button" style={styles.weekColHeader} onClick={() => onSelectDay(key)}>
              <span style={styles.weekColDow}>{day.format('ddd')}</span>
              <span style={isToday ? styles.weekColDateToday : styles.weekColDate}>
                {day.format('D')}
              </span>
              <span style={styles.weekColCount}>
                {dayBookings.length === 0 ? '—' : `${dayBookings.length}`}
              </span>
            </button>
            <div style={styles.weekColBody}>
              {dayBookings.length === 0 ? (
                <div style={styles.weekEmpty}>Free</div>
              ) : (
                dayBookings.map((b) => {
                  const statusStyle = getBookingStatusStyle(b.status);
                  return (
                    <button
                      key={b.id}
                      type="button"
                      style={{
                        ...styles.weekChip,
                        borderLeftColor: statusStyle.color,
                        background: statusStyle.background,
                      }}
                      onClick={() => onSelectDay(key)}
                      title={`${dayjs(b.startsAt).format('HH:mm')} ${b.customerName ?? ''} · ${statusStyle.label}`}
                    >
                      <span style={styles.weekChipTime}>{dayjs(b.startsAt).format('HH:mm')}</span>
                      <span style={styles.weekChipText}>
                        {b.customerName ?? b.serviceName ?? 'Booking'}
                      </span>
                      <BookingStatusTag status={b.status} size="sm" />
                    </button>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MonthView({
  anchor,
  byDay,
  selectedDate,
  onSelectDay,
}: {
  anchor: Dayjs;
  byDay: Map<string, DashboardBooking[]>;
  selectedDate: string;
  onSelectDay: (dateIso: string) => void;
}) {
  const gridStart = startOfWeek(anchor.startOf('month'));
  const gridEnd = endOfWeek(anchor.endOf('month'));
  const days: Dayjs[] = [];
  let cursor = gridStart;
  while (cursor.isBefore(gridEnd) || cursor.isSame(gridEnd, 'day')) {
    days.push(cursor);
    cursor = cursor.add(1, 'day');
  }
  const today = dayjs().format('YYYY-MM-DD');
  const month = anchor.month();

  return (
    <div>
      <div style={styles.monthDowRow}>
        {WEEKDAYS.map((d) => (
          <div key={d} style={styles.monthDow}>{d}</div>
        ))}
      </div>
      <div style={styles.monthGrid}>
        {days.map((day) => {
          const key = day.format('YYYY-MM-DD');
          const dayBookings = byDay.get(key) ?? [];
          const inMonth = day.month() === month;
          const isToday = key === today;
          const isSelected = key === selectedDate;
          return (
            <button
              key={key}
              type="button"
              style={{
                ...styles.monthCell,
                ...(inMonth ? {} : styles.monthCellMuted),
                ...(isSelected ? styles.monthCellSelected : {}),
              }}
              onClick={() => onSelectDay(key)}
            >
              <span style={isToday ? styles.monthDateToday : styles.monthDate}>
                {day.format('D')}
              </span>
              {dayBookings.length > 0 && (
                <div style={styles.monthChips}>
                  {dayBookings.slice(0, 3).map((b) => (
                    <span
                      key={b.id}
                      style={{
                        ...styles.monthChip,
                        background: b.serviceColor ?? SERVICE_COLOR_FALLBACK,
                      }}
                      title={`${dayjs(b.startsAt).format('HH:mm')} ${b.customerName ?? b.serviceName ?? ''}`}
                    />
                  ))}
                  {dayBookings.length > 3 && (
                    <span style={styles.monthMore}>+{dayBookings.length - 3}</span>
                  )}
                </div>
              )}
              {dayBookings.length > 0 && (
                <span style={styles.monthCount}>{dayBookings.length}</span>
              )}
            </button>
          );
        })}
      </div>
      <p style={styles.monthHint}>Click a day to open the Day view.</p>
    </div>
  );
}

function AgendaView({
  from,
  to,
  byDay,
  onCancel,
  onMarkNoShow,
}: {
  from: Dayjs;
  to: Dayjs;
  byDay: Map<string, DashboardBooking[]>;
  onCancel: (b: DashboardBooking) => void;
  onMarkNoShow: (b: DashboardBooking) => void;
}) {
  const days: Dayjs[] = [];
  let cursor = from.startOf('day');
  const end = to.startOf('day');
  while (cursor.isBefore(end) || cursor.isSame(end, 'day')) {
    days.push(cursor);
    cursor = cursor.add(1, 'day');
  }

  const daysWithBookings = days.filter((d) => (byDay.get(d.format('YYYY-MM-DD')) ?? []).length > 0);

  if (daysWithBookings.length === 0) {
    return (
      <div style={styles.emptyState}>
        <div style={styles.emptyTitle}>Nothing in the next 30 days</div>
        <div style={styles.emptySubtitle}>Agenda lists upcoming bookings from the selected date.</div>
      </div>
    );
  }

  return (
    <div style={styles.agenda}>
      {daysWithBookings.map((day) => {
        const key = day.format('YYYY-MM-DD');
        const list = byDay.get(key) ?? [];
        return (
          <section key={key} style={styles.agendaSection}>
            <h3 style={styles.agendaHeading}>
              {day.format('dddd, D MMMM')}
              <span style={styles.agendaCount}>{list.length}</span>
            </h3>
            {list.map((b) => (
              <BookingCard key={b.id} booking={b} onCancel={onCancel} onMarkNoShow={onMarkNoShow} />
            ))}
          </section>
        );
      })}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 1100,
  },
  toolbar: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    marginBottom: 18,
  },
  viewTabs: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  },
  viewTab: {
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--ink-muted)',
    borderRadius: 'var(--radius-sm)',
    padding: '7px 12px',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
  },
  viewTabActive: {
    border: '1px solid var(--accent)',
    background: '#eef2ff',
    color: 'var(--accent)',
    borderRadius: 'var(--radius-sm)',
    padding: '7px 12px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  navRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
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
    minWidth: 0,
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
    maxWidth: 640,
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
  notice: {
    background: '#eef2ff',
    color: 'var(--accent)',
    fontSize: 13,
    padding: '9px 12px',
    borderRadius: 'var(--radius-sm)',
    marginBottom: 14,
  },
  weekGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
    gap: 8,
    overflowX: 'auto',
  },
  weekCol: {
    minWidth: 110,
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 280,
  },
  weekColSelected: {
    borderColor: 'var(--accent)',
    boxShadow: '0 0 0 1px var(--accent)',
  },
  weekColHeader: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    padding: '10px 6px 8px',
    border: 'none',
    borderBottom: '1px solid var(--border)',
    background: 'transparent',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  weekColDow: {
    fontSize: 11,
    color: 'var(--ink-muted)',
    fontWeight: 500,
  },
  weekColDate: {
    fontSize: 16,
    fontWeight: 600,
  },
  weekColDateToday: {
    fontSize: 16,
    fontWeight: 600,
    width: 28,
    height: 28,
    borderRadius: 999,
    background: 'var(--accent)',
    color: 'var(--accent-ink)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekColCount: {
    fontSize: 10,
    color: 'var(--ink-faint)',
  },
  weekColBody: {
    padding: 6,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    flex: 1,
  },
  weekEmpty: {
    fontSize: 11,
    color: 'var(--ink-faint)',
    textAlign: 'center',
    padding: '12px 0',
  },
  weekChip: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 1,
    textAlign: 'left',
    border: '1px solid var(--border)',
    borderLeftWidth: 3,
    borderRadius: 6,
    background: 'var(--bg)',
    padding: '5px 6px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    width: '100%',
  },
  weekChipTime: {
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--ink)',
  },
  weekChipText: {
    fontSize: 11,
    color: 'var(--ink-muted)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '100%',
  },
  monthDowRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: 6,
    marginBottom: 6,
  },
  monthDow: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--ink-faint)',
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
  },
  monthGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: 6,
  },
  monthCell: {
    minHeight: 88,
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--surface)',
    padding: 8,
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'inherit',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    position: 'relative',
  },
  monthCellMuted: {
    opacity: 0.45,
  },
  monthCellSelected: {
    borderColor: 'var(--accent)',
    boxShadow: '0 0 0 1px var(--accent)',
  },
  monthDate: {
    fontSize: 13,
    fontWeight: 600,
  },
  monthDateToday: {
    fontSize: 12,
    fontWeight: 600,
    width: 24,
    height: 24,
    borderRadius: 999,
    background: 'var(--accent)',
    color: 'var(--accent-ink)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthChips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 3,
    alignItems: 'center',
  },
  monthChip: {
    width: 8,
    height: 8,
    borderRadius: 999,
    display: 'inline-block',
  },
  monthMore: {
    fontSize: 10,
    color: 'var(--ink-muted)',
  },
  monthCount: {
    position: 'absolute',
    top: 8,
    right: 8,
    fontSize: 11,
    color: 'var(--ink-faint)',
    fontWeight: 500,
  },
  monthHint: {
    margin: '12px 0 0',
    fontSize: 12,
    color: 'var(--ink-faint)',
  },
  agenda: {
    display: 'flex',
    flexDirection: 'column',
    gap: 22,
    maxWidth: 640,
  },
  agendaSection: {
    display: 'flex',
    flexDirection: 'column',
  },
  agendaHeading: {
    margin: '0 0 10px',
    fontSize: 14,
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  agendaCount: {
    fontSize: 11,
    fontWeight: 500,
    color: 'var(--ink-muted)',
    background: 'var(--bg)',
    padding: '2px 7px',
    borderRadius: 999,
  },
  activitySection: {
    marginTop: 28,
    borderTop: '1px solid var(--border)',
    paddingTop: 16,
    maxWidth: 640,
  },
  activityHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  activityTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--ink-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.02em',
  },
  activityLink: {
    fontSize: 12,
    color: 'var(--accent)',
    textDecoration: 'none',
  },
  activityRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '7px 0',
    borderBottom: '1px solid var(--border)',
    fontSize: 12,
  },
  activityBadge: {
    fontSize: 10,
    fontWeight: 500,
    color: 'var(--accent)',
    background: '#eef2ff',
    padding: '2px 6px',
    borderRadius: 999,
    textTransform: 'capitalize',
  },
  activityText: {
    color: 'var(--ink-muted)',
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
  modalNoShowButton: {
    flex: 1,
    padding: 10,
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    background: '#3f3f46',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
};
