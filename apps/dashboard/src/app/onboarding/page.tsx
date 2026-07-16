'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { RequireAuth } from '@/components/RequireAuth';
import { useAuth } from '@/lib/auth-context';
import { ApiError, servicesApi, staffApi } from '@/lib/api-client';
import { DEFAULT_WEEKDAY_HOURS, fetchSetupStatus, type SetupStatus } from '@/lib/onboarding';

type Step = 'service' | 'staff' | 'done';

export default function OnboardingPage() {
  return (
    <RequireAuth>
      <OnboardingWizard />
    </RequireAuth>
  );
}

function OnboardingWizard() {
  const { business, logout } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<Step>('service');
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Service form
  const [serviceName, setServiceName] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('30');
  const [price, setPrice] = useState('0');
  const [savingService, setSavingService] = useState(false);

  // Staff form
  const [staffName, setStaffName] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('18:00');
  const [savingStaff, setSavingStaff] = useState(false);

  async function refreshSetup() {
    const status = await fetchSetupStatus();
    setSetup(status);

    if (status.complete) {
      setStep('done');
      return status;
    }

    if (status.hasServices && !status.hasStaff) {
      setStep('staff');
      if (!serviceId) {
        const services = await servicesApi.list();
        setServiceId(services[0]?.id ?? null);
      }
    } else if (!status.hasServices) {
      setStep('service');
    }

    return status;
  }

  useEffect(() => {
    let cancelled = false;
    fetchSetupStatus()
      .then(async (status) => {
        if (cancelled) return;
        setSetup(status);
        if (status.complete) {
          setStep('done');
        } else if (status.hasServices) {
          setStep('staff');
          const services = await servicesApi.list();
          if (!cancelled) setServiceId(services[0]?.id ?? null);
        } else {
          setStep('service');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load setup status.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreateService(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSavingService(true);
    try {
      const created = await servicesApi.create({
        name: serviceName.trim(),
        durationMinutes: Number(durationMinutes) || 30,
        price: Number(price) || 0,
      });
      setServiceId(created.id);
      setServiceName('');
      await refreshSetup();
      setStep('staff');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create service.');
    } finally {
      setSavingService(false);
    }
  }

  async function handleCreateStaff(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSavingStaff(true);
    try {
      let assignedServiceId = serviceId;
      if (!assignedServiceId) {
        const services = await servicesApi.list();
        assignedServiceId = services[0]?.id ?? null;
      }
      if (!assignedServiceId) {
        setError('Add a service first.');
        setStep('service');
        return;
      }

      await staffApi.create({
        name: staffName.trim(),
        email: staffEmail.trim() || undefined,
        serviceIds: [assignedServiceId],
        workingHours: DEFAULT_WEEKDAY_HOURS.map((h) => ({
          ...h,
          startTime,
          endTime,
        })),
      });
      await refreshSetup();
      setStep('done');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create staff.');
    } finally {
      setSavingStaff(false);
    }
  }

  async function handleFinish() {
    router.push('/');
  }

  async function handleSignOut() {
    await logout();
    router.push('/login');
  }

  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.muted}>Loading…</div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.topRow}>
          <div>
            <h1 style={styles.title}>Set up {business?.name ?? 'your business'}</h1>
            <p style={styles.subtitle}>
              Two quick steps so customers can book — a service and someone who can do it.
            </p>
          </div>
          <button type="button" style={styles.textButton} onClick={handleSignOut}>
            Sign out
          </button>
        </div>

        <ol style={styles.steps}>
          <li style={stepStyle(step === 'service', !!setup?.hasServices)}>1. Service</li>
          <li style={stepStyle(step === 'staff', !!setup?.hasStaff)}>2. Staff</li>
          <li style={stepStyle(step === 'done', step === 'done')}>3. Ready</li>
        </ol>

        {error && <div style={styles.error}>{error}</div>}

        {step === 'service' && (
          <form onSubmit={handleCreateService}>
            <p style={styles.lead}>What do customers book first?</p>

            <label style={styles.label} htmlFor="serviceName">Service name</label>
            <input
              id="serviceName"
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              style={styles.input}
              placeholder="e.g. Haircut"
              required
            />

            <div style={styles.row}>
              <div style={styles.rowField}>
                <label style={styles.label} htmlFor="duration">Duration (min)</label>
                <input
                  id="duration"
                  type="number"
                  min={5}
                  step={5}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value)}
                  style={styles.input}
                  required
                />
              </div>
              <div style={styles.rowField}>
                <label style={styles.label} htmlFor="price">Price (€)</label>
                <input
                  id="price"
                  type="number"
                  min={0}
                  step={0.5}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  style={styles.input}
                  required
                />
              </div>
            </div>

            <button type="submit" style={styles.button} disabled={savingService}>
              {savingService ? 'Saving…' : 'Continue'}
            </button>
          </form>
        )}

        {step === 'staff' && (
          <form onSubmit={handleCreateStaff}>
            <p style={styles.lead}>Who performs that service?</p>
            <p style={styles.hint}>Default hours: Mon–Fri. You can change this later under Staff.</p>

            <label style={styles.label} htmlFor="staffName">Name</label>
            <input
              id="staffName"
              value={staffName}
              onChange={(e) => setStaffName(e.target.value)}
              style={styles.input}
              required
            />

            <label style={styles.label} htmlFor="staffEmail">Email (optional)</label>
            <input
              id="staffEmail"
              type="email"
              value={staffEmail}
              onChange={(e) => setStaffEmail(e.target.value)}
              style={styles.input}
            />

            <div style={styles.row}>
              <div style={styles.rowField}>
                <label style={styles.label} htmlFor="startTime">Starts</label>
                <input
                  id="startTime"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  style={styles.input}
                  required
                />
              </div>
              <div style={styles.rowField}>
                <label style={styles.label} htmlFor="endTime">Ends</label>
                <input
                  id="endTime"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  style={styles.input}
                  required
                />
              </div>
            </div>

            <button type="submit" style={styles.button} disabled={savingStaff}>
              {savingStaff ? 'Saving…' : 'Finish setup'}
            </button>
          </form>
        )}

        {step === 'done' && (
          <div>
            <p style={styles.lead}>You&apos;re ready to take bookings.</p>
            <ul style={styles.checklist}>
              <li>Service{setup && setup.serviceCount > 1 ? 's' : ''} added</li>
              <li>Staff added with weekday hours</li>
              {business?.slug && (
                <li>
                  Widget slug: <code style={styles.code}>{business.slug}</code>
                </li>
              )}
            </ul>
            <p style={styles.hint}>
              Add more services and staff anytime from the dashboard. Turn on the AI agent in Settings when you want chat bookings.
            </p>
            <button type="button" style={styles.button} onClick={handleFinish}>
              Open calendar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function stepStyle(active: boolean, done: boolean): React.CSSProperties {
  return {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: 600,
    padding: '8px 6px',
    borderRadius: 'var(--radius-sm)',
    background: active ? 'var(--accent)' : done ? '#eef2ff' : 'var(--bg)',
    color: active ? 'var(--accent-ink)' : done ? 'var(--accent)' : 'var(--ink-muted)',
  };
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg)',
    padding: '32px 16px',
  },
  card: {
    width: '100%',
    maxWidth: 440,
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '32px 28px',
  },
  topRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'flex-start',
  },
  title: {
    margin: 0,
    fontSize: 20,
    fontWeight: 600,
  },
  subtitle: {
    margin: '4px 0 0',
    color: 'var(--ink-muted)',
    fontSize: 13,
  },
  steps: {
    listStyle: 'none',
    display: 'flex',
    gap: 8,
    padding: 0,
    margin: '22px 0 18px',
  },
  lead: {
    margin: '0 0 8px',
    fontSize: 14,
    fontWeight: 500,
  },
  hint: {
    margin: '0 0 14px',
    fontSize: 12,
    color: 'var(--ink-faint)',
  },
  label: {
    display: 'block',
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--ink-muted)',
    marginBottom: 5,
    marginTop: 14,
  },
  input: {
    width: '100%',
    padding: '9px 11px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
    fontSize: 14,
    background: 'var(--surface)',
  },
  row: {
    display: 'flex',
    gap: 10,
  },
  rowField: {
    flex: 1,
    minWidth: 0,
  },
  button: {
    width: '100%',
    marginTop: 22,
    padding: 11,
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    background: 'var(--accent)',
    color: 'var(--accent-ink)',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  textButton: {
    border: 'none',
    background: 'transparent',
    color: 'var(--ink-muted)',
    fontSize: 12,
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
  },
  error: {
    background: 'var(--danger-bg)',
    color: 'var(--danger)',
    fontSize: 13,
    padding: '9px 11px',
    borderRadius: 'var(--radius-sm)',
    marginBottom: 8,
  },
  checklist: {
    margin: '12px 0 8px',
    paddingLeft: 18,
    color: 'var(--ink)',
    fontSize: 14,
    lineHeight: 1.7,
  },
  code: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12,
    background: 'var(--bg)',
    padding: '2px 6px',
    borderRadius: 4,
  },
  muted: {
    color: 'var(--ink-muted)',
  },
};
