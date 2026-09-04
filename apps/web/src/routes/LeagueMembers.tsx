import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { useLeague, useMembers } from '../lib/leagues.js';
import { Button, Card, ErrorText, RoleBadge, Loading } from '../components/ui.jsx';

/** Members list and invite sharing (task P2-17). */
export function LeagueMembersRoute() {
  const { slug } = useParams<{ slug: string }>();
  const league = useLeague(slug);
  const { data, isPending } = useMembers(slug);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const role = league.data?.league.viewer.role;
  const isAdmin = role === 'OWNER' || role === 'ADMIN';

  async function createInvite() {
    setError(null);
    try {
      const res = await api.post<{ token: string; path: string }>(`/leagues/${slug}/invites`, {
        maxUses: 20,
        expiresInDays: 14,
      });
      const url = `${window.location.origin}/join/${res.token}`;
      setInviteUrl(url);

      // Native share sheet on mobile — that is how a link actually reaches a
      // group chat. Clipboard is the desktop fallback.
      if (navigator.share) {
        await navigator.share({ title: 'Join my league', url }).catch(() => undefined);
      } else {
        await navigator.clipboard?.writeText(url);
      }
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.problem.detail ?? e.problem.title)
          : 'Could not create an invite.',
      );
    }
  }

  return (
    <section>
      <h1 style={{ fontSize: 'var(--text-xl)', margin: '0 0 var(--s4)' }}>Members</h1>

      {isPending ? (
        <Loading inline />
      ) : (
        <ul
          style={{
            listStyle: 'none',
            margin: '0 0 var(--s5)',
            padding: 0,
            display: 'grid',
            gap: 'var(--s2)',
          }}
        >
          {data?.members.map((m) => (
            <li key={m.userId}>
              <Card>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
                  <div
                    aria-hidden
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 999,
                      background: 'var(--accent-weak)',
                      color: 'var(--accent)',
                      display: 'grid',
                      placeItems: 'center',
                      fontWeight: 700,
                    }}
                  >
                    {m.displayName.slice(0, 1).toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
                      <strong>{m.displayName}</strong>
                      <RoleBadge role={m.role} />
                    </div>
                    <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                      @{m.username}
                    </span>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {isAdmin && (
        <>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 var(--s2)' }}>Invite</h2>
          <Button full onClick={() => void createInvite()}>
            Create a share link
          </Button>
          {inviteUrl && (
            <p
              style={{
                marginTop: 'var(--s2)',
                fontSize: 'var(--text-sm)',
                color: 'var(--text-muted)',
                wordBreak: 'break-all',
              }}
            >
              {inviteUrl}
            </p>
          )}
          {error && <ErrorText>{error}</ErrorText>}
        </>
      )}
    </section>
  );
}
