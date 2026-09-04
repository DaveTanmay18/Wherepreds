import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/api.js';
import { useJoinLeague, useMyLeagues } from '../lib/leagues.js';
import { Button, Card, Empty, ErrorText, RoleBadge, Loading } from '../components/ui.jsx';

/** My leagues, plus join-by-code (task P2-16). */
export function LeaguesRoute() {
  const navigate = useNavigate();
  const { data, isPending } = useMyLeagues();
  const join = useJoinLeague();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submitJoin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await join.mutateAsync({ joinCode: code.trim().toUpperCase() });
      navigate(`/leagues/${res.leagueSlug}`);
    } catch (err) {
      setError(
        err instanceof ApiError ? (err.problem.detail ?? err.problem.title) : 'Could not join.',
      );
    }
  }

  return (
    <section>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--s4)',
        }}
      >
        <h1 style={{ fontSize: 'var(--text-xl)', margin: 0 }}>My leagues</h1>
        <Link to="/leagues/new" style={{ textDecoration: 'none' }}>
          <Button>New league</Button>
        </Link>
      </div>

      {isPending ? (
        <Loading inline />
      ) : data?.leagues.length ? (
        <ul
          style={{
            listStyle: 'none',
            margin: '0 0 var(--s6)',
            padding: 0,
            display: 'grid',
            gap: 'var(--s2)',
          }}
        >
          {data.leagues.map((l) => (
            <li key={l.slug}>
              <Link to={`/leagues/${l.slug}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <Card>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
                    {l.competition.logoUrl && (
                      <img src={l.competition.logoUrl} alt="" width={28} height={28} />
                    )}
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
                        <strong>{l.name}</strong>
                        <RoleBadge role={l.role} />
                      </div>
                      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                        {l.competition.name} · {l.seasonLabel} · {l.memberCount}{' '}
                        {l.memberCount === 1 ? 'member' : 'members'}
                      </span>
                    </div>
                    <span aria-hidden style={{ color: 'var(--text-muted)' }}>
                      ›
                    </span>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div style={{ marginBottom: 'var(--s6)' }}>
          <Empty
            title="No leagues yet"
            action={
              <Link to="/leagues/new" style={{ textDecoration: 'none' }}>
                <Button>Create your first league</Button>
              </Link>
            }
          >
            Create one with your own rules, or join a friend&apos;s with their code.
          </Empty>
        </div>
      )}

      <form onSubmit={submitJoin}>
        <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 var(--s2)' }}>Join with a code</h2>
        <div style={{ display: 'flex', gap: 'var(--s2)' }}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="AB3D5F"
            maxLength={6}
            aria-label="Join code"
            style={{
              flex: 1,
              minHeight: 48,
              padding: '0 var(--s3)',
              fontSize: '16px',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: 'var(--text)',
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
            }}
          />
          <Button type="submit" disabled={code.trim().length !== 6 || join.isPending}>
            {join.isPending ? 'Joining…' : 'Join'}
          </Button>
        </div>
        {error && <ErrorText>{error}</ErrorText>}
      </form>
    </section>
  );
}
