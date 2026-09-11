import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { copyText, downloadCsv, exportFilename, toDelimited } from '../lib/export.js';
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

type Standings = {
  round: { sequence: number; name: string; status: string } | null;
  rows: {
    position: number;
    previousPosition: number | null;
    user: { id: string; username: string; displayName: string };
    totalPoints: number;
    roundPoints: number;
    exactScores: number;
    correctOutcomes: number;
    predictionsMade: number;
    currentStreak: number;
  }[];
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
  const [copied, setCopied] = useState(false);

  const detail = useQuery({
    queryKey: ['admin', 'league', slug],
    queryFn: () => api.get<Detail>(`/admin/leagues/${slug}`),
    enabled: !!slug,
  });

  const standings = useQuery({
    queryKey: ['admin', 'league', slug, 'standings'],
    queryFn: () => api.get<Standings>(`/admin/leagues/${slug}/standings`),
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

      {/* Points table, with export. Admins are asked for this constantly —
          "send me the table" — and retyping it is where transcription errors
          come from. */}
      <div style={{ marginBottom: 'var(--s4)' }}>
        <Card>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--s2)',
              flexWrap: 'wrap',
              marginBottom: 'var(--s2)',
            }}
          >
            <h2 style={{ fontSize: 'var(--text-sm)', margin: 0, fontWeight: 600 }}>
              Points table
              {standings.data?.round && (
                <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                  {' '}
                  — after {standings.data.round.name}
                </span>
              )}
            </h2>
            {(standings.data?.rows.length ?? 0) > 0 && (
              <div style={{ display: 'flex', gap: 'var(--s2)' }}>
                <button
                  type="button"
                  onClick={() => {
                    // TAB-separated, because that is what pastes into Excel
                    // and Sheets as columns rather than one mashed cell.
                    void copyText(
                      toDelimited(STANDINGS_HEADERS, standingsRows(standings.data!), '	'),
                    ).then((ok) => {
                      setCopied(ok);
                      setTimeout(() => setCopied(false), 2000);
                    });
                  }}
                  style={exportButtonStyle}
                >
                  {copied ? '✓ Copied' : 'Copy as text'}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    downloadCsv(
                      exportFilename([l.name, 'points-table']),
                      toDelimited(STANDINGS_HEADERS, standingsRows(standings.data!)),
                    )
                  }
                  style={exportButtonStyle}
                >
                  Download for Excel
                </button>
              </div>
            )}
          </div>

          {standings.isPending ? (
            <Loading inline />
          ) : (standings.data?.rows.length ?? 0) === 0 ? (
            <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
              No round has been scored yet.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}
              >
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                    {STANDINGS_HEADERS.map((h, i) => (
                      <th
                        key={h}
                        style={{
                          padding: 'var(--s1) var(--s2)',
                          fontWeight: 600,
                          fontSize: 'var(--text-xs)',
                          textAlign: i >= 2 ? 'right' : 'left',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {standings.data!.rows.map((r) => (
                    <tr key={r.user.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: 'var(--s2)', fontWeight: 700 }}>{r.position}</td>
                      <td style={{ padding: 'var(--s2)' }}>
                        {r.user.displayName}{' '}
                        <span style={{ color: 'var(--text-muted)' }}>@{r.user.username}</span>
                      </td>
                      <td style={numCell}>{r.totalPoints}</td>
                      <td style={numCell}>{r.roundPoints}</td>
                      <td style={numCell}>{r.exactScores}</td>
                      <td style={numCell}>{r.correctOutcomes}</td>
                      <td style={numCell}>{r.predictionsMade}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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

const STANDINGS_HEADERS = [
  'Position',
  'Player',
  'Total points',
  'Round points',
  'Exact scores',
  'Correct outcomes',
  'Predictions made',
];

/** One array per row, in the same order as STANDINGS_HEADERS. */
function standingsRows(s: Standings): unknown[][] {
  return s.rows.map((r) => [
    r.position,
    r.user.displayName,
    r.totalPoints,
    r.roundPoints,
    r.exactScores,
    r.correctOutcomes,
    r.predictionsMade,
  ]);
}

const numCell = {
  padding: 'var(--s2)',
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
} as const;

const exportButtonStyle = {
  minHeight: 32,
  padding: '0 var(--s3)',
  background: 'transparent',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--text-xs)',
  cursor: 'pointer',
} as const;
