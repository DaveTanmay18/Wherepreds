import { useEffect } from 'react';
import type { BreakdownEntry } from '../lib/predictions.js';

/**
 * The breakdown sheet (task P3-28).
 *
 * The answer to "why did I get 7 points?". Every rule that fired is stored on
 * the score with its label, so this reads back in the league's own words
 * rather than in ours — which is what makes a disputed total resolvable
 * instead of an argument (§5.1).
 *
 * Bottom-anchored on mobile: a centred modal on a phone puts the content
 * under the reader's thumb and the dismiss control out of reach (§14.4).
 */
export function BreakdownSheet(props: {
  title: string;
  basePoints: number;
  multiplier: number;
  points: number;
  breakdown: BreakdownEntry[];
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  const awards = props.breakdown.filter((b) => b.kind === 'award');
  const multipliers = props.breakdown.filter((b) => b.kind === 'multiplier');
  const hasMultiplier = props.multiplier !== 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Points breakdown"
      onClick={props.onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: 'rgb(0 0 0 / 0.45)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 480,
          background: 'var(--surface-raised)',
          borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
          padding: 'var(--s4)',
          paddingBottom: 'calc(var(--s4) + env(safe-area-inset-bottom))',
          maxHeight: '80dvh',
          overflowY: 'auto',
        }}
      >
        <div
          aria-hidden
          style={{
            width: 36,
            height: 4,
            borderRadius: 999,
            background: 'var(--border)',
            margin: '0 auto var(--s3)',
          }}
        />

        <h2 style={{ margin: '0 0 var(--s4)', fontSize: 'var(--text-lg)' }}>{props.title}</h2>

        {awards.length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
            No rules matched this prediction, so it scored nothing.
          </p>
        )}

        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {awards.map((b) => (
            <li
              key={b.ruleId}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 'var(--s3)',
                padding: 'var(--s2) 0',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <span>{b.label}</span>
              <span
                className="tnum"
                style={{
                  fontWeight: 600,
                  color: (b.points ?? 0) >= 0 ? 'var(--positive)' : 'var(--negative)',
                }}
              >
                {(b.points ?? 0) > 0 ? `+${b.points}` : b.points}
              </span>
            </li>
          ))}
        </ul>

        {multipliers.length > 0 && (
          <ul style={{ listStyle: 'none', margin: 'var(--s2) 0 0', padding: 0 }}>
            {multipliers.map((b) => (
              <li
                key={b.ruleId}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 'var(--s3)',
                  padding: 'var(--s2) 0',
                  borderBottom: '1px solid var(--border)',
                  color: 'var(--accent)',
                }}
              >
                <span>{b.label}</span>
                <span className="tnum" style={{ fontWeight: 600 }}>
                  ×{b.factor}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* The arithmetic, rebuilt from the stored fields alone. The engine
            guarantees round(basePoints x multiplier) === points, so this can
            never disagree with the number in the table (§8.5). */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 'var(--s4)',
            paddingTop: 'var(--s3)',
            borderTop: '2px solid var(--border)',
            fontWeight: 700,
          }}
        >
          <span>
            Total
            {hasMultiplier && (
              <span
                className="tnum"
                style={{
                  fontWeight: 400,
                  color: 'var(--text-muted)',
                  fontSize: 'var(--text-sm)',
                  marginLeft: 'var(--s2)',
                }}
              >
                {props.basePoints} × {props.multiplier}
              </span>
            )}
          </span>
          <span className="tnum">{props.points}</span>
        </div>

        <button
          onClick={props.onClose}
          style={{
            width: '100%',
            minHeight: 48,
            marginTop: 'var(--s4)',
            background: 'transparent',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--text-base)',
            cursor: 'pointer',
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
