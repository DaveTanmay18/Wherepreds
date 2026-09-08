import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Card, Empty, Loading } from '../components/ui.jsx';

type AdminLeague = {
  id: string;
  slug: string;
  name: string;
  visibility: string;
  createdAt: string;
  competition: string;
  season: string;
  owner: { username: string; displayName: string; email: string } | null;
  memberCount: number;
  roundCount: number;
  predictionCount: number;
};

/**
 * Platform admin: every league on the instance.
 *
 * Reached only by users with `isAdmin`, which is granted from a shell script
 * and never from the UI. The route is guarded server-side too — hiding a link
 * is not access control.
 */
export function AdminRoute() {
  const { data, isPending, isError } = useQuery({
    queryKey: ['admin', 'leagues'],
    queryFn: () => api.get<{ leagues: AdminLeague[] }>('/admin/leagues'),
  });

  if (isPending) return <Loading />;
  if (isError) return <p>You do not have administrator access.</p>;

  const leagues = data?.leagues ?? [];

  return (
    <section>
      <header style={{ marginBottom: 'var(--s4)' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', margin: 0 }}>All leagues</h1>
        <p
          style={{
            margin: 'var(--s1) 0 0',
            color: 'var(--text-muted)',
            fontSize: 'var(--text-sm)',
          }}
        >
          {leagues.length} {leagues.length === 1 ? 'league' : 'leagues'} ·{' '}
          {leagues.reduce((n, l) => n + l.predictionCount, 0)} predictions
        </p>
      </header>

      {leagues.length === 0 ? (
        <Empty title="No leagues yet">Nobody has created one.</Empty>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--s2)' }}>
          {leagues.map((l) => (
            <Link key={l.id} to={`/admin/leagues/${l.slug}`} style={{ textDecoration: 'none' }}>
              <Card>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: 'var(--s2)',
                  }}
                >
                  <strong style={{ color: 'var(--text)' }}>{l.name}</strong>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                    {l.visibility.toLowerCase()}
                  </span>
                </div>
                <p
                  style={{
                    margin: 'var(--s1) 0 0',
                    fontSize: 'var(--text-sm)',
                    color: 'var(--text-muted)',
                  }}
                >
                  {l.competition} · {l.season}
                  {l.owner && ` · owned by ${l.owner.displayName}`}
                </p>
                <p
                  className="tnum"
                  style={{
                    margin: 'var(--s2) 0 0',
                    fontSize: 'var(--text-sm)',
                    color: 'var(--text-muted)',
                  }}
                >
                  {l.memberCount} {l.memberCount === 1 ? 'member' : 'members'} · {l.roundCount}{' '}
                  rounds · {l.predictionCount} predictions
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
