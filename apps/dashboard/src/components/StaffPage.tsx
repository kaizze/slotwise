'use client';

import { useEffect, useState } from 'react';
import { staffApi, servicesApi, ApiError, type DashboardStaff, type DashboardService, type WorkingHours } from '@/lib/api-client';
import { SidePanel } from '@/components/SidePanel';
import { formStyles } from '@/components/form-styles';

const DAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

interface StaffFormState {
  name: string;
  email: string;
  phone: string;
  serviceIds: string[];
  workingDays: Record<number, { enabled: boolean; startTime: string; endTime: string }>;
}

function emptyForm(): StaffFormState {
  const workingDays: StaffFormState['workingDays'] = {};
  for (const d of DAYS) {
    workingDays[d.value] = { enabled: d.value >= 1 && d.value <= 5, startTime: '09:00', endTime: '18:00' };
  }
  return { name: '', email: '', phone: '', serviceIds: [], workingDays };
}

function staffToForm(staff: DashboardStaff): StaffFormState {
  const workingDays: StaffFormState['workingDays'] = {};
  for (const d of DAYS) {
    const existing = staff.workingHours.find((wh) => wh.dayOfWeek === d.value);
    workingDays[d.value] = existing
      ? { enabled: true, startTime: existing.startTime, endTime: existing.endTime }
      : { enabled: false, startTime: '09:00', endTime: '18:00' };
  }
  return {
    name: staff.name,
    email: staff.email ?? '',
    phone: staff.phone ?? '',
    serviceIds: staff.services,
    workingDays,
  };
}

function formToWorkingHours(form: StaffFormState): WorkingHours[] {
  return DAYS.filter((d) => form.workingDays[d.value].enabled).map((d) => ({
    dayOfWeek: d.value,
    startTime: form.workingDays[d.value].startTime,
    endTime: form.workingDays[d.value].endTime,
  }));
}

