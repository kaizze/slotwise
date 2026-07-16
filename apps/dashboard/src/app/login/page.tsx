'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { fetchSetupStatus } from '@/lib/onboarding';

export default function LoginPage() {
  const { login, status } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status !== 'authenticated') return;
    let cancelled = false;
    fetchSetupStatus()
      .then((setup) => {
        if (!cancelled) router.replace(setup.complete ? '/' : '/onboarding');
      })
      .catch(() => {
        if (!cancelled) router.replace('/');
      });
    return () => {
      cancelled = true;
    };
  }, [status, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await login(email, password);
      const setup = await fetchSetupStatus();
      router.push(setup.complete ? '/' : '/onboarding');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.page}>
      <form style={styles.card} onSubmit={handleSubmit}>
        <h1 style={styles.title}>SlotWise</h1>
        <p style={styles.subtitle}>Sign in to manage your bookings.</p>

        {error && <div style={styles.error}>{error}</div>}

        <label style={styles.label} htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={styles.input}
          autoComplete="email"
          required
        />

        <label style={styles.label} htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={styles.input}
          autoComplete="current-password"
          required
        />

        <button type="submit" style={styles.button} disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>

        <p style={styles.footer}>
          New business?{' '}
          <Link href="/signup" style={styles.link}>Create an account</Link>
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
  },
  card: {
    width: 360,
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
    margin: '4px 0 24px',
    color: 'var(--ink-muted)',
    fontSize: 13,
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
