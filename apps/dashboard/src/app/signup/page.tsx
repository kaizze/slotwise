'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { BUSINESS_TYPES, TIMEZONES, slugifyBusinessName } from '@/lib/onboarding';

export default function SignupPage() {
  const { signup, status } = useAuth();
  const router = useRouter();

  const [businessName, setBusinessName] = useState('');
  const [businessSlug, setBusinessSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [businessType, setBusinessType] = useState('hair_salon');
  const [timezone, setTimezone] = useState('Europe/Athens');
  const [locale, setLocale] = useState('el');
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/onboarding');
    }
  }, [status, router]);

  useEffect(() => {
    if (!slugTouched) {
      setBusinessSlug(slugifyBusinessName(businessName));
    }
  }, [businessName, slugTouched]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await signup({
        businessName: businessName.trim(),
        businessSlug: businessSlug.trim(),
        businessType,
        ownerName: ownerName.trim(),
        ownerEmail: ownerEmail.trim(),
        ownerPassword,
        timezone,
        locale,
      });
      router.push('/onboarding');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create your account. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.page}>
      <form style={styles.card} onSubmit={handleSubmit}>
        <h1 style={styles.title}>SlotWise</h1>
        <p style={styles.subtitle}>Create your business account to start taking bookings.</p>

        {error && <div style={styles.error}>{error}</div>}

        <p style={styles.section}>Business</p>

        <label style={styles.label} htmlFor="businessName">Business name</label>
        <input
          id="businessName"
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          style={styles.input}
          required
          autoComplete="organization"
        />

        <label style={styles.label} htmlFor="businessSlug">URL slug</label>
        <input
          id="businessSlug"
          value={businessSlug}
          onChange={(e) => {
            setSlugTouched(true);
            setBusinessSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
          }}
          style={styles.input}
          pattern="[a-z0-9-]+"
          required
          autoComplete="off"
        />
        <p style={styles.hint}>Used in your booking widget — e.g. /{businessSlug || 'your-salon'}</p>

        <div style={styles.row}>
          <div style={styles.rowField}>
            <label style={styles.label} htmlFor="businessType">Type</label>
            <select
              id="businessType"
              value={businessType}
              onChange={(e) => setBusinessType(e.target.value)}
              style={styles.input}
            >
              {BUSINESS_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div style={styles.rowField}>
            <label style={styles.label} htmlFor="timezone">Timezone</label>
            <select
              id="timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              style={styles.input}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </div>
        </div>

        <label style={styles.label} htmlFor="locale">Language</label>
        <select
          id="locale"
          value={locale}
          onChange={(e) => setLocale(e.target.value)}
          style={styles.input}
        >
          <option value="el">Greek</option>
          <option value="en">English</option>
        </select>

        <p style={styles.section}>Owner login</p>

        <label style={styles.label} htmlFor="ownerName">Your name</label>
        <input
          id="ownerName"
          value={ownerName}
          onChange={(e) => setOwnerName(e.target.value)}
          style={styles.input}
          required
          autoComplete="name"
        />

        <label style={styles.label} htmlFor="ownerEmail">Email</label>
        <input
          id="ownerEmail"
          type="email"
          value={ownerEmail}
          onChange={(e) => setOwnerEmail(e.target.value)}
          style={styles.input}
          required
          autoComplete="email"
        />

        <label style={styles.label} htmlFor="ownerPassword">Password</label>
        <input
          id="ownerPassword"
          type="password"
          value={ownerPassword}
          onChange={(e) => setOwnerPassword(e.target.value)}
          style={styles.input}
          minLength={8}
          required
          autoComplete="new-password"
        />
        <p style={styles.hint}>At least 8 characters.</p>

        <button type="submit" style={styles.button} disabled={submitting}>
          {submitting ? 'Creating…' : 'Create account'}
        </button>

        <p style={styles.footer}>
          Already have an account?{' '}
          <Link href="/login" style={styles.link}>Sign in</Link>
        </p>
      </form>
    </div>
  );
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
    maxWidth: 420,
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '32px 28px',
  },
  title: {
    margin: 0,
    fontSize: 20,
    fontWeight: 600,
  },
  subtitle: {
    margin: '4px 0 20px',
    color: 'var(--ink-muted)',
    fontSize: 13,
  },
  section: {
    margin: '22px 0 0',
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
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
  hint: {
    margin: '6px 0 0',
    fontSize: 12,
    color: 'var(--ink-faint)',
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
  error: {
    background: 'var(--danger-bg)',
    color: 'var(--danger)',
    fontSize: 13,
    padding: '9px 11px',
    borderRadius: 'var(--radius-sm)',
    marginBottom: 4,
  },
  footer: {
    margin: '18px 0 0',
    textAlign: 'center',
    fontSize: 13,
    color: 'var(--ink-muted)',
  },
  link: {
    color: 'var(--accent)',
    fontWeight: 500,
    textDecoration: 'none',
  },
};