export function StaffPage() {
  const [staff, setStaff] = useState<DashboardStaff[]>([]);
  const [services, setServices] = useState<DashboardService[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<DashboardStaff | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [staffResult, servicesResult] = await Promise.all([staffApi.list(), servicesApi.list()]);
      setStaff(staffResult);
      setServices(servicesResult);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load staff.');
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

  function openEdit(member: DashboardStaff) {
    setEditing(member);
    setPanelOpen(true);
  }

  function serviceNames(serviceIds: string[]): string {
    const names = serviceIds.map((id) => services.find((s) => s.id === id)?.name).filter(Boolean);
    return names.length > 0 ? names.join(', ') : 'No services assigned';
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Staff</h1>
        <button style={styles.addButton} onClick={openCreate}>
          + Add staff
        </button>
      </div>

      {error && <div style={formStyles.error}>{error}</div>}

      {loading ? (
        <div style={styles.loadingState}>Loading…</div>
      ) : staff.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={styles.emptyTitle}>No staff yet</div>
          <div style={styles.emptySubtitle}>Add the people who perform services — the slot optimizer schedules around their working hours.</div>
        </div>
      ) : (
        <div style={styles.list}>
          {staff.map((s) => (
            <button key={s.id} style={styles.row} onClick={() => openEdit(s)}>
              <span style={styles.avatar}>{s.name.charAt(0).toUpperCase()}</span>
              <span style={styles.rowInfo}>
                <span style={styles.rowName}>{s.name}</span>
                <span style={styles.rowMeta}>{serviceNames(s.services)}</span>
              </span>
              {!s.isActive && <span style={styles.inactiveBadge}>Inactive</span>}
            </button>
          ))}
        </div>
      )}

      {panelOpen && (
        <StaffFormPanel
          staff={editing}
          services={services}
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

function StaffFormPanel({
  staff,
  services,
  onClose,
  onSaved,
}: {
  staff: DashboardStaff | null;
  services: DashboardService[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<StaffFormState>(staff ? staffToForm(staff) : emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleService(id: string) {
    setForm((f) => ({
      ...f,
      serviceIds: f.serviceIds.includes(id) ? f.serviceIds.filter((s) => s !== id) : [...f.serviceIds, id],
    }));
  }

  function toggleDay(day: number) {
    setForm((f) => ({
      ...f,
      workingDays: { ...f.workingDays, [day]: { ...f.workingDays[day], enabled: !f.workingDays[day].enabled } },
    }));
  }

  function setDayTime(day: number, field: 'startTime' | 'endTime', value: string) {
    setForm((f) => ({
      ...f,
      workingDays: { ...f.workingDays, [day]: { ...f.workingDays[day], [field]: value } },
    }));
  }

  async function handleSave() {
    setError(null);
    if (!form.name.trim()) return setError('Name is required.');

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        serviceIds: form.serviceIds,
        workingHours: formToWorkingHours(form),
      };

      if (staff) {
        await staffApi.update(staff.id, payload);
      } else {
        await staffApi.create(payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save staff member.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate() {
    if (!staff) return;
    setSaving(true);
    try {
      await staffApi.deactivate(staff.id);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove staff member.');
      setSaving(false);
    }
  }

  return (
    <SidePanel title={staff ? 'Edit staff member' : 'Add staff member'} onClose={onClose}>
      {error && <div style={formStyles.error}>{error}</div>}

      <div style={formStyles.field}>
        <label style={formStyles.label}>Name</label>
        <input style={formStyles.input} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Maria Stavrakaki" />
      </div>

      <div style={formStyles.row}>
        <div style={{ ...formStyles.field, ...formStyles.rowField }}>
          <label style={formStyles.label}>Email (optional)</label>
          <input style={formStyles.input} type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
        </div>
        <div style={{ ...formStyles.field, ...formStyles.rowField }}>
          <label style={formStyles.label}>Phone (optional)</label>
          <input style={formStyles.input} type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
        </div>
      </div>

      <div style={formStyles.field}>
        <label style={formStyles.label}>Services they perform</label>
        {services.length === 0 ? (
          <div style={formStyles.helpText}>Add services first, then assign them here.</div>
        ) : (
          <div style={staffStyles.chipList}>
            {services.map((s) => {
              const selected = form.serviceIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleService(s.id)}
                  style={selected ? staffStyles.chipSelected : staffStyles.chip}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div style={formStyles.field}>
        <label style={formStyles.label}>Working hours</label>
        <div style={staffStyles.scheduleList}>
          {DAYS.map((d) => {
            const day = form.workingDays[d.value];
            return (
              <div key={d.value} style={staffStyles.scheduleRow}>
                <label style={staffStyles.dayToggle}>
                  <input type="checkbox" checked={day.enabled} onChange={() => toggleDay(d.value)} />
                  <span style={staffStyles.dayLabel}>{d.label}</span>
                </label>
                {day.enabled ? (
                  <div style={staffStyles.timeInputs}>
                    <input
                      type="time"
                      value={day.startTime}
                      onChange={(e) => setDayTime(d.value, 'startTime', e.target.value)}
                      style={staffStyles.timeInput}
                    />
                    <span style={staffStyles.timeSeparator}>–</span>
                    <input
                      type="time"
                      value={day.endTime}
                      onChange={(e) => setDayTime(d.value, 'endTime', e.target.value)}
                      style={staffStyles.timeInput}
                    />
                  </div>
                ) : (
                  <span style={staffStyles.dayOff}>Off</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <button style={formStyles.primaryButton} onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : staff ? 'Save changes' : 'Add staff member'}
      </button>

      {staff && (
        <button style={formStyles.dangerLinkButton} onClick={handleDeactivate} disabled={saving}>
          Remove staff member
        </button>
      )}
    </SidePanel>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { maxWidth: 640 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  title: { fontSize: 18, fontWeight: 600, margin: 0 },
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
  list: { display: 'flex', flexDirection: 'column', gap: 8 },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    textAlign: 'left',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '10px 14px',
    cursor: 'pointer',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    background: '#eef2ff',
    color: 'var(--accent)',
    fontSize: 13,
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rowInfo: { flex: 1, minWidth: 0 },
  rowName: { display: 'block', fontSize: 14, fontWeight: 500 },
  rowMeta: {
    display: 'block',
    fontSize: 12,
    color: 'var(--ink-muted)',
    marginTop: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  inactiveBadge: {
    fontSize: 11,
    color: 'var(--ink-muted)',
    background: 'var(--bg)',
    padding: '2px 7px',
    borderRadius: 999,
    flexShrink: 0,
  },
  loadingState: { padding: '48px 0', textAlign: 'center', color: 'var(--ink-muted)', fontSize: 13 },
  emptyState: { padding: '48px 20px', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 'var(--radius)' },
  emptyTitle: { fontSize: 14, fontWeight: 500 },
  emptySubtitle: { fontSize: 13, color: 'var(--ink-muted)', marginTop: 4, maxWidth: 360, marginLeft: 'auto', marginRight: 'auto' },
};

const staffStyles: Record<string, React.CSSProperties> = {
  chipList: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  chip: {
    padding: '5px 11px',
    borderRadius: 999,
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    fontSize: 12,
    color: 'var(--ink-muted)',
    cursor: 'pointer',
  },
  chipSelected: {
    padding: '5px 11px',
    borderRadius: 999,
    border: '1px solid var(--accent)',
    background: '#eef2ff',
    fontSize: 12,
    color: 'var(--accent)',
    fontWeight: 500,
    cursor: 'pointer',
  },
  scheduleList: { display: 'flex', flexDirection: 'column', gap: 6 },
  scheduleRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  dayToggle: { display: 'flex', alignItems: 'center', gap: 6, width: 64, flexShrink: 0 },
  dayLabel: { fontSize: 13 },
  timeInputs: { display: 'flex', alignItems: 'center', gap: 6, flex: 1, justifyContent: 'flex-end' },
  timeInput: {
    padding: '5px 7px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
    fontSize: 12,
    width: 90,
  },
  timeSeparator: { color: 'var(--ink-faint)', fontSize: 12 },
  dayOff: { fontSize: 12, color: 'var(--ink-faint)' },
};
