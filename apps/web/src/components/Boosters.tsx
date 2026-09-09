import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';

export type BoosterBudget = {
  type: string;
  value: number;
  usesPerSeason: number;
  used: number;
  remaining: number;
  scope: 'fixture' | 'round';
};

export type BoosterUse = {
  type: string;
  value: number;
  leagueFixtureId: string | null;
  scope: 'fixture' | 'round';
};

export const BOOSTER_LABELS: Record<string, string> = {
  DOUBLE_POINTS: 'Double points',
  TRIPLE_POINTS: 'Triple points',
  BANKER: 'Banker',
  INSURANCE: 'Insurance',
  WILDCARD_ROUND: 'Wildcard round',
  NO_NEGATIVES: 'No negatives',
};

const BOOSTER_HELP: Record<string, string> = {
  DOUBLE_POINTS: 'Doubles the points from one match.',
  TRIPLE_POINTS: 'Triples the points from one match.',
  BANKER: 'Multiplies the points from one match you nominate.',
  INSURANCE: 'If the round goes badly, tops it up to your average.',
  WILDCARD_ROUND: 'Multiplies every point you score this round.',
  NO_NEGATIVES: 'Stops any match costing you points this round.',
};

export const useBoosterBudget = (slug: string | undefined) =>
  useQuery({
    queryKey: ['league', slug, 'boosters'],
    queryFn: () => api.get<{ boosters: BoosterBudget[] }>(`/leagues/${slug}/boosters`),
    enabled: !!slug,
  });

export const useRoundBoosters = (slug: string | undefined, sequence: number | undefined) =>
  useQuery({
    queryKey: ['league', slug, 'round', sequence, 'boosters'],
    queryFn: () => api.get<{ used: BoosterUse[] }>(`/leagues/${slug}/rounds/${sequence}/boosters`),
    enabled: !!slug && !!sequence,
  });

export function useBoosterMutations(slug: string | undefined, sequence: number | undefined) {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['league', slug, 'boosters'] });
    void qc.invalidateQueries({ queryKey: ['league', slug, 'round', sequence, 'boosters'] });
  };

  return {
    place: useMutation({
      mutationFn: (input: { type: string; leagueFixtureId?: string }) =>
        api.post(`/leagues/${slug}/rounds/${sequence}/booster`, input),
      onSuccess: invalidate,
    }),
    revoke: useMutation({
      mutationFn: (type: string) => api.del(`/leagues/${slug}/rounds/${sequence}/booster/${type}`),
      onSuccess: invalidate,
    }),
  };
}

/**
 * Round-level boosters (task P5-05).
 *
 * Fixture-level boosters are nominated on the fixture row itself — putting
 * them here too would mean choosing a match from a dropdown, which is worse
 * than tapping the match you are already looking at.
 */
