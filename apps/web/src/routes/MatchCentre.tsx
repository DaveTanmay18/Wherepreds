import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Card, Loading } from '../components/ui.jsx';

type Team = {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  tla: string | null;
  crestUrl: string | null;
};

type FixtureDetail = {
  id: string;
  kickoffAt: string;
  status: string;
  minute: number | null;
  score: {
    home: number | null;
    away: number | null;
    halfTime: { home: number | null; away: number | null };
    extraTime: { home: number | null; away: number | null };
    penalties: { home: number | null; away: number | null };
  };
  homeTeam: Team;
  awayTeam: Team;
  legNumber: number | null;
  tie?: {
    aggregateA: number | null;
    aggregateB: number | null;
    teamAId: string;
    winnerTeamId: string | null;
  } | null;
  events: {
    id: string;
    type: string;
    minute: number;
    player: { displayName: string } | null;
    team: { id: string; tla: string | null } | null;
  }[];
};

type Pick = {
  leagueFixtureId: string;
  user: { id: string; displayName: string };
  note: string | null;
  selections: { market: string; homeGoals: number | null; awayGoals: number | null }[];
  points: string | null;
};

const LIVE_STATUSES = ['LIVE', 'HALF_TIME', 'SECOND_HALF', 'EXTRA_TIME', 'PENALTY_SHOOTOUT'];

/**
 * Match centre (tasks P5-14 to P5-17).
 *
 * ⚠️ Live state is DISPLAYED but never scored (§9.4). Points settle at full
 * time, and the screen says so rather than leaving people to wonder whether a
 * number is being withheld.
 */
