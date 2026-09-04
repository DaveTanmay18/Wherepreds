import { Loading } from '../components/ui.jsx';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api.js';

type TeamSeason = {
  id: string;
  season: { label: string; competition: { slug: string; name: string } };
  stat: null | {
    played: number;
    won: number;
    drawn: number;
    lost: number;
    goalsFor: number;
    goalsAgainst: number;
    cleanSheets: number;
    formLast5: string[];
  };
};
type Team = {
  id: string;
  name: string;
  shortName: string | null;
  tla: string | null;
  crestUrl: string | null;
  foundedYear: number | null;
  country: { name: string } | null;
  venue: { name: string; city: string | null; capacity: number | null } | null;
  teamSeasons: TeamSeason[];
};

export function TeamRoute() {
  const { slug } = useParams<{ slug: string }>();
  const { data, isPending, isError } = useQuery({
    queryKey: ['team', slug],
    queryFn: () => api.get<{ team: Team }>(`/teams/${slug}`),
  });

  if (isPending) return <Loading />;
  if (isError || !data) return <p>Team not found.</p>;

  const t = data.team;
  const current = t.teamSeasons[0];

  return (
    <section>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s3)',
          marginBottom: 'var(--s5)',
        }}
      >
        {t.crestUrl && <img src={t.crestUrl} alt="" width={48} height={48} />}
        <div>
          <h1 style={{ fontSize: 'var(--text-xl)', margin: 0 }}>{t.name}</h1>
          <p
            style={{
              color: 'var(--text-muted)',
              margin: 'var(--s1) 0 0',
              fontSize: 'var(--text-sm)',
            }}
          >
            {[t.country?.name, t.venue?.name, t.foundedYear ? `est. ${t.foundedYear}` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      </header>

      {/* Six headline stats, all computed from our own results so they are
          complete regardless of the provider plan (§11.5). */}
      {current?.stat ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(88px, 1fr))',
            gap: 'var(--s2)',
          }}
        >
          <Stat label="Played" value={current.stat.played} />
          <Stat label="Won" value={current.stat.won} />
          <Stat label="Drawn" value={current.stat.drawn} />
          <Stat label="Lost" value={current.stat.lost} />
          <Stat label="Scored" value={current.stat.goalsFor} />
          <Stat label="Conceded" value={current.stat.goalsAgainst} />
        </div>
      ) : (
        <div
          style={{
            border: '1px dashed var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--s6) var(--s4)',
            textAlign: 'center',
            color: 'var(--text-muted)',
            background: 'var(--surface)',
          }}
        >
          No season stats yet — they are computed after the first round is played.
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        padding: 'var(--s3)',
        background: 'var(--surface-raised)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        textAlign: 'center',
      }}
    >
      <div className="tnum" style={{ fontSize: 'var(--text-xl)', fontWeight: 700 }}>
        {value}
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>{label}</div>
    </div>
  );
}
