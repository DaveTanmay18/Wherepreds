import { Link, Outlet } from 'react-router-dom';
import { useLogout, useSession } from '../lib/auth.js';
import { NotificationBell } from '../components/Notifications.jsx';

export function AppShell() {
  const { data: user } = useSession();
  const logout = useLogout();

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--s3)',
          padding: 'var(--s3) var(--s4)',
          background: 'var(--surface-raised)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <nav style={{ display: 'flex', alignItems: 'center', gap: 'var(--s4)' }}>
          <Link to="/" style={{ color: 'inherit', textDecoration: 'none' }}>
            <strong>WherePreds</strong>
          </Link>
          <Link
            to="/football"
            style={{
              color: 'var(--text-muted)',
              textDecoration: 'none',
              fontSize: 'var(--text-sm)',
            }}
          >
            Football
          </Link>
          {/* Shown only to admins — but the link is a shortcut, not a gate.
              The API rejects these routes for everyone else regardless. */}
          {user?.isAdmin && (
            <Link
              to="/admin"
              style={{
                color: 'var(--text-muted)',
                textDecoration: 'none',
                fontSize: 'var(--text-sm)',
              }}
            >
              Admin
            </Link>
          )}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
          <NotificationBell />
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
            {user?.displayName}
          </span>
          <button
            onClick={() => logout.mutate()}
            style={{
              minHeight: 44,
              padding: '0 var(--s3)',
              background: 'transparent',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Content caps at 1120px on desktop; desktop is a widened mobile
          layout, not a separate design (§14.3). */}
      <main
        style={{ flex: 1, width: '100%', maxWidth: 1120, margin: '0 auto', padding: 'var(--s4)' }}
      >
        <Outlet />
      </main>
    </div>
  );
}
