import { Link, useParams } from 'react-router-dom';
import { useLeague } from '../lib/leagues.js';
import { Button, Card, Empty, RoleBadge, formatDeadline, Loading } from '../components/ui.jsx';
import { ActivityFeed } from '../components/Activity.jsx';

/** League overview: next deadline, scoring summary, join code (task P2-16). */
export function LeagueRoute() {
  const { slug } = useParams<{ slug: string }>();
  const { data, isPending, isError } = useLeague(slug);

  if (isPending) return <Loading />;
  if (isError || !data) return <p>League not found.</p>;

  const l = data.league;
  const isAdmin = l.viewer.role === 'OWNER' || l.viewer.role === 'ADMIN';

  return (
    <section>
      <header style={{ marginBottom: 'var(--s5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
          <h1 style={{ fontSize: 'var(--text-xl)', margin: 0 }}>{l.name}</h1>
          {l.viewer.role && <RoleBadge role={l.viewer.role} />}
        </div>
        <p
          style={{
            color: 'var(--text-muted)',
            margin: 'var(--s1) 0 0',
            fontSize: 'var(--text-sm)',
          }}
        >
          {l.competition.name} · {l.seasonLabel} · {l.memberCount}{' '}
          {l.memberCount === 1 ? 'member' : 'members'}
        </p>
      </header>

      {/* The next deadline is the most important thing on this screen — it is
          what brings people back. One primary action per screen (§14.1). */}
      {l.nextRound ? (
        <div style={{ marginBottom: 'var(--s4)' }}>
          <Card>
            <p
              style={{
                margin: '0 0 var(--s1)',
                fontSize: 'var(--text-sm)',
                color: 'var(--text-muted)',
              }}
            >
              Next round
            </p>
            <p style={{ margin: '0 0 var(--s1)', fontSize: 'var(--text-lg)', fontWeight: 600 }}>
              {l.nextRound.round.name}
            </p>
            <p style={{ margin: '0 0 var(--s4)', color: 'var(--accent)', fontWeight: 600 }}>
              ⏱ {formatDeadline(l.nextRound.deadlineAt)}
            </p>
            <Link
              to={`/leagues/${slug}/predict/${l.nextRound.sequence}`}
              style={{ textDecoration: 'none' }}
            >
              <Button full>Make your predictions</Button>
            </Link>
          </Card>
        </div>
      ) : (
        <div style={{ marginBottom: 'var(--s4)' }}>
          <Empty title="No upcoming rounds">
            Rounds appear once fixtures are published for this season.
          </Empty>
        </div>
      )}

      <div style={{ marginBottom: 'var(--s4)' }}>
        <Card>
          <p style={{ margin: '0 0 var(--s2)', fontWeight: 600 }}>
            Scoring · {l.rules?.name} v{l.rules?.version}
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 'var(--text-sm)' }}>
            {l.rules?.config.awards.map((a) => (
              <li
                key={a.id}
                style={{ display: 'flex', justifyContent: 'space-between', padding: 'var(--s1) 0' }}
              >
                <span>{a.label}</span>
                <span className="tnum" style={{ fontWeight: 600 }}>
                  {a.points > 0 ? `+${a.points}` : a.points}
                </span>
              </li>
            ))}
            {l.rules?.config.multipliers.map((m) => (
              <li
                key={m.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: 'var(--s1) 0',
                  color: 'var(--text-muted)',
                }}
              >
                <span>{m.label}</span>
                <span className="tnum">×{m.factor}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {l.joinCode && (
        <div style={{ marginBottom: 'var(--s4)' }}>
          <Card>
            <p
              style={{
                margin: '0 0 var(--s1)',
                fontSize: 'var(--text-sm)',
                color: 'var(--text-muted)',
              }}
            >
              Join code
            </p>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--s3)',
              }}
            >
              <span
                className="tnum"
                style={{ fontSize: 'var(--text-xl)', fontWeight: 700, letterSpacing: '0.15em' }}
              >
                {l.joinCode}
              </span>
              <Button
                variant="secondary"
                onClick={() => void navigator.clipboard?.writeText(l.joinCode ?? '')}
              >
                Copy
              </Button>
            </div>
          </Card>
        </div>
      )}

      <div style={{ display: 'grid', gap: 'var(--s2)' }}>
        {l.nextRound && l.nextRound.sequence > 1 && (
          <Link
            to={`/leagues/${slug}/rounds/${l.nextRound.sequence - 1}`}
            style={{ textDecoration: 'none' }}
          >
            <Button full variant="secondary">
              Last round&apos;s results
            </Button>
          </Link>
        )}
        <Link to={`/leagues/${slug}/standings`} style={{ textDecoration: 'none' }}>
          <Button full variant="secondary">
            Standings
          </Button>
        </Link>
        <Link to={`/leagues/${slug}/members`} style={{ textDecoration: 'none' }}>
          <Button full variant="secondary">
            Members ({l.memberCount})
          </Button>
        </Link>
        {isAdmin && (
          <Link to={`/leagues/${slug}/rules`} style={{ textDecoration: 'none' }}>
            <Button full variant="secondary">
              Edit scoring rules
            </Button>
          </Link>
        )}
      </div>

      <div style={{ marginTop: 'var(--s5)' }}>
        <ActivityFeed slug={slug} />
      </div>
    </section>
  );
}
