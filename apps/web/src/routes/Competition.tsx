import { Loading } from '../components/ui.jsx';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';

type Team = {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  tla: string | null;
  crestUrl: string | null;
};
type StandingRow = {
  id: string;
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  form: string[];
  team: Team;
};
type Round = {
  id: string;
  number: number;
  name: string;
  type: string;
  isTwoLegged: boolean;
  fixtureCount: number;
};
type Fixture = {
  id: string;
  kickoffAt: string;
  status: string;
  minute: number | null;
  score: { home: number | null; away: number | null };
  homeTeam: Team;
  awayTeam: Team;
};
type Competition = {
  id: string;
  slug: string;
  name: string;
  type: string;
  logoUrl: string | null;
  currentSeason: { id: string; label: string } | null;
};

/** Rounds are matchdays in a league and stages in a cup — label from `type`,
 *  never from `number` alone (§5.2). */
const isLeagueRound = (t: string) =>
  t === 'REGULAR_SEASON' || t === 'GROUP_STAGE' || t === 'LEAGUE_PHASE';

export function CompetitionRoute() {
  const { slug } = useParams<{ slug: string }>();
  const [tab, setTab] = useState<'table' | 'fixtures'>('table');

  const competitions = useQuery({
    queryKey: ['competitions'],
    queryFn: () => api.get<{ competitions: Competition[] }>('/competitions'),
    staleTime: 5 * 60_000,
  });

  const competition = competitions.data?.competitions.find((c) => c.slug === slug);
  const seasonId = competition?.currentSeason?.id;

  const standings = useQuery({
    queryKey: ['standings', seasonId],
    queryFn: () => api.get<{ standings: StandingRow[] }>(`/seasons/${seasonId}/standings`),
    enabled: !!seasonId && tab === 'table',
  });

  const rounds = useQuery({
    queryKey: ['rounds', seasonId],
    queryFn: () => api.get<{ rounds: Round[] }>(`/seasons/${seasonId}/rounds`),
    enabled: !!seasonId,
  });

  const [roundId, setRoundId] = useState<string | null>(null);
  const activeRound = roundId ?? rounds.data?.rounds[0]?.id ?? null;

  const fixtures = useQuery({
    queryKey: ['fixtures', activeRound],
    queryFn: () => api.get<{ fixtures: Fixture[] }>(`/rounds/${activeRound}/fixtures`),
    enabled: !!activeRound && tab === 'fixtures',
  });

  if (competitions.isPending) return <Loading />;
  if (!competition) return <p>Competition not found.</p>;

  return (
    <section>
      <header style={{ marginBottom: 'var(--s4)' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', margin: 0 }}>{competition.name}</h1>
        <p
          style={{
            color: 'var(--text-muted)',
            margin: 'var(--s1) 0 0',
            fontSize: 'var(--text-sm)',
          }}
        >
          {competition.currentSeason?.label ?? 'No current season'}
        </p>
      </header>

      {competition.type === 'CONTINENTAL' && (
        <p style={{ margin: '0 0 var(--s3)' }}>
          <Link
            to={`/football/${slug}/bracket`}
            style={{ color: 'var(--accent)', fontWeight: 600 }}
          >
            View knockout bracket →
          </Link>
        </p>
      )}

      <div role="tablist" style={{ display: 'flex', gap: 'var(--s2)', marginBottom: 'var(--s4)' }}>
        {(['table', 'fixtures'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            style={{
              minHeight: 44,
              padding: '0 var(--s4)',
              textTransform: 'capitalize',
              background: tab === t ? 'var(--accent-weak)' : 'transparent',
              color: tab === t ? 'var(--accent)' : 'var(--text-muted)',
              border: `1px solid ${tab === t ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 'var(--radius-md)',
              fontWeight: tab === t ? 600 : 400,
              cursor: 'pointer',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'table' && (
        <StandingsTable rows={standings.data?.standings ?? []} loading={standings.isPending} />
      )}

      {tab === 'fixtures' && (
        <>
          <RoundPicker
            rounds={rounds.data?.rounds ?? []}
            activeId={activeRound}
            onPick={setRoundId}
          />
          <FixtureList fixtures={fixtures.data?.fixtures ?? []} loading={fixtures.isPending} />
        </>
      )}
    </section>
  );
}

function StandingsTable({ rows, loading }: { rows: StandingRow[]; loading: boolean }) {
  if (loading) return <p style={{ color: 'var(--text-muted)' }}>Loading table…</p>;
  if (!rows.length) return <Empty>No table yet — the season has not started.</Empty>;

  return (
    // Wide content scrolls inside its own container; the page body never
    // scrolls horizontally (§14.3).
    <div
      style={{
        overflowX: 'auto',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
        <thead>
          <tr style={{ background: 'var(--surface)', textAlign: 'right' }}>
            <th style={{ ...th, textAlign: 'left', width: 28 }}>#</th>
            <th style={{ ...th, textAlign: 'left' }}>Team</th>
            <th style={th}>P</th>
            <th style={th}>W</th>
            <th style={th}>D</th>
            <th style={th}>L</th>
            <th style={th}>GD</th>
            <th style={{ ...th, fontWeight: 700 }}>Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ ...td, textAlign: 'left', color: 'var(--text-muted)' }}>{r.position}</td>
              <td style={{ ...td, textAlign: 'left' }}>
                <Link
                  to={`/football/team/${r.team.slug}`}
                  style={{
                    color: 'inherit',
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--s2)',
                  }}
                >
                  {r.team.crestUrl && (
                    <img src={r.team.crestUrl} alt="" width={18} height={18} loading="lazy" />
                  )}
                  <span>{r.team.shortName ?? r.team.name}</span>
                </Link>
              </td>
              <td style={td}>{r.played}</td>
              <td style={td}>{r.won}</td>
              <td style={td}>{r.drawn}</td>
              <td style={td}>{r.lost}</td>
              <td style={td}>{r.goalDifference > 0 ? `+${r.goalDifference}` : r.goalDifference}</td>
              <td style={{ ...td, fontWeight: 700 }}>{r.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RoundPicker({
  rounds,
  activeId,
  onPick,
}: {
  rounds: Round[];
  activeId: string | null;
  onPick: (id: string) => void;
}) {
  if (!rounds.length) return null;
  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--s2)',
        overflowX: 'auto',
        paddingBottom: 'var(--s2)',
        marginBottom: 'var(--s3)',
      }}
    >
      {rounds.map((r) => (
        <button
          key={r.id}
          onClick={() => onPick(r.id)}
          style={{
            flex: '0 0 auto',
            minHeight: 40,
            padding: '0 var(--s3)',
            whiteSpace: 'nowrap',
            background: activeId === r.id ? 'var(--accent)' : 'var(--surface)',
            color: activeId === r.id ? 'var(--accent-text)' : 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--text-sm)',
            cursor: 'pointer',
          }}
        >
          {isLeagueRound(r.type) ? `MD ${r.number}` : r.name}
        </button>
      ))}
    </div>
  );
}

function FixtureList({ fixtures, loading }: { fixtures: Fixture[]; loading: boolean }) {
  if (loading) return <p style={{ color: 'var(--text-muted)' }}>Loading fixtures…</p>;
  if (!fixtures.length) return <Empty>No fixtures in this round.</Empty>;

  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--s2)' }}>
      {fixtures.map((f) => {
        const played = f.score.home !== null;
        const kickoff = new Date(f.kickoffAt);
        return (
          <li
            key={f.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto 1fr',
              alignItems: 'center',
              gap: 'var(--s3)',
              padding: 'var(--s3)',
              background: 'var(--surface-raised)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <span style={{ textAlign: 'right' }}>{f.homeTeam.shortName ?? f.homeTeam.name}</span>
            <span
              className="tnum"
              style={{
                minWidth: 64,
                textAlign: 'center',
                fontWeight: 600,
                color: played ? 'var(--text)' : 'var(--text-muted)',
                fontSize: played ? 'var(--text-base)' : 'var(--text-sm)',
              }}
            >
              {played
                ? `${f.score.home} – ${f.score.away}`
                : kickoff.toLocaleString(undefined, {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
            </span>
            <span>{f.awayTeam.shortName ?? f.awayTeam.name}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
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
      {children}
    </div>
  );
}

const th: React.CSSProperties = {
  padding: 'var(--s2) var(--s2)',
  fontWeight: 600,
  textAlign: 'right',
};
const td: React.CSSProperties = { padding: 'var(--s2) var(--s2)', textAlign: 'right' };
