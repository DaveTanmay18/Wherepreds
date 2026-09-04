import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  linkPath: string | null;
  readAt: string | null;
  createdAt: string;
};

/**
 * Notification bell (task P5-09).
 *
 * Polls rather than pushes — WebSockets arrive in Phase 6 (P6-03) and Web Push
 * in P5-12. A 60s poll is plenty for deadline reminders and round results, and
 * it degrades to nothing if the request fails.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () =>
      api.get<{ unread: number; notifications: Notification[] }>('/notifications?limit=20'),
    refetchInterval: 60_000,
    retry: false,
  });

  const markRead = useMutation({
    mutationFn: (ids?: string[]) => api.post('/notifications/read', ids ? { ids } : {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const unread = data?.unread ?? 0;
  const items = data?.notifications ?? [];

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        style={{
          position: 'relative',
          minWidth: 44,
          minHeight: 44,
          background: 'transparent',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--text)',
          cursor: 'pointer',
          fontSize: 'var(--text-base)',
        }}
      >
        🔔
        {unread > 0 && (
          // A count, not just a dot — "how many" is the question being asked,
          // and a bare dot makes people open it to find out.
          <span
            style={{
              position: 'absolute',
              top: -6,
              right: -6,
              minWidth: 18,
              height: 18,
              padding: '0 4px',
              borderRadius: 999,
              background: 'var(--live)',
              color: '#fff',
              fontSize: 11,
              fontWeight: 700,
              lineHeight: '18px',
            }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Click-away layer, so the panel closes the way people expect. */}
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div
            role="dialog"
            aria-label="Notifications"
            style={{
              position: 'absolute',
              right: 0,
              top: 52,
              zIndex: 41,
              width: 'min(360px, calc(100vw - var(--s4) * 2))',
              maxHeight: '70dvh',
              overflowY: 'auto',
              background: 'var(--surface-raised)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: '0 8px 24px rgb(0 0 0 / 0.18)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: 'var(--s3)',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <strong style={{ fontSize: 'var(--text-sm)' }}>Notifications</strong>
              {unread > 0 && (
                <button
                  onClick={() => markRead.mutate(undefined)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--accent)',
                    cursor: 'pointer',
                    fontSize: 'var(--text-xs)',
                    minHeight: 36,
                  }}
                >
                  Mark all read
                </button>
              )}
            </div>

            {items.length === 0 ? (
              <p
                style={{
                  padding: 'var(--s5) var(--s3)',
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                  fontSize: 'var(--text-sm)',
                  margin: 0,
                }}
              >
                Nothing yet.
              </p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    markRead.mutate([n.id]);
                    setOpen(false);
                    if (n.linkPath) navigate(n.linkPath);
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: 'var(--s3)',
                    background: n.readAt ? 'transparent' : 'var(--accent-weak)',
                    border: 'none',
                    borderBottom: '1px solid var(--border)',
                    color: 'inherit',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontWeight: n.readAt ? 400 : 700, fontSize: 'var(--text-sm)' }}>
                    {n.title}
                  </div>
                  {n.body && (
                    <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
                      {n.body}
                    </div>
                  )}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
