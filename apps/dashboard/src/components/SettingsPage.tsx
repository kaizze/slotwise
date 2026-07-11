'use client';

import { useEffect, useState } from 'react';
import { businessSettingsApi, ApiError, type BusinessSettings } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { formStyles } from '@/components/form-styles';

export function SettingsPage() {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';

  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    businessSettingsApi
      .get()
      .then((biz) => setSettings(biz.settings as unknown as BusinessSettings))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load settings.'))
      .finally(() => setLoading(false));
  }, []);

  function update<K extends keyof BusinessSettings>(key: K, value: BusinessSettings[K]) {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
    setSaved(false);
  }

  async function handleSave() {
    if (!settings) return;
    setError(null);
    setSaving(true);
    try {
      const updated = await businessSettingsApi.update(settings);
      setSettings(updated.settings as unknown as BusinessSettings);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div style={styles.loadingState}>Loading…</div>;
  }

  if (!settings) {
    return <div style={formStyles.error}>{error ?? 'Settings unavailable.'}</div>;
  }

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Settings</h1>

      {!isOwner && (
        <div style={styles.readonlyNotice}>
          Only the business owner can change these settings. You can view them here.
        </div>
      )}

      {error && <div style={formStyles.error}>{error}</div>}
      {saved && <div style={styles.savedNotice}>Settings saved.</div>}

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Booking rules</h2>

        <div style={formStyles.row}>
          <div style={{ ...formStyles.field, ...formStyles.rowField }}>
            <label style={formStyles.label}>Default slot duration (min)</label>
            <input
              style={formStyles.input}
              type="number"
              min={5}
              step={5}
              value={settings.slotDurationMinutes}
              disabled={!isOwner}
              onChange={(e) => update('slotDurationMinutes', parseInt(e.target.value, 10) || 0)}
            />
          </div>
          <div style={{ ...formStyles.field, ...formStyles.rowField }}>
            <label style={formStyles.label}>Buffer between bookings (min)</label>
            <input
              style={formStyles.input}
              type="number"
              min={0}
              step={5}
              value={settings.bufferMinutes}
              disabled={!isOwner}
              onChange={(e) => update('bufferMinutes', parseInt(e.target.value, 10) || 0)}
            />
          </div>
        </div>

        <div style={formStyles.field}>
          <label style={formStyles.label}>How far ahead clients can book (days)</label>
          <input
            style={formStyles.input}
            type="number"
            min={1}
            value={settings.maxAdvanceDays}
            disabled={!isOwner}
            onChange={(e) => update('maxAdvanceDays', parseInt(e.target.value, 10) || 1)}
          />
        </div>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Channels</h2>

        <label style={formStyles.checkboxRow}>
          <input
            type="checkbox"
            checked={settings.agentEnabled}
            disabled={!isOwner}
            onChange={(e) => update('agentEnabled', e.target.checked)}
          />
          <span>
            AI agent booking channel
            <div style={formStyles.helpText}>Lets customers book by chatting — on your site, WhatsApp, or SMS.</div>
          </span>
        </label>

        <label style={formStyles.checkboxRow}>
          <input
            type="checkbox"
            checked={settings.smsEnabled}
            disabled={!isOwner}
            onChange={(e) => update('smsEnabled', e.target.checked)}
          />
          <span>
            SMS notifications
            <div style={formStyles.helpText}>Booking confirmations and reminders sent by text.</div>
          </span>
        </label>

        <label style={formStyles.checkboxRow}>
          <input
            type="checkbox"
            checked={settings.emailEnabled ?? true}
            disabled={!isOwner}
            onChange={(e) => update('emailEnabled', e.target.checked)}
          />
          <span>
            Email notifications
            <div style={formStyles.helpText}>Confirmations, reminders, and offers sent via email when a customer provides an address.</div>
          </span>
        </label>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>No-show protection</h2>

        <div style={formStyles.field}>
          <label style={formStyles.label}>Extra reminder threshold</label>
          <input
            style={formStyles.input}
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.noShowThreshold}
            disabled={!isOwner}
            onChange={(e) => update('noShowThreshold', parseFloat(e.target.value))}
          />
          <div style={formStyles.helpText}>
            Bookings scored above {Math.round(settings.noShowThreshold * 100)}% no-show risk get an extra reminder before the appointment.
          </div>
        </div>
      </section>

      {isOwner && (
        <button style={formStyles.primaryButton} onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { maxWidth: 480 },
  title: { fontSize: 18, fontWeight: 600, margin: '0 0 20px' },
  section: { marginBottom: 28 },
  sectionTitle: { fontSize: 13, fontWeight: 600, color: 'var(--ink-muted)', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.02em' },
  loadingState: { padding: '48px 0', textAlign: 'center', color: 'var(--ink-muted)', fontSize: 13 },
  readonlyNotice: {
    fontSize: 13,
    color: 'var(--ink-muted)',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '9px 12px',
    marginBottom: 16,
  },
  savedNotice: {
    fontSize: 13,
    color: '#15803d',
    background: '#f0fdf4',
    padding: '9px 12px',
    borderRadius: 'var(--radius-sm)',
    marginBottom: 16,
  },
};
