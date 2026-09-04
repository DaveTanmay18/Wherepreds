import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Empty, Loading } from '../components/ui.jsx';

type TeamRef = {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  tla: string | null;
  crestUrl: string | null;
};

type Tie = {
  id: string;
  aggregateA: number | null;
  aggregateB: number | null;
  winnerTeamId: string | null;
  decidedBy: string | null;
  settledAt: string | null;
  teamA: TeamRef;
  teamB: TeamRef;
};

type BracketRound = {
  id: string;
  name: string;
  type: string;
  isTwoLegged: boolean;
  ties: Tie[];
  fixtures: {
    id: string;
    legNumber: number | null;
    score: { home: number | null; away: number | null };
    homeTeam: TeamRef;
    awayTeam: TeamRef;
  }[];
};

type Competition = {
  slug: string;
  name: string;
  currentSeason: { id: string; label: string } | null;
};

/**
 * Knockout bracket (tasks P1b-11, P1b-12).
 *
 * ⚠️ Built mobile-first as a horizontally scrolling column-per-round, NOT a
 * scaled-down desktop tree. A traditional bracket is the hardest thing in this
 * app to render on a 360px screen, and shrinking one produces something
 * nobody can read (§14.3).
 */
export function BracketRoute() {
  const { slug } = useParams<{ slug: string }>();

  const competitions = useQuery({
    queryKey: ['competitions'],
    queryFn: () => api.get<{ competitions: Competition[] }>('/competitions'),
    staleTime: 5 * 60_000,
  });

  const seasonId = competitions.data?.competitions.find((c) => c.slug === slug)?.currentSeason?.id;

  const { data, isPending } = useQuery({
    queryKey: ['bracket', seasonId],
    queryFn: () => api.get<{ bracket: BracketRound[] }>(`/seasons/${seasonId}/bracket`),
    enabled: !!seasonId,
  });

  if (isPending || competitions.isPending) {
    return <Loading />;
  }

  const rounds = (data?.bracket ?? []).filter((r) => r.ties.length > 0 || r.fixtures.length > 0);
  if (!rounds.length) {
    return <Empty title="No knockout rounds yet">The bracket appears once the draw is made.</Empty>;
  }

  return (
    <section>
      <h1 style={{ fontSize: 'var(--text-xl)', margin: '0 0 var(--s4)' }}>Knockout bracket</h1>

      <div
        style={{
          display: 'flex',
          gap: 'var(--s3)',
          overflowX: 'auto',
          paddingBottom: 'var(--s3)',
          // Wide content scrolls inside its own container; the page body never
          // scrolls horizontally (§14.3).
          scrollSnapType: 'x mandatory',
        }}
      >
        {rounds.map((round) => (
          <div key={round.id} style={{ flex: '0 0 280px', scrollSnapAlign: 'start', minWidth: 0 }}>
            <h2
              style={{
                fontSize: 'var(--text-sm)',
                fontWeight: 600,
                color: 'var(--text-muted)',
                margin: '0 0 var(--s2)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              {round.name}
            </h2>

            <div style={{ display: 'grid', gap: 'var(--s2)' }}>
              {round.ties.map((tie) => (
                <TieCard key={tie.id} tie={tie} twoLegged={round.isTwoLegged} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TieCard({ tie, twoLegged }: { tie: Tie; twoLegged: boolean }) {
  const settled = !!tie.winnerTeamId;

  return (
    <div
      style={{
        padding: 'var(--s3)',
        background: 'var(--surface-raised)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      <TeamRow
        team={tie.teamA}
        goals={tie.aggregateA}
        won={tie.winnerTeamId === tie.teamA.id}
        settled={settled}
      />
      <TeamRow
        team={tie.teamB}
        goals={tie.aggregateB}
        won={tie.winnerTeamId === tie.teamB.id}
        settled={settled}
      />

      {settled && (
        <p
          style={{
            margin: 'var(--s2) 0 0',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-muted)',
          }}
        >
          {twoLegged ? 'Aggregate' : 'Result'}
          {tie.decidedBy === 'PENALTIES' && ' · won on penalties'}
          {tie.decidedBy === 'EXTRA_TIME' && ' · after extra time'}
        </p>
      )}
      {!settled && (
        <p
          style={{
            margin: 'var(--s2) 0 0',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-muted)',
          }}
        >
          Not settled yet
        </p>
      )}
    </div>
  );
}

function TeamRow({
  team,
  goals,
  won,
  settled,
}: {
  team: TeamRef;
  goals: number | null;
  won: boolean;
  settled: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s2)',
        padding: 'var(--s1) 0',
        // The winner is bold AND carries a tick — never colour alone (§14.1).
        fontWeight: won ? 700 : 400,
        opacity: settled && !won ? 0.6 : 1,
      }}
    >
      {team.crestUrl && <img src={team.crestUrl} alt="" width={20} height={20} loading="lazy" />}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        // ⚠️ shortName, not TLA. Bayern München and Barcelona both use "FCB",
        // so a three-letter code cannot identify a club on its own.
        title={team.name}
      >
        {team.shortName ?? team.name}
      </span>
      {won && <span aria-label="advanced">✓</span>}
      <span className="tnum" style={{ minWidth: 20, textAlign: 'right' }}>
        {goals ?? '–'}
      </span>
    </div>
  );
}
