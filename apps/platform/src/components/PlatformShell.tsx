'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useAuth } from '@/lib/auth-context';
import { RequireAuth } from './RequireAuth';

const NAV = [
  { href: '/', label: 'Businesses' },
  { href: '/health', label: 'Health' },
];

export function PlatformShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <RequireAuth>
      <div style={styles.layout}>
        <aside style={styles.aside}>
          <div style={styles.brand}>
            <div style={styles.brandTitle}>SlotWise</div>
            <div style={styles.brandSub}>Platform</div>
          </div>
          <nav style={styles.nav}>
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{ ...styles.navLink, ...(active ? styles.navLinkActive : {}) }}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div style={styles.footer}>
            <div style={styles.userName}>{user?.name}</div>
            <div style={styles.userMeta}>{user?.role}</div>
            <button type="button" style={styles.signOut} onClick={() => logout()}>
              Sign out
            </button>
          </div>
        </aside>
        <main style={styles.main}>{children}</main>
      </div>
    </RequireAuth>
  );
}

const styles: Record<string, React.CSSProperties> = {
  layout: {
    display: 'grid',
    gridTemplateColumns: '220px 1fr',
    minHeight: '100vh',
  },
  aside: {
    background: 'var(--surface)',
    borderRight: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    padding: '20px 14px',
  },
  brand: { marginBottom: 28, padding: '0 8px' },
  brandTitle: { fontWeight: 700, fontSize: 16, letterSpacing: '-0.02em' },
  brandSub: { color: 'var(--ink-muted)', fontSize: 12, marginTop: 2 },
  nav: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1 },
  navLink: {
    padding: '8px 10px',
    borderRadius: 8,
    color: 'var(--ink-muted)',
    fontSize: 13,
    fontWeight: 500,
  },
  navLinkActive: {
    background: 'rgba(59, 130, 246, 0.15)',
    color: 'var(--ink)',
  },
  footer: {
    borderTop: '1px solid var(--border)',
    paddingTop: 14,
    paddingLeft: 8,
    paddingRight: 8,
  },
  userName: { fontWeight: 600, fontSize: 13 },
  userMeta: { color: 'var(--ink-faint)', fontSize: 11, textTransform: 'uppercase', marginTop: 2 },
  signOut: {
    marginTop: 10,
    background: 'transparent',
    border: '1px solid var(--border)',
    color: 'var(--ink-muted)',
    borderRadius: 8,
    padding: '6px 10px',
    cursor: 'pointer',
    fontSize: 12,
    width: '100%',
  },
  main: { padding: '28px 32px', overflow: 'auto' },
};
