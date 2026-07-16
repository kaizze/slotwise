'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import dayjs from 'dayjs';
import {
  customersApi,
  staffApi,
  ApiError,
  type CrmCustomerDetail,
  type DashboardStaff,
} from '@/lib/api-client';
import { formatLastVisit, formatMoney } from '@/lib/format';
import { formStyles } from '@/components/form-styles';
import { BookingStatusTag } from '@/components/BookingStatusTag';

export function CustomerDetailPage({ customerId }: { customerId: string }) {
  const [customer, setCustomer] = useState<CrmCustomerDetail | null>(null);
  const [staff, setStaff] = useState<DashboardStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const [notes, setNotes] = useState('');
  const [preferences, setPreferences] = useState('');
  const [favouriteStaffId, setFavouriteStaffId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [detail, staffList] = await Promise.all([
        customersApi.get(customerId),
        staffApi.list().catch(() => [] as DashboardStaff[]),
      ]);
      setCustomer(detail);
      setStaff(staffList);
      setNotes(detail.notes ?? '');
      setPreferences(detail.preferences ?? '');
      setFavouriteStaffId(detail.favouriteStaffId ?? '');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load customer.');
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSavedNotice(null);
    try {
      const updated = await customersApi.update(customerId, {
        notes: notes.trim() || null,
        preferences: preferences.trim() || null,
        favouriteStaffId: favouriteStaffId || null,
      });
      setCustomer(updated);
      setSavedNotice('Saved');
      setTimeout(() => setSavedNotice(null), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  if (loading && !customer) {
    return <div style={styles.muted}>Loading…</div>;
  }

  if (!customer) {
    return (
      <div>
        {error && <div style={formStyles.error}>{error}</div>}
        <Link href="/customers" style={styles.back}>← Customers</Link>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <Link href="/customers" style={styles.back}>← Customers</Link>

      <header style={styles.header}>
        <div style={styles.avatar}>{customer.name.charAt(0).toUpperCase()}</div>
        <div>
          <h1 style={styles.title}>{customer.name}</h1>
          <p style={styles.subtitle}>
            {customer.phone}
            {customer.email ? ` · ${customer.email}` : ''}
          </p>
        </div>
      </header>

      {error && <div style={formStyles.error}>{error}</div>}
      {savedNotice && <div style={styles.notice}>{savedNotice}</div>}

      <div style={styles.metrics}>
        <Metric label="Last visit" value={formatLastVisit(customer.lastVisitAt)} />
        <Metric label="Total spent" value={formatMoney(customer.totalSpent, customer.currency)} />
        <Metric label="Bookings" value={String(customer.bookingsCount)} />
        <Metric label="No shows" value={String(customer.noShows)} />
      </div>

      <form onSubmit={handleSave} style={styles.form}>
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Notes</h2>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={formStyles.textarea}
            placeholder="Internal notes about this customer…"
            rows={4}
          />
        </section>

        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Preferences</h2>
          <textarea
            value={preferences}
            onChange={(e) => setPreferences(e.target.value)}
            style={formStyles.textarea}
            placeholder="e.g. prefers mornings, allergic to product X…"
            rows={3}
          />
        </section>

        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Favourite employee</h2>
          <select
            value={favouriteStaffId}
            onChange={(e) => setFavouriteStaffId(e.target.value)}
            style={formStyles.input}
          >
            <option value="">
              Auto — most booked
              {customer.favouriteEmployee && !favouriteStaffId
                ? ` (${customer.favouriteEmployee.name})`
                : ''}
            </option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <p style={formStyles.helpText}>
            Auto uses who they book with most. Pick someone to pin a favourite.
          </p>
        </section>

        <button type="submit" style={{ ...formStyles.primaryButton, maxWidth: 200 }} disabled={saving}>
          {saving ? 'Saving…' : 'Save profile'}
        </button>
      </form>

      <section style={{ ...styles.section, marginTop: 28 }}>
        <h2 style={styles.sectionTitle}>Recent bookings</h2>
        {customer.recentBookings.length === 0 ? (
          <p style={styles.muted}>No bookings yet.</p>
        ) : (
          <div style={styles.bookingList}>
            {customer.recentBookings.map((b) => (
              <div key={b.id} style={styles.bookingRow}>
                <div>
                  <div style={styles.bookingWhen}>
                    {dayjs(b.startsAt).format('D MMM YYYY, HH:mm')}
                  </div>
                  <div style={styles.bookingMeta}>
                    {b.serviceName} · {b.staffName} · {formatMoney(b.price, customer.currency)}
                  </div>
                </div>
                <BookingStatusTag status={b.status} size="sm" />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.metric}>
      <div style={styles.metricLabel}>{label}</div>
      <div style={styles.metricValue}>{value}</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { maxWidth: 720 },
  back: {
    display: 'inline-block',
    marginBottom: 16,
    fontSize: 13,
    color: 'var(--accent)',
    textDecoration: 'none',
    fontWeight: 500,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    marginBottom: 22,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 999,
    background: '#eef2ff',
    color: 'var(--accent)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: 22,
    flexShrink: 0,
  },
  title: { margin: 0, fontSize: 24, fontWeight: 600 },
  subtitle: { margin: '4px 0 0', color: 'var(--ink-muted)', fontSize: 13 },
  metrics: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: 12,
    marginBottom: 24,
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
    fontSize: 22,
    fontWeight: 600,
    lineHeight: 1.15,
  },
  form: { display: 'flex', flexDirection: 'column', gap: 4 },
  section: { marginBottom: 18 },
  sectionTitle: {
    margin: '0 0 8px',
    fontSize: 14,
    fontWeight: 600,
  },
  notice: {
    background: '#f0fdf4',
    color: '#15803d',
    fontSize: 13,
    padding: '9px 11px',
    borderRadius: 'var(--radius-sm)',
    marginBottom: 14,
  },
  muted: { color: 'var(--ink-muted)', fontSize: 13 },
  bookingList: { display: 'flex', flexDirection: 'column', gap: 8 },
  bookingRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    padding: '12px 14px',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
  },
  bookingWhen: { fontSize: 13, fontWeight: 600 },
  bookingMeta: { fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 },
};
