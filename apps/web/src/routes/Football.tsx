import { Loading } from '../components/ui.jsx';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';

type Competition = {
  id: string;
  slug: string;
  name: string;
  type: string;
  logoUrl: string | null;
  country: { name: string; isoCode: string | null; flagUrl: string | null } | null;
  confederation: string | null;
  currentSeason: { id: string; label: string } | null;
};

export function FootballRoute() {
  const { data, isPending } = useQuery({
    queryKey: ['competitions'],
    queryFn: () => api.get<{ competitions: Competition[] }>('/competitions'),
    staleTime: 5 * 60_000,
  });

  if (isPending) return <Loading />;

  return (
    <section>
      <h1 style={{ fontSize: 'var(--text-xl)', margin: '0 0 var(--s4)' }}>Football</h1>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--s2)' }}>
        {data?.competitions.map((c) => (
          <li key={c.id}>
            <Link
              to={`/football/${c.slug}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--s3)',
                minHeight: 56,
                padding: 'var(--s3)',
                background: 'var(--surface-raised)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                color: 'inherit',
                textDecoration: 'none',
              }}
            >
              {c.logoUrl && <img src={c.logoUrl} alt="" width={28} height={28} loading="lazy" />}
              <span style={{ flex: 1 }}>
                <strong style={{ display: 'block' }}>{c.name}</strong>
                <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                  {/* The UCL has no country — every flag surface needs this
                      fallback (§5.2). */}
                  {c.country?.name ?? c.confederation ?? 'International'}
                  {c.currentSeason ? ` · ${c.currentSeason.label}` : ''}
                </span>
              </span>
              <span aria-hidden style={{ color: 'var(--text-muted)' }}>
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
