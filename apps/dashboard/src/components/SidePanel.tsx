'use client';

import type { ReactNode } from 'react';

export function SidePanel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <span style={styles.title}>{title}</span>
          <button style={styles.closeButton} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div style={styles.body}>{children}</div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.25)',
    display: 'flex',
    justifyContent: 'flex-end',
    zIndex: 100,
  },
  panel: {
    width: 400,
    maxWidth: '100vw',
    height: '100vh',
    background: 'var(--surface)',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '-8px 0 24px rgba(0,0,0,0.08)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '18px 20px',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  title: {
    fontSize: 15,
    fontWeight: 600,
  },
  closeButton: {
    border: 'none',
    background: 'none',
    color: 'var(--ink-muted)',
    fontSize: 14,
    cursor: 'pointer',
    padding: 4,
  },
  body: {
    flex: 1,
    overflowY: 'auto',
    padding: 20,
  },
};
