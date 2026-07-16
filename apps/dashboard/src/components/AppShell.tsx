'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { RequireSetup } from '@/components/RequireSetup';
import type { ReactNode } from 'react';

const NAV_ITEMS = [
  { href: '/', label: 'Today' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/waitlist', label: 'Waitlist' },
  { href: '/fill', label: 'Slot filling' },
  { href: '/staff', label: 'Staff' },
  { href: '/services', label: 'Services' },
  { href: '/settings', label: 'Settings' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { business, user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  async function handleLogout() {
    try {
      await logout();
    } finally {
      router.replace('/login');
    }
  }

  return (
    <RequireSetup>
      <div style={styles.shell}>
        <aside style={styles.rail}>
          <div style={styles.brand}>{business?.name ?? 'SlotWise'}</div>

          <nav style={styles.nav}>
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  style={isActive ? styles.navItemActive : styles.navItem}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div style={styles.railFooter}>
            {user && <div style={styles.userName}>{user.name}</div>}
            <button type="button" style={styles.logoutButton} onClick={handleLogout}>
              Sign out
            </button>
          </div>
        </aside>

        <main style={styles.main}>{children}</main>
      </div>
    </RequireSetup>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    display: 'flex',
    minHeight: '100vh',
  },
  rail: {
    width: 200,
    flexShrink: 0,
    background: 'var(--surface)',
    borderRight: '1px solid var(--border)',
    padding: '20px 16px',
    display: 'flex',
    flexDirection: 'column',
  },
  brand: {
    fontSize: 15,
    fontWeight: 600,
    marginBottom: 24,
    paddingLeft: 6,
  },
  nav: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    flex: 1,
  },
  navItem: {
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--ink-muted)',
    padding: '8px 10px',
    borderRadius: 'var(--radius-sm)',
    textDecoration: 'none',
  },
  navItemActive: {
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--accent)',
    background: '#eef2ff',
    padding: '8px 10px',
    borderRadius: 'var(--radius-sm)',
    textDecoration: 'none',
  },
  railFooter: {
    borderTop: '1px solid var(--border)',
    paddingTop: 14,
  },
  userName: {
    fontSize: 12,
    color: 'var(--ink-muted)',
    padding: '0 6px',
    marginBottom: 8,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  logoutButton: {
    width: '100%',
    padding: '7px 10px',
    fontSize: 12,
    color: 'var(--ink-muted)',
    background: 'none',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    textAlign: 'left',
  },
  main: {
    flex: 1,
    padding: '28px 32px',
  },
};
