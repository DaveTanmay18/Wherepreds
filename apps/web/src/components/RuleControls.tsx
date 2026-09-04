import type { Award, Condition, RuleConfig } from '../lib/rules.js';

export type MarketOption = { market: string; available: boolean; reason: string | null };
export type FactOption = {
  fact: string;
  label: string;
  type: 'boolean' | 'number';
  markets: readonly string[];
};

const MARKET_LABELS: Record<string, string> = {
  EXACT_SCORE: 'Exact score',
  MATCH_OUTCOME: 'Match result (1X2)',
  DOUBLE_CHANCE: 'Double chance',
  BOTH_TEAMS_TO_SCORE: 'Both teams to score',
  TOTAL_GOALS_OVER_UNDER: 'Total goals over/under',
  CORRECT_MARGIN: 'Winning margin',
  HALF_TIME_OUTCOME: 'Half-time result',
  FIRST_GOALSCORER: 'First goalscorer',
  ANYTIME_GOALSCORER: 'Anytime goalscorer',
  CLEAN_SHEET: 'Clean sheet',
  RED_CARD_SHOWN: 'Red card shown',
  TOTAL_CORNERS_OVER_UNDER: 'Total corners over/under',
  TO_QUALIFY: 'Who goes through (knockout)',
};

/**
 * Market toggles (task P4-09).
 *
 * An unavailable market is shown DISABLED with the reason, not hidden. Hiding
 * it leaves an admin wondering why the app cannot do something the docs
 * describe; saying "needs the Deep Data plan" is actionable (§11.5).
 */
export function MarketToggles(props: {
  markets: string[];
  options: MarketOption[];
  onChange: (markets: string[]) => void;
}) {
  const toggle = (m: string) =>
    props.onChange(
      props.markets.includes(m) ? props.markets.filter((x) => x !== m) : [...props.markets, m],
    );

  return (
    <div>
      <p
        style={{ margin: '0 0 var(--s3)', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}
      >
        Up to six. Each market is something members predict on every fixture.
      </p>
      {props.options.map((o) => {
        const on = props.markets.includes(o.market);
        const atLimit = !on && props.markets.length >= 6;
        const disabled = !o.available || atLimit;
        return (
          <label
            key={o.market}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 'var(--s2)',
              minHeight: 44,
              padding: 'var(--s2) 0',
              borderTop: '1px solid var(--border)',
              opacity: disabled ? 0.55 : 1,
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={on}
              disabled={disabled}
              onChange={() => toggle(o.market)}
              style={{ marginTop: 4 }}
            />
            <span style={{ flex: 1 }}>
              <span style={{ fontWeight: on ? 600 : 400 }}>
                {MARKET_LABELS[o.market] ?? o.market}
              </span>
              {o.reason && (
                <span
                  style={{
                    display: 'block',
                    color: 'var(--warning)',
                    fontSize: 'var(--text-xs)',
                  }}
                >
                  {o.reason}
                </span>
              )}
              {atLimit && (
                <span
                  style={{
                    display: 'block',
                    color: 'var(--text-muted)',
                    fontSize: 'var(--text-xs)',
                  }}
                >
                  Six markets is the maximum — turn one off first.
                </span>
              )}
            </span>
          </label>
        );
      })}
    </div>
  );
}

/**
 * Condition builder (task P4-11).
 *
 * ⚠️ Deliberately constrained. The fact list is filtered to what the SELECTED
 * markets actually expose — surfacing every fact in ScoringFacts at once is
 * the single highest clutter risk in this product (§14.1), and most of them
 * would be meaningless for the markets a given league plays.
 *
 * Only leaf conditions and a single `all` group are editable here. Nested
 * any/not trees remain valid and are displayed, but authoring them needs the
 * API — a visual boolean-tree builder earns its complexity only once someone
 * actually asks for one.
 */
export function ConditionBuilder(props: {
  condition: Condition;
  facts: FactOption[];
  onChange: (c: Condition) => void;
}) {
  const leaves: Extract<Condition, { fact: string }>[] =
    'all' in props.condition
      ? (props.condition.all.filter((c) => 'fact' in c) as Extract<Condition, { fact: string }>[])
      : 'fact' in props.condition
        ? [props.condition]
        : [];

  const nested = !('fact' in props.condition) && !('all' in props.condition);

  if (nested) {
    return (
      <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
        This rule uses a nested condition that the visual editor cannot change. Its points can still
        be edited above.
      </p>
    );
  }

  const update = (i: number, patch: Partial<Extract<Condition, { fact: string }>>) => {
    const next = leaves.map((l, j) => (i === j ? { ...l, ...patch } : l));
    props.onChange(next.length === 1 ? next[0]! : { all: next });
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--s2)' }}>
      {leaves.map((leaf, i) => {
        const fact = props.facts.find((f) => f.fact === leaf.fact);
        return (
          <div key={i} style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap' }}>
            <select
              aria-label="Condition fact"
              value={leaf.fact}
              onChange={(e) => {
                const f = props.facts.find((x) => x.fact === e.target.value);
                update(i, {
                  fact: e.target.value,
                  op: f?.type === 'boolean' ? 'eq' : 'gte',
                  value: f?.type === 'boolean' ? true : 1,
                });
              }}
              style={select}
            >
              {props.facts.map((f) => (
                <option key={f.fact} value={f.fact}>
                  {f.label}
                </option>
              ))}
              {!fact && <option value={leaf.fact}>{leaf.fact}</option>}
            </select>

            {fact?.type === 'boolean' ? (
              <select
                aria-label="Condition value"
                value={String(leaf.value)}
                onChange={(e) => update(i, { op: 'eq', value: e.target.value === 'true' })}
                style={select}
              >
                <option value="true">is true</option>
                <option value="false">is false</option>
              </select>
            ) : (
              <>
                <select
                  aria-label="Condition operator"
                  value={leaf.op}
                  onChange={(e) => update(i, { op: e.target.value })}
                  style={select}
                >
                  <option value="gte">is at least</option>
                  <option value="gt">is more than</option>
                  <option value="lte">is at most</option>
                  <option value="lt">is less than</option>
                  <option value="eq">is exactly</option>
                </select>
                <input
                  type="number"
                  aria-label="Condition threshold"
                  value={Number(leaf.value)}
                  step="any"
                  onChange={(e) => update(i, { value: Number(e.target.value) })}
                  style={{ ...select, width: 90, textAlign: 'right' }}
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A blank award, ready to edit (task P4-11). */
export function blankAward(config: RuleConfig, facts: FactOption[]): Award {
  let n = config.awards.length + 1;
  while (config.awards.some((a) => a.id === `custom_${n}`)) n++;
  const fact = facts[0] ?? { fact: 'derived.outcomeCorrect', type: 'boolean' as const };
  return {
    id: `custom_${n}`,
    label: `New rule ${n}`,
    market: config.markets[0] ?? 'EXACT_SCORE',
    group: null,
    when: { fact: fact.fact, op: 'eq', value: true },
    points: 1,
  };
}

const select: React.CSSProperties = {
  minHeight: 44,
  padding: '0 var(--s2)',
  fontSize: '16px',
  color: 'var(--text)',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  maxWidth: '100%',
};
