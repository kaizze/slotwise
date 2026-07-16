'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { analyticsApi, ApiError, type AnalyticsBucket, type AnalyticsReport } from '@/lib/api-client';
import { formStyles } from '@/components/form-styles';

type Preset = '7d' | '30d' | 'month' | 'custom';

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

function BarList({
  items,
  valueKey = 'count',
  emptyLabel,
}: {
  items: AnalyticsBucket[];
  valueKey?: 'count' | 'revenue';
  emptyLabel: string;
}) {
  const max = Math.max(...items.map((i) => i[valueKey]), 0);
  if (items.length === 0 || max === 0) {
    return <div style={styles.emptyChart}>{emptyLabel}</div>;
  }

  return (
    <div style={styles.barList}>
      {items.map((item) => {
        const value = item[valueKey];
        const width = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
        return (
          <div key={item.key} style={styles.barRow}>
            <div style={styles.barLabel}>{item.label}</div>
            <div style={styles.barTrack}>
              <div style={{ ...styles.barFill, width: `${width}%` }} />
            </div>
            <div style={styles.barValue}>{valueKey === 'revenue' ? value.toFixed(0) : value}</div>
          </div>
        );
      })}
    </div>
  );
}

export function AnalyticsPage() {
  const [preset, setPreset] = useState<Preset>('30d');
  const [from, setFrom] = useState(() => dayjs().subtract(29, 'day').format('YYYY-MM-DD'));
  const [to, setTo] = useState(() => dayjs().format('YYYY-MM-DD'));
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const applyPreset = useCallback((next: Preset) => {
    setPreset(next);
    const today = dayjs();
    if (next === '7d') {
      setFrom(today.subtract(6, 'day').format('YYYY-MM-DD'));
      setTo(today.format('YYYY-MM-DD'));
    } else if (next === '30d') {
      setFrom(today.subtract(29, 'day').format('YYYY-MM-DD'));
      setTo(today.format('YYYY-MM-DD'));
    } else if (next === 'month') {
      setFrom(today.startOf('month').format('YYYY-MM-DD'));
      setTo(today.format('YYYY-MM-DD'));
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await analyticsApi.get(from, to);
      setReport(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load analytics.');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const peakHours = useMemo(() => {
    if (!report) return [];
    return [...report.byHour]
      .filter((h) => h.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
  }, [report]);

  const hourChartItems = useMemo(() => {
    if (!report) return [];
    // Prefer hours with activity; fall back to full list for empty ranges
    const active = report.byHour.filter((h) => h.count > 0);
    return active.length > 0
      ? report.byHour.filter((h) => {
          const hour = Number(h.key);
          return (hour >= 8 && hour <= 20) || h.count > 0;
        })
      : report.byHour;
  }, [report]);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Analytics</h1>
          <p style={styles.subtitle}>
            Reservations, revenue, and busy hours for the selected period.
          </p>
        </div>
      </div>

      <div style={styles.filters}>
        <div style={styles.presets}>
          {([
            ['7d', 'Last 7 days'],
            ['30d', 'Last 30 days'],
            ['month', 'This month'],
            ['custom', 'Custom'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              style={preset === key ? styles.presetActive : styles.preset}
              onClick={() => applyPreset(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={styles.dateRow}>
          <label style={styles.dateField}>
            <span style={formStyles.label}>From</span>
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setPreset('custom');
                setFrom(e.target.value);
              }}
              style={formStyles.input}
            />
          </label>
          <label style={styles.dateField}>
            <span style={formStyles.label}>To</span>
            <input
              type="date"
              value={to}
              onChange={(e) => {
                setPreset('custom');
                setTo(e.target.value);
              }}
              style={formStyles.input}
            />
          </label>
          <button type="button" style={styles.refreshButton} onClick={load} disabled={loading}>
            {loading ? 'Loading…' : 'Apply'}
          </button>
        </div>
      </div>

      {error && <div style={formStyles.error}>{error}</div>}

      {loading && !report ? (
        <div style={styles.loadingState}>Loading…</div>
      ) : report ? (
        <>
          <div style={styles.metrics}>
            <Metric
              label="Reservations"
              value={String(report.totals.reservations)}
              hint={`${report.totals.confirmed} confirmed · ${report.totals.completed} completed`}
            />
            <Metric
              label="Revenue"
              value={formatMoney(report.totals.revenue, report.currency)}
              hint="From active bookings (current service prices)"
            />
            <Metric
              label="Cancelled"
              value={String(report.totals.cancelled)}
              hint={`${report.totals.noShows} no-shows`}
            />
            <Metric
              label="Peak hours"
              value={peakHours.length ? peakHours.map((h) => h.label).join(' · ') : '—'}
              hint={peakHours.length ? `${peakHours[0]!.count} bookings at top hour` : 'No bookings in range'}
            />
          </div>

          <p style={styles.tzNote}>Times in {report.timezone}</p>

          <div style={styles.grid}>
            <section style={styles.section}>
              <h2 style={styles.sectionTitle}>Demand by hour</h2>
              <p style={styles.sectionHint}>Which start times customers book most.</p>
              <BarList items={hourChartItems} emptyLabel="No bookings in this range." />
            </section>

            <section style={styles.section}>
              <h2 style={styles.sectionTitle}>Demand by weekday</h2>
              <p style={styles.sectionHint}>Busier days of the week.</p>
              <BarList items={report.byDayOfWeek} emptyLabel="No bookings in this range." />
            </section>

            <section style={styles.section}>
              <h2 style={styles.sectionTitle}>By service</h2>
              <p style={styles.sectionHint}>Volume and revenue per service.</p>
              {report.byService.length === 0 ? (
                <div style={styles.emptyChart}>No bookings in this range.</div>
              ) : (
                <div style={styles.table}>
                  <div style={styles.tableHead}>
                    <span>Service</span>
                    <span>Bookings</span>
                    <span>Revenue</span>
                  </div>
                  {report.byService.map((row) => (
                    <div key={row.key} style={styles.tableRow}>
                      <span>{row.label}</span>
                      <span>{row.count}</span>
                      <span>{formatMoney(row.revenue, report.currency)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section style={styles.section}>
              <h2 style={styles.sectionTitle}>By channel</h2>
              <p style={styles.sectionHint}>Where bookings came from.</p>
              <BarList items={report.byChannel} emptyLabel="No bookings in this range." />
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div style={styles.metric}>
      <div style={styles.metricLabel}>{label}</div>
      <div style={styles.metricValue}>{value}</div>
      <div style={styles.metricHint}>{hint}</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 1100,
  },
  header: {
    marginBottom: 20,
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
  filters: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    marginBottom: 20,
  },
  presets: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  preset: {
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--ink-muted)',
    borderRadius: 'var(--radius-sm)',
    padding: '7px 12px',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
  },
  presetActive: {
    border: '1px solid var(--accent)',
    background: '#eef2ff',
    color: 'var(--accent)',
    borderRadius: 'var(--radius-sm)',
    padding: '7px 12px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  dateRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'flex-end',
  },
  dateField: {
    display: 'block',
    minWidth: 150,
  },
  refreshButton: {
    border: 'none',
    background: 'var(--accent)',
    color: 'var(--accent-ink)',
    borderRadius: 'var(--radius-sm)',
    padding: '9px 16px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    height: 38,
  },
  loadingState: {
    color: 'var(--ink-muted)',
    padding: '40px 0',
  },
  metrics: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 12,
    marginBottom: 8,
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
    marginBottom: 6,
  },
  metricValue: {
    fontSize: 22,
    fontWeight: 600,
    lineHeight: 1.2,
  },
  metricHint: {
    marginTop: 6,
    fontSize: 11,
    color: 'var(--ink-faint)',
  },
  tzNote: {
    margin: '0 0 18px',
    fontSize: 12,
    color: 'var(--ink-faint)',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: 16,
  },
  section: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '18px 18px 14px',
  },
  sectionTitle: {
    margin: 0,
    fontSize: 15,
    fontWeight: 600,
  },
  sectionHint: {
    margin: '4px 0 14px',
    fontSize: 12,
    color: 'var(--ink-muted)',
  },
  barList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  barRow: {
    display: 'grid',
    gridTemplateColumns: '52px 1fr 36px',
    gap: 8,
    alignItems: 'center',
  },
  barLabel: {
    fontSize: 12,
    color: 'var(--ink-muted)',
  },
  barTrack: {
    height: 8,
    background: 'var(--bg)',
    borderRadius: 999,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    background: 'var(--accent)',
    borderRadius: 999,
  },
  barValue: {
    fontSize: 12,
    fontWeight: 600,
    textAlign: 'right',
  },
  emptyChart: {
    fontSize: 13,
    color: 'var(--ink-faint)',
    padding: '12px 0',
  },
  table: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
  },
  tableHead: {
    display: 'grid',
    gridTemplateColumns: '1fr 80px 90px',
    gap: 8,
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--ink-faint)',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
    paddingBottom: 8,
    borderBottom: '1px solid var(--border)',
  },
  tableRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 80px 90px',
    gap: 8,
    fontSize: 13,
    padding: '10px 0',
    borderBottom: '1px solid var(--border)',
  },
};