export function MatchCentreRoute() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  // Optional league context: when arriving from a round, the picks tab can
  // show what the league predicted.
  const leagueSlug = params.get('league');
  const sequence = params.get('round');

  const { data, isPending } = useQuery({
    queryKey: ['fixture', id],
    queryFn: () => api.get<{ fixture: FixtureDetail }>(`/fixtures/${id}`),
    enabled: !!id,
    // Only poll while it could actually be changing.
    refetchInterval: (q) => {
      const s = (q.state.data as { fixture?: FixtureDetail } | undefined)?.fixture?.status;
      return s && LIVE_STATUSES.includes(s) ? 30_000 : false;
    },
  });

  const picks = useQuery({
    queryKey: ['league', leagueSlug, 'round', sequence, 'picks'],
    queryFn: () =>
      api.get<{ hiddenUntilDeadline: boolean; picks: Pick[] }>(
        `/leagues/${leagueSlug}/rounds/${sequence}/picks`,
      ),
    enabled: !!leagueSlug && !!sequence,
  });

  if (isPending) return <Loading />;
  if (!data) return <p>Match not found.</p>;

  const f = data.fixture;
  const isLive = LIVE_STATUSES.includes(f.status);
  const finished = f.status === 'FINISHED' || f.status === 'AWARDED';
  const played = f.score.home !== null;

  const forThis = (picks.data?.picks ?? []).filter((p) => {
    const sel = p.selections.find((s) => s.market === 'EXACT_SCORE');
    return sel && sel.homeGoals !== null;
  });

  return (
    <section>
      <header style={{ marginBottom: 'var(--s4)' }}>
        {leagueSlug && sequence ? (
          <Link
            to={`/leagues/${leagueSlug}/rounds/${sequence}`}
            style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}
          >
            ‹ Back to round
          </Link>
        ) : (
          <Link to="/football" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
            ‹ Football
          </Link>
        )}
      </header>

      <Card>
        {isLive && (
          <p
            style={{
              margin: '0 0 var(--s3)',
              textAlign: 'center',
              color: 'var(--live)',
              fontWeight: 700,
              fontSize: 'var(--text-sm)',
            }}
          >
            <span aria-hidden>●</span> LIVE{f.minute !== null ? ` ${f.minute}'` : ''}
          </p>
        )}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
            alignItems: 'center',
            gap: 'var(--s3)',
            maxWidth: 420,
            margin: '0 auto',
          }}
        >
          <TeamSide team={f.homeTeam} align="right" />
          <span className="tnum" style={{ fontSize: 'var(--text-2xl)', fontWeight: 700 }}>
            {played ? `${f.score.home} – ${f.score.away}` : 'v'}
          </span>
          <TeamSide team={f.awayTeam} align="left" />
        </div>

        {/* Aggregate only from leg 2 onward — before that there is nothing to
            aggregate (§13.4). */}
        {f.tie && f.legNumber === 2 && f.tie.aggregateA !== null && (
          <p
            style={{
              margin: 'var(--s2) 0 0',
              textAlign: 'center',
              fontSize: 'var(--text-sm)',
              color: 'var(--text-muted)',
            }}
          >
            Aggregate {f.tie.aggregateA}–{f.tie.aggregateB}
          </p>
        )}

        <p
          style={{
            margin: 'var(--s2) 0 0',
            textAlign: 'center',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-muted)',
          }}
        >
          {new Date(f.kickoffAt).toLocaleString(undefined, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>

        {/* ⚠️ Deliberate wording (§9.4, task P5-15). "Pending" implies a number
            is being withheld; stating the rule answers the question once. */}
        {isLive && (
          <p
            style={{
              margin: 'var(--s3) 0 0',
              padding: 'var(--s2)',
              textAlign: 'center',
              background: 'var(--surface)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-sm)',
              color: 'var(--text-muted)',
            }}
          >
            ⏳ Points at full time
          </p>
        )}
      </Card>

      {f.events.length > 0 && (
        <div style={{ marginTop: 'var(--s3)' }}>
          <Card>
            <h2 style={{ fontSize: 'var(--text-sm)', margin: '0 0 var(--s2)', fontWeight: 600 }}>
              Timeline
            </h2>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: 'var(--text-sm)' }}>
              {/* Newest first: during a live match the latest event is what
                  people came to see. */}
              {[...f.events]
                .sort((a, b) => b.minute - a.minute)
                .map((e) => (
                  <li
                    key={e.id}
                    style={{ display: 'flex', gap: 'var(--s2)', padding: 'var(--s1) 0' }}
                  >
                    <span className="tnum" style={{ color: 'var(--text-muted)', minWidth: 32 }}>
                      {e.minute}&apos;
                    </span>
                    <span>{eventIcon(e.type)}</span>
                    <span style={{ flex: 1 }}>{e.player?.displayName ?? e.type}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{e.team?.tla}</span>
                  </li>
                ))}
            </ul>
          </Card>
        </div>
      )}

      {/* Picks tab (task P5-17). During a live match this is the most-watched
          screen in the product — it is where the group chat happens. */}
      {leagueSlug && (
        <div style={{ marginTop: 'var(--s3)' }}>
          <Card>
            <h2 style={{ fontSize: 'var(--text-sm)', margin: '0 0 var(--s2)', fontWeight: 600 }}>
              League picks
            </h2>

            {picks.data?.hiddenUntilDeadline ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', margin: 0 }}>
                Hidden until the deadline passes.
              </p>
            ) : forThis.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', margin: 0 }}>
                No picks to show.
              </p>
            ) : (
              forThis.map((p) => {
                const sel = p.selections.find((s) => s.market === 'EXACT_SCORE')!;
                const onTrack =
                  played && sel.homeGoals === f.score.home && sel.awayGoals === f.score.away;
                return (
                  <div
                    key={p.user.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--s2)',
                      padding: 'var(--s2) 0',
                      borderTop: '1px solid var(--border)',
                      fontSize: 'var(--text-sm)',
                    }}
                  >
                    <span style={{ flex: 1 }}>
                      {p.user.displayName}
                      {p.note && (
                        <span
                          style={{
                            display: 'block',
                            color: 'var(--text-muted)',
                            fontSize: 'var(--text-xs)',
                            fontStyle: 'italic',
                          }}
                        >
                          “{p.note}”
                        </span>
                      )}
                    </span>
                    <span className="tnum">
                      {sel.homeGoals}–{sel.awayGoals}
                    </span>
                    {/* ⚠️ "On track" is a FACTUAL statement that the current
                        scoreline matches, not a points projection. It vanishes
                        the moment the score changes (§9.4, task P5-16). */}
                    {isLive && onTrack && (
                      <span style={{ color: 'var(--positive)', fontSize: 'var(--text-xs)' }}>
                        ✓ on track
                      </span>
                    )}
                    {finished && p.points !== null && (
                      <span
                        className="tnum"
                        style={{
                          fontWeight: 700,
                          minWidth: 40,
                          textAlign: 'right',
                          color: Number(p.points) > 0 ? 'var(--positive)' : 'var(--text-muted)',
                        }}
                      >
                        {Number(p.points) > 0 ? `+${p.points}` : p.points}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </Card>
        </div>
      )}
    </section>
  );
}

function TeamSide({ team, align }: { team: Team; align: 'left' | 'right' }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s2)',
        // See the note in Predict.tsx: row-reverse inverts the main axis, so
        // flex-end is what pins the away label to the score in the middle.
        justifyContent: 'flex-end',
        flexDirection: align === 'right' ? 'row' : 'row-reverse',
        minWidth: 0,
      }}
    >
      <span
        title={team.name}
        style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {team.shortName ?? team.name}
      </span>
      {team.crestUrl && (
        <img src={team.crestUrl} alt="" width={28} height={28} style={{ flexShrink: 0 }} />
      )}
    </div>
  );
}

function eventIcon(type: string): string {
  switch (type) {
    case 'GOAL':
    case 'PENALTY_SCORED':
      return '⚽';
    case 'OWN_GOAL':
      return '⚽';
    case 'YELLOW_CARD':
      return '🟨';
    case 'RED_CARD':
    case 'SECOND_YELLOW':
      return '🟥';
    case 'SUBSTITUTION':
      return '🔁';
    default:
      return '•';
  }
}