export function RoundBoosterBar(props: {
  budget: BoosterBudget[];
  used: BoosterUse[];
  disabled: boolean;
  onPlace: (type: string) => void;
  onRevoke: (type: string) => void;
}) {
  const roundLevel = props.budget.filter((b) => b.scope === 'round');
  if (roundLevel.length === 0) return null;

  return (
    <div
      style={{
        padding: 'var(--s3)',
        marginBottom: 'var(--s3)',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      <p style={{ margin: '0 0 var(--s2)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>
        Round boosters
      </p>
      <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap' }}>
        {roundLevel.map((b) => {
          const active = props.used.some((u) => u.type === b.type);
          const exhausted = !active && b.remaining === 0;
          return (
            <button
              key={b.type}
              type="button"
              disabled={props.disabled || exhausted}
              aria-pressed={active}
              title={BOOSTER_HELP[b.type]}
              onClick={() => (active ? props.onRevoke(b.type) : props.onPlace(b.type))}
              style={{
                minHeight: 44,
                padding: '0 var(--s3)',
                background: active ? 'var(--accent-weak)' : 'transparent',
                color: active ? 'var(--accent)' : 'var(--text)',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 999,
                fontSize: 'var(--text-sm)',
                fontWeight: active ? 700 : 400,
                cursor: props.disabled || exhausted ? 'not-allowed' : 'pointer',
                opacity: exhausted ? 0.45 : 1,
              }}
            >
              {active && <span aria-hidden>✓ </span>}
              {BOOSTER_LABELS[b.type] ?? b.type}
              {/* Remaining uses shown on the control, so nobody has to go
                  looking for whether they can still afford it. */}
              <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                {' '}
                {b.remaining}/{b.usesPerSeason}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Read-only marker for a booster already placed on this fixture.
 *
 * ⚠️ Rendered whether or not the fixture is locked. The placement CONTROL
 * necessarily disappears at the deadline, but "which match did I bank?" is a
 * question people ask most once they can no longer change the answer — during
 * the match, and afterwards when the points land. Hiding the marker with the
 * control left no way to tell.
 */
export function FixtureBoosterBadge(props: { used: BoosterUse[]; leagueFixtureId: string }) {
  const on = props.used.filter(
    (u) => u.scope === 'fixture' && u.leagueFixtureId === props.leagueFixtureId,
  );
  if (on.length === 0) return null;

  return (
    <span style={{ display: 'inline-flex', gap: 'var(--s1)' }}>
      {on.map((u) => (
        <span
          key={u.type}
          title={`${BOOSTER_LABELS[u.type] ?? u.type} is on this match`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px var(--s2)',
            background: 'var(--accent)',
            color: 'var(--accent-text)',
            borderRadius: 999,
            fontSize: 'var(--text-xs)',
            fontWeight: 700,
            whiteSpace: 'nowrap',
          }}
        >
          {/* Icon AND text: colour alone is never the only signal (§14.1). */}
          <span aria-hidden>⚡</span>
          {BOOSTER_LABELS[u.type] ?? u.type} ×{u.value}
        </span>
      ))}
    </span>
  );
}

/** Fixture-level booster control, rendered on the match it applies to. */
export function FixtureBoosterButton(props: {
  budget: BoosterBudget[];
  used: BoosterUse[];
  leagueFixtureId: string;
  disabled: boolean;
  onPlace: (type: string, leagueFixtureId: string) => void;
  onRevoke: (type: string) => void;
}) {
  const fixtureLevel = props.budget.filter((b) => b.scope === 'fixture');
  if (fixtureLevel.length === 0) return null;

  return (
    <div style={{ display: 'flex', gap: 'var(--s2)', justifyContent: 'center', flexWrap: 'wrap' }}>
      {fixtureLevel.map((b) => {
        const use = props.used.find((u) => u.type === b.type);
        const onThis = use?.leagueFixtureId === props.leagueFixtureId;
        const onAnother = !!use && !onThis;
        const exhausted = !use && b.remaining === 0;

        return (
          <button
            key={b.type}
            type="button"
            disabled={props.disabled || exhausted}
            aria-pressed={onThis}
            title={
              onAnother ? `Currently on another match — tap to move it here.` : BOOSTER_HELP[b.type]
            }
            onClick={() =>
              onThis ? props.onRevoke(b.type) : props.onPlace(b.type, props.leagueFixtureId)
            }
            style={{
              minHeight: 36,
              padding: '0 var(--s3)',
              // FILLED when placed here, not merely tinted. Against a row of
              // identical outline chips a faint background reads as "slightly
              // different", not "this is the one".
              background: onThis ? 'var(--accent)' : 'transparent',
              // A booster placed on ANOTHER match is dimmed rather than
              // hidden — otherwise "where did my banker go?" has no answer.
              color: onThis ? 'var(--accent-text)' : 'var(--text-muted)',
              border: `1px solid ${onThis ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 999,
              fontSize: 'var(--text-xs)',
              fontWeight: onThis ? 700 : 400,
              cursor: props.disabled || exhausted ? 'not-allowed' : 'pointer',
              opacity: exhausted ? 0.4 : onAnother ? 0.6 : 1,
            }}
          >
            {onThis ? '⚡ ' : ''}
            {BOOSTER_LABELS[b.type] ?? b.type} ×{b.value}
            {onAnother && <span style={{ fontStyle: 'italic' }}> (elsewhere)</span>}
          </button>
        );
      })}
    </div>
  );
}
