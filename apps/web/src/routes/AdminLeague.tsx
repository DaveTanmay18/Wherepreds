import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Card, Loading } from '../components/ui.jsx';

type Detail = {
  league: {
    slug: string;
    name: string;
    competition: string;
    season: string;
    visibility: string;
    members: {
      userId: string;
      username: string;
      displayName: string;
      role: string;
      status: string;
    }[];
    rounds: {
      sequence: number;
      name: string;
      status: string;
      deadlineAt: string;
      fixtureCount: number;
      predictionCount: number;
    }[];
  };
};

type Selection = {
  market: string;
  homeGoals: number | null;
  awayGoals: number | null;
  outcome: string | null;
};

type RoundPredictions = {
  round: { sequence: number; name: string; status: string; deadlineAt: string };
  hiddenFromMembers: boolean;
  fixtures: {
    leagueFixtureId: string;
    kickoffAt: string;
    homeTeam: string;
    awayTeam: string;
    result: { home: number; away: number } | null;
    predictions: {
      user: { id: string; username: string; displayName: string };
      status: string;
      note: string | null;
      selections: Selection[];
      points: string | null;
      booster: { type: string; value: number } | null;
    }[];
  }[];
};

/** One league, every round, and every member's picks in the chosen round. */
export function AdminLeagueRoute() {
  const { slug } = useParams<{ slug: string }>();
  const [sequence, setSequence] = useState<number | null>(null);

  const detail = useQuery({
    queryKey: ['admin', 'league', slug],
    queryFn: () => api.get<Detail>(`/admin/leagues/${slug}`),
    enabled: !!slug,
  });

  const picks = useQuery({
    queryKey: ['admin', 'league', slug, 'round', sequence],
    queryFn: () =>
      api.get<RoundPredictions>(`/admin/leagues/${slug}/rounds/${sequence}/predictions`),
    enabled: !!slug && sequence !== null,
  });

  if (detail.isPending) return <Loading />;
  if (detail.isError || !detail.data) return <p>League not found.</p>;

  const l = detail.data.league;

  return (
    <section>
      <header style={{ marginBottom: 'var(--s4)' }}>
        <Link to="/admin" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
          ‹ All leagues
        </Link>
        <h1 style={{ fontSize: 'var(--text-xl)', margin: 'var(--s2) 0 0' }}>{l.name}</h1>
        <p
          style={{
            margin: 'var(--s1) 0 0',
            color: 'var(--text-muted)',
            fontSize: 'var(--text-sm)',
          }}
        >
          {l.competition} · {l.season} · {l.members.length} members
        </p>
      </header>

      <div style={{ marginBottom: 'var(--s4)' }}>
        <Card>
          <h2 style={{ fontSize: 'var(--text-sm)', margin: '0 0 var(--s2)', fontWeight: 600 }}>
            Members
          </h2>
          {l.members.map((m) => (
            <div
              key={m.userId}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: 'var(--s1) 0',
                fontSize: 'var(--text-sm)',
              }}
            >
              <span>
                {m.displayName} <span style={{ color: 'var(--text-muted)' }}>@{m.username}</span>
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
                {m.role.toLowerCase()}
                {m.status !== 'ACTIVE' && ` · ${m.status.toLowerCase()}`}
              </span>
            </div>
          ))}
        </Card>
      </div>

      <h2 style={{ fontSize: 'var(--text-sm)', margin: '0 0 var(--s2)', fontWeight: 600 }}>
        Rounds — pick one to see every prediction
      </h2>
      <div
        style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s2)', marginBottom: 'var(--s4)' }}
      >
        {l.rounds.map((r) => {
          const active = sequence === r.sequence;
          return (
            <button
              key={r.sequence}
              type="button"
              aria-pressed={active}
              onClick={() => setSequence(active ? null : r.sequence)}
              title={`${r.name} · ${r.status.toLowerCase()} · ${r.predictionCount} predictions`}
              style={{
                minHeight: 40,
                padding: '0 var(--s3)',
                background: active ? 'var(--accent-weak)' : 'transparent',
                color: active ? 'var(--accent)' : 'var(--text)',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-sm)',
                cursor: 'pointer',
                // Rounds nobody predicted are dimmed rather than hidden — an
                // empty round is often exactly what you are investigating.
                opacity: r.predictionCount === 0 ? 0.5 : 1,
              }}
            >
              {r.sequence}
              <span className="tnum" style={{ color: 'var(--text-muted)' }}>
                {' '}
                ({r.predictionCount})
              </span>
            </button>
          );
        })}
      </div>

      {sequence !== null && picks.isPending && <Loading />}

      {picks.data && (
        <div style={{ display: 'grid', gap: 'var(--s3)' }}>
          {/* ⚠️ Surfaced, not buried. Reading an open round means seeing what
              no member can see yet, and the API records it in the audit log. */}
          {picks.data.hiddenFromMembers && (
            <p
              style={{
                margin: 0,
                padding: 'var(--s3)',
                background: 'var(--surface)',
                border: '1px solid var(--warning)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--warning)',
                fontSize: 'var(--text-sm)',
              }}
            >
              This round is still open — members cannot see these picks yet. Your viewing them is
              recorded in the league activity log.
            </p>
          )}

          {picks.data.fixtures.map((f) => (
            <Card key={f.leagueFixtureId}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  gap: 'var(--s2)',
                  marginBottom: 'var(--s2)',
                }}
              >
                <strong style={{ fontSize: 'var(--text-sm)' }}>
                  {f.homeTeam} v {f.awayTeam}
                </strong>
                <span className="tnum" style={{ fontSize: 'var(--text-sm)' }}>
                  {f.result ? `${f.result.home}–${f.result.away}` : '–'}
                </span>
              </div>

              {f.predictions.length === 0 ? (
                <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
                  Nobody predicted this match.
                </p>
              ) : (
                f.predictions.map((p) => {
                  const score = p.selections.find((s) => s.market === 'EXACT_SCORE');
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
                      <span style={{ flex: 1, minWidth: 0 }}>
                        {p.user.displayName}
                        {p.status === 'DRAFT' && (
                          <span style={{ color: 'var(--warning)', fontSize: 'var(--text-xs)' }}>
                            {' '}
                            draft
                          </span>
                        )}
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
                      {p.booster && (
                        <span style={{ color: 'var(--accent)', fontSize: 'var(--text-xs)' }}>
                          ⚡{p.booster.type.replace(/_/g, ' ').toLowerCase()} ×{p.booster.value}
                        </span>
                      )}
                      <span className="tnum" style={{ minWidth: 44, textAlign: 'right' }}>
                        {score && score.homeGoals !== null
                          ? `${score.homeGoals}–${score.awayGoals}`
                          : '—'}
                      </span>
                      <span
                        className="tnum"
                        style={{
                          minWidth: 40,
                          textAlign: 'right',
                          fontWeight: 700,
                          color:
                            p.points === null
                              ? 'var(--text-muted)'
                              : Number(p.points) > 0
                                ? 'var(--positive)'
                                : 'var(--text-muted)',
                        }}
                      >
                        {p.points === null ? '' : Number(p.points) > 0 ? `+${p.points}` : p.points}
                      </span>
                    </div>
                  );
                })
              )}
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
