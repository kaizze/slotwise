'use client';

import { useEffect, useState } from 'react';
import { servicesApi, ApiError, type DashboardService } from '@/lib/api-client';
import { SidePanel } from '@/components/SidePanel';
import { formStyles } from '@/components/form-styles';

const DEFAULT_COLOR = '#6366f1';

interface ServiceFormState {
  name: string;
  description: string;
  durationMinutes: string;
  price: string;
  color: string;
}

const EMPTY_FORM: ServiceFormState = {
  name: '',
  description: '',
  durationMinutes: '30',
  price: '0',
  color: DEFAULT_COLOR,
};

export function ServicesPage() {
  const [services, setServices] = useState<DashboardService[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<DashboardService | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await servicesApi.list();
      setServices(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load services.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setEditing(null);
    setPanelOpen(true);
  }

  function openEdit(service: DashboardService) {
    setEditing(service);
    setPanelOpen(true);
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Services</h1>
        <button style={styles.addButton} onClick={openCreate}>
          + Add service
        </button>
      </div>

      {error && <div style={formStyles.error}>{error}</div>}

      {loading ? (
        <div style={styles.loadingState}>Loading…</div>
      ) : services.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={styles.emptyTitle}>No services yet</div>
          <div style={styles.emptySubtitle}>Add the services your business offers — these show up in the booking widget and AI agent.</div>
        </div>
      ) : (
        <div style={styles.list}>
          {services.map((s) => (
            <button key={s.id} style={styles.row} onClick={() => openEdit(s)}>
              <span style={{ ...styles.dot, background: s.color }} />
              <span style={styles.rowName}>{s.name}</span>
              <span style={styles.rowMeta}>{s.durationMinutes} min</span>
              <span style={styles.rowPrice}>€{s.price.toFixed(0)}</span>
              {!s.isActive && <span style={styles.inactiveBadge}>Inactive</span>}
            </button>
          ))}
        </div>
      )}

      {panelOpen && (
        <ServiceFormPanel
          service={editing}
          onClose={() => setPanelOpen(false)}
          onSaved={() => {
            setPanelOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function ServiceFormPanel({
  service,
  onClose,
  onSaved,
}: {
  service: DashboardService | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ServiceFormState>(
    service
      ? {
          name: service.name,
          description: service.description ?? '',
          durationMinutes: String(service.durationMinutes),
          price: String(service.price),
          color: service.color,
        }
      : EMPTY_FORM
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof ServiceFormState>(key: K, value: ServiceFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    setError(null);

    const duration = parseInt(form.durationMinutes, 10);
    const price = parseFloat(form.price);

    if (!form.name.trim()) return setError('Name is required.');
    if (!Number.isFinite(duration) || duration <= 0) return setError('Duration must be a positive number.');
    if (!Number.isFinite(price) || price < 0) return setError('Price must be zero or more.');

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        durationMinutes: duration,
        price,
        color: form.color,
      };

      if (service) {
        await servicesApi.update(service.id, payload);
      } else {
        await servicesApi.create(payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save service.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate() {
    if (!service) return;
    setSaving(true);
    try {
      await servicesApi.deactivate(service.id);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove service.');
      setSaving(false);
    }
  }

  return (
    <SidePanel title={service ? 'Edit service' : 'Add service'} onClose={onClose}>
      {error && <div style={formStyles.error}>{error}</div>}

      <div style={formStyles.field}>
        <label style={formStyles.label}>Name</label>
        <input style={formStyles.input} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Haircut" />
      </div>

      <div style={formStyles.field}>
        <label style={formStyles.label}>Description (optional)</label>
        <textarea style={formStyles.textarea} value={form.description} onChange={(e) => set('description', e.target.value)} />
      </div>

      <div style={formStyles.row}>
        <div style={{ ...formStyles.field, ...formStyles.rowField }}>
          <label style={formStyles.label}>Duration (min)</label>
          <input
            style={formStyles.input}
            type="number"
            min={5}
            step={5}
            value={form.durationMinutes}
            onChange={(e) => set('durationMinutes', e.target.value)}
          />
        </div>
        <div style={{ ...formStyles.field, ...formStyles.rowField }}>
          <label style={formStyles.label}>Price (€)</label>
          <input
            style={formStyles.input}
            type="number"
            min={0}
            step={1}
            value={form.price}
            onChange={(e) => set('price', e.target.value)}
          />
        </div>
      </div>

      <div style={formStyles.field}>
        <label style={formStyles.label}>Color</label>
        <input
          style={{ ...formStyles.input, height: 38, padding: 4 }}
          type="color"
          value={form.color}
          onChange={(e) => set('color', e.target.value)}
        />
        <div style={formStyles.helpText}>Shown in the booking widget and calendar.</div>
      </div>

      <button style={formStyles.primaryButton} onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : service ? 'Save changes' : 'Add service'}
      </button>

      {service && (
        <button style={formStyles.dangerLinkButton} onClick={handleDeactivate} disabled={saving}>
          Remove service
        </button>
      )}
    </SidePanel>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 640,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: 600,
    margin: 0,
  },
  addButton: {
    padding: '8px 14px',
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    background: 'var(--accent)',
    color: 'var(--accent-ink)',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    textAlign: 'left',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '12px 14px',
    cursor: 'pointer',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    flexShrink: 0,
  },
  rowName: {
    fontSize: 14,
    fontWeight: 500,
    flex: 1,
  },
  rowMeta: {
    fontSize: 12,
    color: 'var(--ink-muted)',
  },
  rowPrice: {
    fontSize: 13,
    fontWeight: 600,
  },
  inactiveBadge: {
    fontSize: 11,
    color: 'var(--ink-muted)',
    background: 'var(--bg)',
    padding: '2px 7px',
    borderRadius: 999,
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
  },
  emptySubtitle: {
    fontSize: 13,
    color: 'var(--ink-muted)',
    marginTop: 4,
    maxWidth: 360,
    marginLeft: 'auto',
    marginRight: 'auto',
  },
};
