import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useRound, type BreakdownEntry } from '../lib/predictions.js';
import { Card, Empty, Loading } from '../components/ui.jsx';
import { BreakdownSheet } from '../components/BreakdownSheet.jsx';

type ScoreRow = {
  leagueFixtureId: string;
  user: { id: string; username: string; displayName: string };
  selections: { market: string; homeGoals: number | null; awayGoals: number | null }[];
  basePoints: number;
  multiplier: number;
  points: number;
  isExactScore: boolean;
  breakdown: BreakdownEntry[];
};

/**
 * Round results (task P3-27).
 *
 * Final scores, what everyone predicted, and how many points it earned. Tap a
 * score to see exactly which rules fired — that panel is what makes a disputed
 * total resolvable rather than an argument (§5.1).
 */
export function RoundResultsRoute() {
  const { slug, sequence: seqParam } = useParams<{ slug: string; sequence: string }>();
  const sequence = Number(seqParam);
  const round = useRound(slug, sequence);
  const [open, setOpen] = useState<ScoreRow | null>(null);

  const scores = useQuery({
    queryKey: ['league', slug, 'round', sequence, 'scores'],
    queryFn: () =>
      api.get<{ status: string; scores: ScoreRow[] }>(`/leagues/${slug}/rounds/${sequence}/scores`),
    enabled: !!slug && !!sequence,
  });

  if (round.isPending) return <Loading />;
  if (!round.data) return <p>Round not found.</p>;

  const r = round.data.round;
  const byFixture = new Map<string, ScoreRow[]>();
  for (const s of scores.data?.scores ?? []) {
    byFixture.set(s.leagueFixtureId, [...(byFixture.get(s.leagueFixtureId) ?? []), s]);
  }

  // Parenthesised deliberately: `a ?? 0 > 0` parses as `a ?? (0 > 0)` because
  // ?? binds looser than >. It happened to behave correctly here, which is
  // exactly what makes it a trap for whoever edits it next.
  const isScored = (scores.data?.scores.length ?? 0) > 0;

  return (
    <section>
      <header style={{ marginBottom: 'var(--s4)' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', margin: 0 }}>{r.round.name}</h1>
        <Link
          to={`/leagues/${slug}`}
          style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}
        >
          Back to league
        </Link>
      </header>

      {scores.data?.status === 'PROVISIONAL' && (
        <p
          style={{
            margin: '0 0 var(--s3)',
            padding: 'var(--s2) var(--s3)',
            background: 'var(--accent-weak)',
            color: 'var(--accent)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--text-sm)',
          }}
        >
          Not yet final — points may change if a result is corrected.
        </p>
      )}

      {!isScored && (
        <div style={{ marginBottom: 'var(--s4)' }}>
          <Empty title="Not scored yet">
            Points appear once every match in the round has finished.
          </Empty>
        </div>
      )}

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--s3)' }}>
        {r.fixtures.map((f) => {
          const rows = (byFixture.get(f.leagueFixtureId) ?? []).sort((a, b) => b.points - a.points);
          return (
            <li key={f.leagueFixtureId}>
              <Card>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: rows.length ? 'var(--s3)' : 0,
                  }}
                >
                  <Link
                    to={`/football/fixture/${f.fixtureId}?league=${slug}&round=${sequence}`}
                    style={{ color: 'inherit', textDecoration: 'none', fontWeight: 700 }}
                  >
                    {f.homeTeam.shortName ?? f.homeTeam.name} v{' '}
                    {f.awayTeam.shortName ?? f.awayTeam.name}
                  </Link>
                  <span className="tnum" style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>
                    {f.result ? `${f.result.home}–${f.result.away}` : '–'}
                  </span>
                </div>

                {rows.map((s) => {
                  const pick = s.selections.find((x) => x.market === 'EXACT_SCORE');
                  return (
                    <button
                      key={s.user.id}
                      onClick={() => setOpen(s)}
                      style={{
                        display: 'flex',
                        width: '100%',
                        minHeight: 44,
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 'var(--s2)',
                        padding: 'var(--s2) 0',
                        background: 'transparent',
                        border: 'none',
                        borderTop: '1px solid var(--border)',
                        color: 'inherit',
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontSize: 'var(--text-sm)',
                      }}
                    >
                      <span style={{ flex: 1 }}>{s.user.displayName}</span>
                      <span className="tnum" style={{ color: 'var(--text-muted)' }}>
                        {pick && pick.homeGoals !== null
                          ? `${pick.homeGoals}–${pick.awayGoals}`
                          : '—'}
                      </span>
                      <PointsBadge points={s.points} exact={s.isExactScore} />
                    </button>
                  );
                })}
              </Card>
            </li>
          );
        })}
      </ul>

      {open && (
        <BreakdownSheet
          title={`${open.user.displayName} · ${open.points} ${Math.abs(open.points) === 1 ? 'point' : 'points'}`}
          basePoints={open.basePoints}
          multiplier={open.multiplier}
          points={open.points}
          breakdown={open.breakdown}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}

/**
 * Points use a shape AND a word, never colour alone — a green pill and a red
 * pill are the same pill to a colourblind reader (§14.1).
 */
function PointsBadge({ points, exact }: { points: number; exact: boolean }) {
  const positive = points > 0;
  return (
    <span
      className="tnum"
      style={{
        minWidth: 52,
        textAlign: 'right',
        fontWeight: 700,
        color: positive ? 'var(--positive)' : points < 0 ? 'var(--negative)' : 'var(--text-muted)',
      }}
    >
      {exact && <span title="Exact score">✓ </span>}
      {points > 0 ? `+${points}` : points}
    </span>
  );
}
