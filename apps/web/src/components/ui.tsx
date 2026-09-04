import type { CSSProperties, ReactNode } from 'react';

/**
 * Minimal shared primitives. Not the full §14.4 component library — that
 * arrives in P6-09 — but enough to stop every screen re-inventing a button.
 * All targets are >= 44px and colours come from tokens, never literals.
 */

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  full?: boolean;
}) {
  const variant = props.variant ?? 'primary';
  const palette: Record<string, CSSProperties> = {
    primary: { background: 'var(--accent)', color: 'var(--accent-text)', border: 'none' },
    secondary: {
      background: 'transparent',
      color: 'var(--text)',
      border: '1px solid var(--border)',
    },
    danger: {
      background: 'transparent',
      color: 'var(--negative)',
      border: '1px solid var(--negative)',
    },
  };

  return (
    <button
      type={props.type ?? 'button'}
      onClick={props.onClick}
      disabled={props.disabled}
      style={{
        minHeight: 48,
        padding: '0 var(--s4)',
        width: props.full ? '100%' : undefined,
        borderRadius: 'var(--radius-md)',
        fontSize: 'var(--text-base)',
        fontWeight: 600,
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        opacity: props.disabled ? 0.6 : 1,
        ...palette[variant],
      }}
    >
      {props.children}
    </button>
  );
}

export function Card(props: { children: ReactNode; onClick?: () => void; selected?: boolean }) {
  return (
    <div
      onClick={props.onClick}
      role={props.onClick ? 'button' : undefined}
      tabIndex={props.onClick ? 0 : undefined}
      onKeyDown={
        props.onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                props.onClick!();
              }
            }
          : undefined
      }
      style={{
        padding: 'var(--s4)',
        background: 'var(--surface-raised)',
        border: `1px solid ${props.selected ? 'var(--accent)' : 'var(--border)'}`,
        boxShadow: props.selected ? 'inset 0 0 0 1px var(--accent)' : 'var(--shadow-sm)',
        borderRadius: 'var(--radius-lg)',
        cursor: props.onClick ? 'pointer' : undefined,
      }}
    >
      {props.children}
    </div>
  );
}

export function Empty(props: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div
      style={{
        border: '1px dashed var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--s6) var(--s4)',
        textAlign: 'center',
        background: 'var(--surface)',
      }}
    >
      <p style={{ margin: '0 0 var(--s2)', fontWeight: 600 }}>{props.title}</p>
      {props.children && (
        <p
          style={{
            margin: '0 0 var(--s4)',
            color: 'var(--text-muted)',
            fontSize: 'var(--text-sm)',
          }}
        >
          {props.children}
        </p>
      )}
      {props.action}
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      style={{ color: 'var(--negative)', fontSize: 'var(--text-sm)', margin: 'var(--s2) 0' }}
    >
      {children}
    </p>
  );
}

/**
 * Role is shown with a WORD, not a colour — colour must never be the only
 * signal (§14.1).
 */
export function RoleBadge({ role }: { role: string }) {
  if (role === 'MEMBER') return null;
  return (
    <span
      style={{
        fontSize: 'var(--text-xs)',
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 999,
        background: 'var(--accent-weak)',
        color: 'var(--accent)',
        textTransform: 'capitalize',
      }}
    >
      {role.toLowerCase()}
    </span>
  );
}

/** Deadline countdown. Server-authoritative time is what actually governs
 *  locking (§10.2); this is presentation only. */
export function formatDeadline(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'Deadline passed';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m to go`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ${mins % 60}m to go`;
  return `${Math.floor(hours / 24)} days to go`;
}

/**
 * Centred loading state.
 *
 * Every screen previously rendered a bare `<p>Loading…</p>`, which sits in the
 * top-left corner of the content area — on a wide screen that reads as a
 * broken page rather than a pending one. This centres in the available space
 * and announces itself to screen readers.
 *
 * `inline` is for a loading block INSIDE a page that already has a heading;
 * the default fills the content area below the sticky header.
 */
export function Loading({
  label = 'Loading…',
  inline = false,
}: {
  label?: string;
  inline?: boolean;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'grid',
        placeItems: 'center',
        alignContent: 'center',
        gap: 'var(--s3)',
        minHeight: inline ? 160 : 'calc(100dvh - 180px)',
        color: 'var(--text-muted)',
        fontSize: 'var(--text-sm)',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          border: '2px solid var(--border)',
          borderTopColor: 'var(--accent)',
          animation: 'wp-spin 700ms linear infinite',
        }}
      />
      <span>{label}</span>
    </div>
  );
}
