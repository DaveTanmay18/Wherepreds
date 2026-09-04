/**
 * Score entry (task P3-22).
 *
 * Steppers, not a keyboard. Predictions get entered on a phone, one-handed,
 * minutes before kickoff — a numeric input means summoning a keyboard that
 * covers half the fixture list (§13.3).
 */
export function ScoreStepper(props: {
  label: string;
  value: number | null;
  onChange: (v: number) => void;
  disabled?: boolean;
  align?: 'left' | 'right';
}) {
  const v = props.value ?? 0;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 'var(--s1)',
        opacity: props.disabled ? 0.55 : 1,
      }}
    >
      <StepButton
        symbol="+"
        label={`Increase ${props.label}`}
        disabled={props.disabled || v >= 20}
        onClick={() => props.onChange(v + 1)}
      />
      <output
        aria-label={`${props.label} goals`}
        className="tnum"
        style={{
          fontSize: 'var(--text-2xl)',
          fontWeight: 700,
          minWidth: 40,
          textAlign: 'center',
          color: props.value === null ? 'var(--text-muted)' : 'var(--text)',
        }}
      >
        {props.value ?? '–'}
      </output>
      <StepButton
        symbol="−"
        label={`Decrease ${props.label}`}
        disabled={props.disabled || v <= 0}
        onClick={() => props.onChange(Math.max(0, v - 1))}
      />
    </div>
  );
}

function StepButton(props: {
  symbol: string;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      style={{
        // 56px: the §14.1 floor is 44, but these are the most-tapped controls
        // in the product and deserve more.
        width: 56,
        height: 44,
        fontSize: 'var(--text-xl)',
        lineHeight: 1,
        background: 'var(--surface)',
        color: 'var(--text)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        opacity: props.disabled ? 0.4 : 1,
      }}
    >
      {props.symbol}
    </button>
  );
}

/** One-tap common scorelines (task P3-24). */
export const QUICK_SCORES: [number, number][] = [
  [1, 0],
  [2, 1],
  [1, 1],
  [0, 0],
  [2, 0],
  [0, 1],
];

export function QuickChips(props: {
  onPick: (home: number, away: number) => void;
  disabled?: boolean;
  active?: { home: number; away: number } | null;
}) {
  return (
    <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap', justifyContent: 'center' }}>
      {QUICK_SCORES.map(([h, a]) => {
        const isActive = props.active?.home === h && props.active?.away === a;
        return (
          <button
            key={`${h}-${a}`}
            type="button"
            disabled={props.disabled}
            onClick={() => props.onPick(h, a)}
            className="tnum"
            style={{
              minHeight: 36,
              padding: '0 var(--s3)',
              fontSize: 'var(--text-sm)',
              background: isActive ? 'var(--accent-weak)' : 'transparent',
              color: isActive ? 'var(--accent)' : 'var(--text-muted)',
              border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 999,
              cursor: props.disabled ? 'not-allowed' : 'pointer',
              opacity: props.disabled ? 0.4 : 1,
            }}
          >
            {h}-{a}
          </button>
        );
      })}
    </div>
  );
}
