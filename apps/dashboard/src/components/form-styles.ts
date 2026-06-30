// Shared inline style objects for form fields across the dashboard's
// create/edit panels (staff, services, settings). Not a component — just a
// consistent style object, since these forms are plain controlled inputs.

export const formStyles: Record<string, React.CSSProperties> = {
  field: {
    marginBottom: 16,
  },
  label: {
    display: 'block',
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--ink-muted)',
    marginBottom: 5,
  },
  input: {
    width: '100%',
    padding: '9px 11px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
    fontSize: 14,
  },
  textarea: {
    width: '100%',
    padding: '9px 11px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
    fontSize: 14,
    resize: 'vertical',
    minHeight: 60,
    fontFamily: 'inherit',
  },
  row: {
    display: 'flex',
    gap: 10,
  },
  rowField: {
    flex: 1,
  },
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  helpText: {
    fontSize: 12,
    color: 'var(--ink-faint)',
    marginTop: 4,
  },
  primaryButton: {
    width: '100%',
    padding: 11,
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    background: 'var(--accent)',
    color: 'var(--accent-ink)',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: 6,
  },
  dangerLinkButton: {
    width: '100%',
    padding: 10,
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--danger-bg)',
    background: 'var(--danger-bg)',
    color: 'var(--danger)',
    fontSize: 13,
    cursor: 'pointer',
    marginTop: 10,
  },
  error: {
    background: 'var(--danger-bg)',
    color: 'var(--danger)',
    fontSize: 13,
    padding: '9px 11px',
    borderRadius: 'var(--radius-sm)',
    marginBottom: 14,
  },
};
