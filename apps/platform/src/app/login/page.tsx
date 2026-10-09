'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';

export default function LoginPage() {
  const { login, status } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === 'authenticated') router.replace('/');
  }, [status, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      router.push('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.page}>
      <form style={styles.card} onSubmit={handleSubmit}>
        <h1 style={styles.title}>SlotWise Platform</h1>
        <p style={styles.subtitle}>Admin & developer console</p>

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
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    padding: 24,
    background:
      'radial-gradient(ellipse at top, #1e293b 0%, var(--bg) 55%)',
  },
  card: {
    width: '100%',
    maxWidth: 380,
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 14,
    padding: 28,
  },
  title: { margin: 0, fontSize: 20, fontWeight: 700 },
  subtitle: { margin: '6px 0 22px', color: 'var(--ink-muted)', fontSize: 13 },
  label: { display: 'block', fontSize: 12, color: 'var(--ink-muted)', marginBottom: 6 },
  input: {
    width: '100%',
    marginBottom: 14,
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--ink)',
  },
  button: {
    width: '100%',
    marginTop: 6,
    padding: '10px 12px',
    borderRadius: 8,
    border: 'none',
    background: 'var(--accent)',
    color: 'var(--accent-ink)',
    fontWeight: 600,
    cursor: 'pointer',
  },
  error: {
    background: 'rgba(239, 68, 68, 0.12)',
    color: '#fca5a5',
    borderRadius: 8,
    padding: '10px 12px',
    marginBottom: 14,
    fontSize: 13,
  },
};
