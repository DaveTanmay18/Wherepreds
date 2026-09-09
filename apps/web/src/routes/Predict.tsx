import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../lib/api.js';
import {
  clearDraft,
  loadDraft,
  saveDraft,
  useRound,
  useSavePredictions,
  type DraftMap,
  type RoundFixture,
} from '../lib/predictions.js';
import { QuickChips, ScoreStepper } from '../components/ScoreStepper.jsx';
import {
  FixtureBoosterBadge,
  FixtureBoosterButton,
  RoundBoosterBar,
  useBoosterBudget,
  useBoosterMutations,
  useRoundBoosters,
} from '../components/Boosters.jsx';
import { Button, Empty, ErrorText, Loading } from '../components/ui.jsx';

/**
 * The prediction screen (tasks P3-23 to P3-26).
 *
 * The screen everything else exists to serve. One-handed, keyboard-free,
 * autosaving, and honest about time — the countdown is driven by the SERVER
 * clock, because a device that is three minutes fast would otherwise show an
 * input the server will reject (§13.3).
 */
export function PredictRoute() {
  const { slug, sequence: seqParam } = useParams<{ slug: string; sequence: string }>();
  const sequence = Number(seqParam);
  const navigate = useNavigate();
  const { data, isPending, isError } = useRound(slug, sequence);
  const save = useSavePredictions(slug, sequence);
  const budget = useBoosterBudget(slug);
  const placed = useRoundBoosters(slug, sequence);
  const boosters = useBoosterMutations(slug, sequence);

  const [draft, setDraft] = useState<DraftMap>({});
  const [error, setError] = useState<string | null>(null);
  const [rejected, setRejected] = useState<Record<string, string>>({});
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  /** Which fixtures have the note field open. Notes are optional and rarely
      used, so they stay out of the way until asked for. */
  const [openNotes, setOpenNotes] = useState<Record<string, boolean>>({});
  const hydrated = useRef(false);

  const round = data?.round;

  // Server picks first, then any local draft on top — a draft only exists for
  // changes not yet saved, so it should win.
  useEffect(() => {
    if (!round || !slug || hydrated.current) return;
    const fromServer: DraftMap = {};
    for (const f of round.fixtures) {
      const sel = f.prediction?.selections.find((s) => s.market === 'EXACT_SCORE');
      const q = f.prediction?.selections.find((s) => s.market === 'TO_QUALIFY');
      if (sel?.homeGoals != null && sel.awayGoals != null) {
        fromServer[f.leagueFixtureId] = {
          home: sel.homeGoals,
          away: sel.awayGoals,
          ...(q && 'teamId' in q && q.teamId ? { qualifier: q.teamId as string } : {}),
        };
      }
    }
    setDraft({ ...fromServer, ...loadDraft(slug, sequence) });
    setNotes(
      Object.fromEntries(
        round.fixtures
          .filter((f) => f.prediction?.note)
          .map((f) => [f.leagueFixtureId, f.prediction!.note as string]),
      ),
    );
    hydrated.current = true;
  }, [round, slug, sequence]);

  // ── Server-authoritative countdown ──────────────────────────────────
  const [now, setNow] = useState(() => Date.now());
  const skewRef = useRef(0);
  useEffect(() => {
    if (round) skewRef.current = new Date(round.serverTime).getTime() - Date.now();
  }, [round]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const serverNow = now + skewRef.current;

  const isLocked = (f: RoundFixture) => new Date(f.deadlineAt).getTime() <= serverNow;
  const roundLocked = round ? new Date(round.deadlineAt).getTime() <= serverNow : false;

  const setScore = (id: string, home: number, away: number) => {
    setDraft((d) => {
      const next = { ...d, [id]: { home, away } };
      if (slug) saveDraft(slug, sequence, next);
      return next;
    });
    setRejected((r) => {
      const { [id]: _drop, ...rest } = r;
      return rest;
    });
  };

  const setQualifier = (id: string, teamId: string) => {
    setDraft((d) => {
      const cur = d[id] ?? { home: 0, away: 0 };
      // Tapping the same crest again clears it — a knockout pick should be
      // retractable before the deadline like any other.
      const next = {
        ...d,
        [id]: { ...cur, qualifier: cur.qualifier === teamId ? undefined : teamId },
      };
      if (slug) saveDraft(slug, sequence, next);
      return next;
    });
  };

  const picks = useMemo(
    () =>
      Object.entries(draft).map(([leagueFixtureId, v]) => ({
        leagueFixtureId,
        selections: [
          { market: 'EXACT_SCORE', homeGoals: v.home, awayGoals: v.away },
          ...(v.qualifier ? [{ market: 'TO_QUALIFY', teamId: v.qualifier }] : []),
        ],
        ...(notes[leagueFixtureId] ? { note: notes[leagueFixtureId] } : {}),
      })),
    [draft, notes],
  );

  const openFixtures = round?.fixtures.filter((f) => !isLocked(f)) ?? [];
  const filled = openFixtures.filter((f) => draft[f.leagueFixtureId]).length;

  async function submit() {
    setError(null);
    setRejected({});
    try {
      const openIds = new Set(openFixtures.map((f) => f.leagueFixtureId));
      const res = await save.mutateAsync({
        predictions: picks.filter((p) => openIds.has(p.leagueFixtureId)),
        submit: true,
      });

      // Partial success is normal, not exceptional: one kickoff may pass while
      // the rest are still open (§12.2). Report per fixture, keep the rest.
      if (res.rejected.length) {
        setRejected(Object.fromEntries(res.rejected.map((r) => [r.leagueFixtureId, r.detail])));
      }
      if (res.saved.length && slug) {
        clearDraft(slug, sequence);
        setSavedAt(new Date());

        // Submitting is the end of this task, so return to the league — the
        // screen that shows standings and the next deadline. Staying put left
        // people wondering whether anything had happened at all.
        // If some picks were rejected, stay so those rows can be read.
        if (res.rejected.length === 0) {
          navigate(`/leagues/${slug}`, { replace: true });
        }
      }
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.problem.detail ?? e.problem.title)
          : 'Could not reach the server. Your picks are saved on this device.',
      );
    }
  }

  if (isPending) return <Loading />;
  if (isError || !round) return <p>Round not found.</p>;

  if (round.isProvisional) {
    return (
      <Empty title={`${round.round.name} is not drawn yet`}>
        Fixtures appear once the draw is made. The deadline shown is an estimate.
      </Empty>
    );
  }

  return (
    <section style={{ paddingBottom: 96 }}>
      {/* Sticky header: what round, how long left. */}
      <header
        style={{
          position: 'sticky',
          top: 56,
          zIndex: 5,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--s3)',
          padding: 'var(--s3) 0',
          marginBottom: 'var(--s3)',
          background: 'var(--bg)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div>
          <h1 style={{ fontSize: 'var(--text-lg)', margin: 0 }}>{round.round.name}</h1>
          <Link
            to={`/leagues/${slug}`}
            style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}
          >
            Back to league
          </Link>
        </div>
        <Countdown deadlineAt={round.deadlineAt} serverNow={serverNow} locked={roundLocked} />
      </header>

      {error && <ErrorText>{error}</ErrorText>}
      {savedAt && !save.isPending && (
        <p style={{ color: 'var(--positive)', fontSize: 'var(--text-sm)' }}>
          ✓ Saved at {savedAt.toLocaleTimeString()}
        </p>
      )}

      <RoundBoosterBar
        budget={budget.data?.boosters ?? []}
        used={placed.data?.used ?? []}
        disabled={roundLocked}
        onPlace={(type) => boosters.place.mutate({ type })}
        onRevoke={(type) => boosters.revoke.mutate(type)}
      />

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--s2)' }}>
        {round.fixtures.map((f) => {
          const locked = isLocked(f);
          const pick = draft[f.leagueFixtureId] ?? null;
          return (
            <li
              key={f.leagueFixtureId}
              style={{
                // ⚠️ The CARD is capped, not just the grid inside it. Capping
                // only the inner content left a full-width band with a narrow
                // island floating in the middle of it — the card has to be the
                // same size as the thing it contains.
                width: '100%',
                maxWidth: 560,
                margin: '0 auto',
                padding: 'var(--s3)',
                background: 'var(--surface-raised)',
                border: `1px solid ${rejected[f.leagueFixtureId] ? 'var(--negative)' : 'var(--border)'}`,
                borderRadius: 'var(--radius-md)',
              }}
            >
              {/* Context first: when it kicks off, and what booster is on it.
                  This was two separate full-width rows — one at the very
                  bottom of the card, which is the last place you look for the
                  thing that tells you how long you have left. */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 'var(--s2)',
                  marginBottom: 'var(--s2)',
                  minHeight: 24,
                }}
              >
                <span
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: locked ? 'var(--negative)' : 'var(--text-muted)',
                  }}
                >
                  {locked
                    ? f.result
                      ? `Locked · finished ${f.result.home}–${f.result.away}`
                      : 'Locked'
                    : new Date(f.kickoffAt).toLocaleString(undefined, {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                </span>
                {/* Locked: the control is gone, but the marker stays — the
                    banker is most worth seeing once it can no longer move. */}
                {locked ? (
                  <FixtureBoosterBadge
                    used={placed.data?.used ?? []}
                    leagueFixtureId={f.leagueFixtureId}
                  />
                ) : (
                  <FixtureBoosterButton
                    budget={budget.data?.boosters ?? []}
                    used={placed.data?.used ?? []}
                    leagueFixtureId={f.leagueFixtureId}
                    disabled={locked}
                    onPlace={(type, id) => boosters.place.mutate({ type, leagueFixtureId: id })}
                    onRevoke={(type) => boosters.revoke.mutate(type)}
                  />
                )}
              </div>
              {/* ⚠️ Capped and centred. A bare `1fr auto 1fr` grid works at
                  360px but on a 1120px container the 1fr columns balloon and
                  fling the team names to the far edges, leaving the score
                  stranded in the middle with nothing near it. The prediction
                  unit should be the same compact size on every screen —
                  desktop is a widened mobile layout, not a stretched one
                  (§14.3). */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
                  alignItems: 'center',
                  gap: 'var(--s2)',
                  maxWidth: 420,
                  margin: '0 auto',
                }}
              >
                <TeamLabel team={f.homeTeam} align="right" />
                <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center' }}>
                  <ScoreStepper
                    label={f.homeTeam.shortName ?? f.homeTeam.name}
                    value={pick?.home ?? null}
                    disabled={locked}
                    onChange={(v) => setScore(f.leagueFixtureId, v, pick?.away ?? 0)}
                  />
                  {/* Without this, "2 2" does not read as a scoreline. */}
                  <span
                    aria-hidden
                    style={{
                      color: 'var(--text-muted)',
                      fontSize: 'var(--text-lg)',
                      lineHeight: 1,
                    }}
                  >
                    –
                  </span>
                  <ScoreStepper
                    label={f.awayTeam.shortName ?? f.awayTeam.name}
                    value={pick?.away ?? null}
                    disabled={locked}
                    onChange={(v) => setScore(f.leagueFixtureId, pick?.home ?? 0, v)}
                  />
                </div>
                <TeamLabel team={f.awayTeam} align="left" />
              </div>

              {!locked && (
                <div style={{ marginTop: 'var(--s3)' }}>
                  <QuickChips active={pick} onPick={(h, a) => setScore(f.leagueFixtureId, h, a)} />
                </div>
              )}

              {/* Qualifier picker (task P4b-08). Shown only on the DECIDING
                  leg of a tie, and only if the league plays TO_QUALIFY. */}
              {f.isDecidingLeg && round.markets.includes('TO_QUALIFY') && (
                <div style={{ marginTop: 'var(--s3)', textAlign: 'center' }}>
                  <p style={qualifierHint}>Who goes through?</p>
                  <div style={{ display: 'flex', gap: 'var(--s2)', justifyContent: 'center' }}>
                    {[f.homeTeam, f.awayTeam].map((t) => {
                      const chosen = pick?.qualifier === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          disabled={locked}
                          aria-pressed={chosen}
                          onClick={() => setQualifier(f.leagueFixtureId, t.id)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--s2)',
                            minHeight: 44,
                            padding: '0 var(--s3)',
                            background: chosen ? 'var(--accent-weak)' : 'transparent',
                            color: chosen ? 'var(--accent)' : 'var(--text)',
                            border: `1px solid ${chosen ? 'var(--accent)' : 'var(--border)'}`,
                            borderRadius: 999,
                            fontWeight: chosen ? 700 : 400,
                            cursor: locked ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {t.crestUrl && <img src={t.crestUrl} alt="" width={18} height={18} />}
                          {/* shortName, not TLA: two clubs can share a code. */}
                          {t.shortName ?? t.name}
                          {chosen && <span aria-hidden>✓</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Prediction note (task P5-07). Shown to the league only AFTER
                  the deadline, alongside the pick — trash talk is only fun
                  when nobody could have read it in time to react.

                  ⚠️ Collapsed by default. Rendered always-open, a full-width
                  empty text field was the loudest element in the card and drew
                  the eye away from the only thing that scores points. */}
              {!locked &&
                (openNotes[f.leagueFixtureId] || notes[f.leagueFixtureId] ? (
                  <input
                    autoFocus={openNotes[f.leagueFixtureId]}
                    value={notes[f.leagueFixtureId] ?? ''}
                    onChange={(e) =>
                      setNotes((n) => ({ ...n, [f.leagueFixtureId]: e.target.value.slice(0, 280) }))
                    }
                    placeholder="Say something (optional)"
                    aria-label={`Note for ${f.homeTeam.shortName} v ${f.awayTeam.shortName}`}
                    maxLength={280}
                    style={{
                      width: '100%',
                      minHeight: 40,
                      marginTop: 'var(--s3)',
                      padding: '0 var(--s3)',
                      // 16px exactly: anything smaller makes iOS zoom the page
                      // on focus (§14.5).
                      fontSize: '16px',
                      color: 'var(--text)',
                      background: 'var(--bg)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-md)',
                    }}
                  />
                ) : (
                  <div style={{ marginTop: 'var(--s2)', textAlign: 'center' }}>
                    <button
                      type="button"
                      onClick={() => setOpenNotes((o) => ({ ...o, [f.leagueFixtureId]: true }))}
                      style={{
                        minHeight: 32,
                        padding: '0 var(--s2)',
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-muted)',
                        fontSize: 'var(--text-xs)',
                        cursor: 'pointer',
                      }}
                    >
                      + Add a note
                    </button>
                  </div>
                ))}

              {rejected[f.leagueFixtureId] && (
                <p
                  role="alert"
                  style={{
                    margin: 'var(--s1) 0 0',
                    textAlign: 'center',
                    fontSize: 'var(--text-xs)',
                    color: 'var(--negative)',
                  }}
                >
                  Not saved — {rejected[f.leagueFixtureId]}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {/* Sticky CTA: the one primary action on this screen (§14.1). */}
      {!roundLocked && (
        <div
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            padding: 'var(--s3) var(--s4)',
            paddingBottom: 'calc(var(--s3) + env(safe-area-inset-bottom))',
            background: 'var(--surface-raised)',
            borderTop: '1px solid var(--border)',
          }}
        >
          <div style={{ maxWidth: 1120, margin: '0 auto' }}>
            <Button full onClick={() => void submit()} disabled={save.isPending || filled === 0}>
              {save.isPending
                ? 'Saving…'
                : `Submit ${filled} of ${openFixtures.length} prediction${openFixtures.length === 1 ? '' : 's'}`}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function TeamLabel({ team, align }: { team: RoundFixture['homeTeam']; align: 'left' | 'right' }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s2)',
        // ⚠️ flex-end on BOTH sides, which is not a typo. The away label is
        // `row-reverse`, so its main axis runs right-to-left and `flex-start`
        // packs it against the card's OUTER edge — leaving a gap between the
        // stepper and the crest that grew or shrank with the length of the
        // club name, so no two fixtures lined up. `flex-end` packs each label
        // against the score in the middle, so both crests sit a fixed
        // distance from the centre and every row is a mirror of itself.
        justifyContent: 'flex-end',
        flexDirection: align === 'right' ? 'row' : 'row-reverse',
        fontSize: 'var(--text-sm)',
        minWidth: 0,
      }}
    >
      <span
        // ⚠️ shortName first, TLA only as a fallback: Bayern München and
        // Barcelona both use "FCB", so a three-letter code cannot identify a
        // club on its own.
        title={team.name}
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
        }}
      >
        {team.shortName ?? team.tla ?? team.name}
      </span>
      {team.crestUrl && (
        <img
          src={team.crestUrl}
          alt=""
          width={22}
          height={22}
          loading="lazy"
          style={{ flexShrink: 0 }}
        />
      )}
    </div>
  );
}

function Countdown({
  deadlineAt,
  serverNow,
  locked,
}: {
  deadlineAt: string;
  serverNow: number;
  locked: boolean;
}) {
  const ms = new Date(deadlineAt).getTime() - serverNow;

  if (locked) {
    return (
      <span
        style={{
          fontWeight: 700,
          color: 'var(--negative)',
          fontSize: 'var(--text-sm)',
          whiteSpace: 'nowrap',
        }}
      >
        🔒 Locked
      </span>
    );
  }

  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const urgent = ms < 30 * 60_000;

  return (
    <span
      aria-live="polite"
      className="tnum"
      style={{
        fontWeight: 700,
        fontSize: 'var(--text-sm)',
        whiteSpace: 'nowrap',
        color: urgent ? 'var(--live)' : 'var(--accent)',
      }}
    >
      ⏱ {h > 0 ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2, '0')}s`}
    </span>
  );
}

const qualifierHint: React.CSSProperties = {
  margin: '0 0 var(--s2)',
  fontSize: 'var(--text-xs)',
  color: 'var(--text-muted)',
};
