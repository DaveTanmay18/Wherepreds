import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Card } from './ui.jsx';

type Entry = {
  id: string;
  action: string;
  actor: string;
  createdAt: string;
  summary: string;
};

/**
 * League activity feed (task P5-08).
 *
 * ⚠️ This exists so admin power is VISIBLE (§15.3). An admin who also competes
 * is only tolerable if every rules change and every deadline move is on a
 * public record — so this is shown to all members, not just admins.
 */
export function ActivityFeed({ slug }: { slug: string | undefined }) {
  const { data } = useQuery({
    queryKey: ['league', slug, 'activity'],
    queryFn: () => api.get<{ activity: Entry[] }>(`/leagues/${slug}/activity`),
    enabled: !!slug,
  });

  const entries = data?.activity ?? [];
  if (entries.length === 0) return null;

  return (
    <Card>
      <h2 style={{ fontSize: 'var(--text-sm)', margin: '0 0 var(--s2)', fontWeight: 600 }}>
        Recent activity
      </h2>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {/* Capped at 10 here even though the API returns 50 — the overview is
            for glancing at, and the long tail is noise on a phone. */}
        {entries.slice(0, 10).map((e) => (
          <li
            key={e.id}
            style={{
              display: 'flex',
              gap: 'var(--s2)',
              padding: 'var(--s2) 0',
              borderTop: '1px solid var(--border)',
              fontSize: 'var(--text-sm)',
            }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ fontWeight: 600 }}>{e.actor}</strong> {e.summary}
            </span>
            <time
              dateTime={e.createdAt}
              style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)', flexShrink: 0 }}
            >
              {relative(e.createdAt)}
            </time>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** "3h ago" reads faster than a timestamp for anything inside a week. */
function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
