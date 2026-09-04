import { useParams } from 'react-router-dom';
import { useStandings } from '../lib/predictions.js';
import { Empty, Loading } from '../components/ui.jsx';

/** League table (task P3-21 surface). */
export function StandingsRoute() {
  const { slug } = useParams<{ slug: string }>();
  const { data, isPending } = useStandings(slug);

  if (isPending) return <Loading />;
  if (!data?.standings.length) {
    return (
      <Empty title="No standings yet">The table appears after the first round is scored.</Empty>
    );
  }

  return (
    <section>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 'var(--s4)',
        }}
      >
        <h1 style={{ fontSize: 'var(--text-xl)', margin: 0 }}>Standings</h1>
        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
          After round {data.throughRound}
        </span>
      </div>

      {/* Provisional means results can still be corrected (§9.3). Saying so is
          better than a table that silently moves overnight. */}
      {data.isProvisional && (
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

      <div
        style={{
          overflowX: 'auto',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
          <thead>
            <tr style={{ background: 'var(--surface)' }}>
              <th style={{ ...th, textAlign: 'left', width: 44 }}>#</th>
              <th style={{ ...th, textAlign: 'left' }}>Member</th>
              <th style={th}>Round</th>
              <th style={th}>Exact</th>
              <th style={{ ...th, fontWeight: 700 }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {data.standings.map((r) => (
              <tr
                key={r.user.id}
                style={{
                  borderTop: '1px solid var(--border)',
                  background: r.isViewer ? 'var(--accent-weak)' : undefined,
                }}
              >
                <td style={{ ...td, textAlign: 'left' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span className="tnum">{r.position}</span>
                    <Movement value={r.movement} />
                  </span>
                </td>
                <td style={{ ...td, textAlign: 'left', fontWeight: r.isViewer ? 700 : 400 }}>
                  {r.user.displayName}
                </td>
                <td style={td}>{r.roundPoints}</td>
                <td style={td}>{r.exactScores}</td>
                <td style={{ ...td, fontWeight: 700 }}>{r.totalPoints}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Movement uses an arrow AND a colour — colour is never the only signal
 * (§14.1), and up/down is exactly the kind of thing that would be invisible
 * to a red-green colourblind reader.
 */
function Movement({ value }: { value: number | null }) {
  if (value === null || value === 0) return null;
  const up = value > 0;
  return (
    <span
      aria-label={up ? `up ${value}` : `down ${Math.abs(value)}`}
      style={{ color: up ? 'var(--positive)' : 'var(--negative)', fontSize: 'var(--text-xs)' }}
    >
      {up ? '▲' : '▼'}
      {Math.abs(value)}
    </span>
  );
}

const th: React.CSSProperties = { padding: 'var(--s2)', fontWeight: 600, textAlign: 'right' };
const td: React.CSSProperties = { padding: 'var(--s2)', textAlign: 'right' };
