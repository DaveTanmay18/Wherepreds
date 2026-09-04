import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../lib/api.js';
import {
  describeCondition,
  TIEBREAKER_LABELS,
  useRules,
  useSaveRules,
  useSimulate,
  type Issue,
  type RuleConfig,
} from '../lib/rules.js';
import { Button, Card, ErrorText, Loading } from '../components/ui.jsx';
import {
  blankAward,
  ConditionBuilder,
  MarketToggles,
  type FactOption,
} from '../components/RuleControls.jsx';

/**
 * The rule editor (tasks P4-08 to P4-15).
 *
 * Progressive disclosure: the scoring list reads as plain sentences, and the
 * live preview sits beside it so an admin sees what a change is worth before
 * committing (§14.1). Raw JSON is deliberately absent from the primary UI —
 * this is the highest clutter risk in the product.
 */
export function RulesEditorRoute() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { data, isPending } = useRules(slug);
  const simulate = useSimulate(slug);
  const save = useSaveRules(slug);

  const [config, setConfig] = useState<RuleConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{
    version: number;
    newVersion: boolean;
    from: number | null;
  } | null>(null);

  const rules = data?.rules;
  const readOnly = !rules;
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (rules && !settings) {
      setSettings({
        deadlineStrategy: rules.deadlineStrategy,
        deadlineOffsetMin: rules.deadlineOffsetMin,
        allowEdits: rules.allowEdits,
        revealPicksBeforeDeadline: rules.revealPicksBeforeDeadline,
        missedPredictionPoints: rules.missedPredictionPoints,
        knockoutScoreBasis: rules.knockoutScoreBasis,
        voidPostponedFixtures: rules.voidPostponedFixtures,
      });
    }
  }, [rules, settings]);

  useEffect(() => {
    if (rules && !config) setConfig(structuredClone(rules.config));
  }, [rules, config]);

  // Debounced preview — a request per keystroke would hammer the API and the
  // numbers would flicker while typing.
  const serialised = useMemo(() => JSON.stringify(config), [config]);
  /**
   * Debounced live preview, keyed on the SERIALISED config.
   *
   * ⚠️ `simulate` must NOT be a dependency. useMutation returns a fresh object
   * every render, so including it makes the effect re-run on every render —
   * including the re-renders the mutation itself causes — which is an infinite
   * request loop, not a debounce. The mutate function is stashed in a ref so
   * the effect depends only on the thing that actually changed.
   */
  const mutateRef = useRef(simulate.mutate);
  mutateRef.current = simulate.mutate;

  useEffect(() => {
    if (!serialised) return;
    const parsed = JSON.parse(serialised) as RuleConfig;
    const t = setTimeout(() => mutateRef.current(parsed), 400);
    return () => clearTimeout(t);
  }, [serialised]);

  if (isPending) return <Loading />;
  if (!rules || !config) return <p>No rules found.</p>;

  const setAwardPoints = (id: string, points: number) =>
    setConfig((c) =>
      c ? { ...c, awards: c.awards.map((a) => (a.id === id ? { ...a, points } : a)) } : c,
    );

  const setMultiplierFactor = (id: string, factor: number) =>
    setConfig((c) =>
      c ? { ...c, multipliers: c.multipliers.map((m) => (m.id === id ? { ...m, factor } : m)) } : c,
    );

  const moveTiebreaker = (i: number, dir: -1 | 1) =>
    setConfig((c) => {
      if (!c) return c;
      const next = [...c.tiebreakers];
      const j = i + dir;
      if (j < 0 || j >= next.length) return c;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return { ...c, tiebreakers: next };
    });

  async function onSave() {
    setError(null);
    setSaved(null);
    try {
      const res = await save.mutateAsync({ config: config!, ...(settings ?? {}) });
      setSaved({ version: res.version, newVersion: res.newVersion, from: res.appliesFromRound });

      // Saving is the end of this task, so go back to the league. The banner
      // is left on screen briefly first — a new VERSION is a consequential
      // outcome ('applies from round N') and deserves to be read before the
      // screen changes under the reader.
      setTimeout(() => navigate(`/leagues/${slug}`), res.newVersion ? 1800 : 700);
    } catch (e) {
      setError(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not save.');
    }
  }

  // Only facts the SELECTED markets expose — see ConditionBuilder for why.
  const availableFacts: FactOption[] = (data?.factOptions ?? []).filter(
    (f) => f.markets.length === 0 || f.markets.some((m) => config.markets.includes(m)),
  );

  const sim = simulate.data;

  return (
    <section style={{ paddingBottom: 96 }}>
      <header style={{ marginBottom: 'var(--s4)' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', margin: 0 }}>Scoring rules</h1>
        <Link
          to={`/leagues/${slug}`}
          style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}
        >
          Back to league
        </Link>
      </header>

      {/* The immutability guarantee, stated before anyone edits (§8.7). */}
      {rules.isFrozen && (
        <p
          style={{
            margin: '0 0 var(--s3)',
            padding: 'var(--s3)',
            background: 'var(--accent-weak)',
            color: 'var(--accent)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--text-sm)',
          }}
        >
          Version {rules.version} has already scored a round. Saving creates version{' '}
          {rules.version + 1}, which applies to upcoming rounds only — past results never change.
        </p>
      )}

      {saved && (
        <p
          role="status"
          style={{
            margin: '0 0 var(--s3)',
            padding: 'var(--s3)',
            background: 'var(--accent-weak)',
            color: 'var(--positive)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--text-sm)',
          }}
        >
          ✓ Saved as version {saved.version}
          {saved.newVersion && saved.from ? ` — applies from round ${saved.from}` : ''}
        </p>
      )}

      {error && <ErrorText>{error}</ErrorText>}

      <div
        style={{
          display: 'grid',
          gap: 'var(--s3)',
          gridTemplateColumns: 'minmax(0, 1fr)',
        }}
      >
        {/* ── Markets (task P4-09) ───────────────────────────────────── */}
        <Card>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 var(--s1)' }}>Markets</h2>
          <MarketToggles
            markets={config.markets}
            options={data?.availableMarkets ?? []}
            onChange={(markets) => setConfig((c) => (c ? { ...c, markets } : c))}
          />
        </Card>

        {/* ── Awards ─────────────────────────────────────────────────── */}
        <Card>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 var(--s1)' }}>Points</h2>
          <p
            style={{
              margin: '0 0 var(--s3)',
              color: 'var(--text-muted)',
              fontSize: 'var(--text-sm)',
            }}
          >
            Rules sharing a group are exclusive — only the highest one pays.
          </p>

          {config.awards.map((a) => (
            <div
              key={a.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--s3)',
                padding: 'var(--s2) 0',
                borderTop: '1px solid var(--border)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{a.label}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
                  when {describeCondition(a.when)}
                  {a.group ? ` · group: ${a.group}` : ' · stacks'}
                </div>
              </div>
              <input
                type="number"
                aria-label={`Points for ${a.label}`}
                value={a.points}
                min={-50}
                max={200}
                onChange={(e) => setAwardPoints(a.id, Number(e.target.value))}
                className="tnum"
                style={numberInput}
              />
              <button
                aria-label={`Remove ${a.label}`}
                onClick={() =>
                  setConfig((c) =>
                    c ? { ...c, awards: c.awards.filter((x) => x.id !== a.id) } : c,
                  )
                }
                style={{ ...iconBtn, color: 'var(--negative)' }}
              >
                x
              </button>
            </div>
          ))}

          {/* Condition builder (task P4-11), behind a disclosure so the common
              case — just change the points — stays a one-tap edit (§14.1). */}
          <details style={{ marginTop: 'var(--s3)' }}>
            <summary style={{ cursor: 'pointer', minHeight: 44, fontSize: 'var(--text-sm)' }}>
              Customise when rules apply
            </summary>
            <div style={{ display: 'grid', gap: 'var(--s4)', marginTop: 'var(--s3)' }}>
              {config.awards.map((a) => (
                <div key={a.id}>
                  <input
                    value={a.label}
                    aria-label={`Name for ${a.id}`}
                    onChange={(e) =>
                      setConfig((c) =>
                        c
                          ? {
                              ...c,
                              awards: c.awards.map((x) =>
                                x.id === a.id ? { ...x, label: e.target.value } : x,
                              ),
                            }
                          : c,
                      )
                    }
                    style={{
                      ...numberInput,
                      width: '100%',
                      textAlign: 'left',
                      marginBottom: 'var(--s2)',
                    }}
                  />
                  <ConditionBuilder
                    condition={a.when}
                    facts={availableFacts}
                    onChange={(when) =>
                      setConfig((c) =>
                        c
                          ? {
                              ...c,
                              awards: c.awards.map((x) => (x.id === a.id ? { ...x, when } : x)),
                            }
                          : c,
                      )
                    }
                  />
                </div>
              ))}
              <Button
                variant="secondary"
                onClick={() =>
                  setConfig((c) =>
                    c ? { ...c, awards: [...c.awards, blankAward(c, availableFacts)] } : c,
                  )
                }
              >
                Add a rule
              </Button>
            </div>
          </details>
        </Card>

        {/* ── Multipliers ────────────────────────────────────────────── */}
        {config.multipliers.length > 0 && (
          <Card>
            <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 var(--s3)' }}>Multipliers</h2>
            {config.multipliers.map((m) => (
              <div
                key={m.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--s3)',
                  padding: 'var(--s2) 0',
                  borderTop: '1px solid var(--border)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{m.label}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
                    when {describeCondition(m.when)}
                  </div>
                </div>
                <input
                  type="number"
                  aria-label={`Factor for ${m.label}`}
                  value={m.factor}
                  min={0}
                  max={10}
                  step={0.5}
                  onChange={(e) => setMultiplierFactor(m.id, Number(e.target.value))}
                  className="tnum"
                  style={numberInput}
                />
              </div>
            ))}
          </Card>
        )}

        {/* ── Tiebreakers (task P4-15) ───────────────────────────────── */}
        <Card>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 var(--s1)' }}>Tiebreakers</h2>
          <p
            style={{
              margin: '0 0 var(--s3)',
              color: 'var(--text-muted)',
              fontSize: 'var(--text-sm)',
            }}
          >
            Applied in order when members are level.
          </p>
          {config.tiebreakers.map((t, i) => (
            <div
              key={t}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--s2)',
                padding: 'var(--s1) 0',
                borderTop: '1px solid var(--border)',
              }}
            >
              <span className="tnum" style={{ color: 'var(--text-muted)', width: 20 }}>
                {i + 1}
              </span>
              <span style={{ flex: 1 }}>{TIEBREAKER_LABELS[t] ?? t}</span>
              <button
                aria-label={`Move ${t} up`}
                onClick={() => moveTiebreaker(i, -1)}
                style={iconBtn}
              >
                ↑
              </button>
              <button
                aria-label={`Move ${t} down`}
                onClick={() => moveTiebreaker(i, 1)}
                style={iconBtn}
              >
                ↓
              </button>
            </div>
          ))}
        </Card>

        {/* ── Deadlines (task P4-13) ─────────────────────────────────── */}
        <Card>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 var(--s3)' }}>Deadlines</h2>

          <label style={settingRow}>
            <span style={{ flex: 1 }}>When do predictions lock?</span>
            <select
              value={String(settings?.deadlineStrategy ?? 'ROUND_FIRST_KICKOFF')}
              onChange={(e) => setSettings((v) => ({ ...v, deadlineStrategy: e.target.value }))}
              style={{ ...numberInput, width: 'auto', textAlign: 'left' }}
            >
              <option value="ROUND_FIRST_KICKOFF">At the first kickoff of the round</option>
              <option value="PER_FIXTURE_KICKOFF">At each match own kickoff</option>
            </select>
          </label>

          <label style={settingRow}>
            <span style={{ flex: 1 }}>
              Minutes before that
              <span style={hint}>Negative allows picks slightly after kickoff.</span>
            </span>
            <input
              type="number"
              value={Number(settings?.deadlineOffsetMin ?? 0)}
              min={-180}
              max={10080}
              onChange={(e) =>
                setSettings((v) => ({ ...v, deadlineOffsetMin: Number(e.target.value) }))
              }
              className="tnum"
              style={numberInput}
            />
          </label>

          <label style={settingRow}>
            <span style={{ flex: 1 }}>Allow editing before the deadline</span>
            <input
              type="checkbox"
              checked={Boolean(settings?.allowEdits ?? true)}
              onChange={(e) => setSettings((v) => ({ ...v, allowEdits: e.target.checked }))}
            />
          </label>

          <label style={settingRow}>
            <span style={{ flex: 1 }}>
              Show everyone picks before the deadline
              <span style={hint}>Off means picks stay hidden until predictions close.</span>
            </span>
            <input
              type="checkbox"
              checked={Boolean(settings?.revealPicksBeforeDeadline ?? false)}
              onChange={(e) =>
                setSettings((v) => ({ ...v, revealPicksBeforeDeadline: e.target.checked }))
              }
            />
          </label>

          <label style={settingRow}>
            <span style={{ flex: 1 }}>Points for a missed prediction</span>
            <input
              type="number"
              value={Number(settings?.missedPredictionPoints ?? 0)}
              min={-50}
              max={0}
              onChange={(e) =>
                setSettings((v) => ({ ...v, missedPredictionPoints: Number(e.target.value) }))
              }
              className="tnum"
              style={numberInput}
            />
          </label>

          <label style={settingRow}>
            <span style={{ flex: 1 }}>
              Knockout scoring
              <span style={hint}>What the score means when a match runs past 90 minutes.</span>
            </span>
            <select
              value={String(settings?.knockoutScoreBasis ?? 'NINETY_MINUTES')}
              onChange={(e) => setSettings((v) => ({ ...v, knockoutScoreBasis: e.target.value }))}
              style={{ ...numberInput, width: 'auto', textAlign: 'left' }}
            >
              <option value="NINETY_MINUTES">90 minutes only</option>
              <option value="AFTER_EXTRA_TIME">After extra time</option>
              <option value="INCLUDING_PENALTIES">Penalties decide the result</option>
            </select>
          </label>
        </Card>

        {/* ── Boosters (task P4-13) ──────────────────────────────────── */}
        <Card>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 var(--s3)' }}>Boosters</h2>
          {config.boosters.length === 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', margin: 0 }}>
              This league has no boosters.
            </p>
          )}
          {config.boosters.map((b, i) => (
            <div key={b.type} style={settingRow}>
              <span style={{ flex: 1 }}>{BOOSTER_LABELS[b.type] ?? b.type}</span>
              <input
                type="number"
                aria-label={`Uses per season for ${b.type}`}
                value={b.usesPerSeason}
                min={0}
                max={38}
                onChange={(e) =>
                  setConfig((c) =>
                    c
                      ? {
                          ...c,
                          boosters: c.boosters.map((x, j) =>
                            j === i ? { ...x, usesPerSeason: Number(e.target.value) } : x,
                          ),
                        }
                      : c,
                  )
                }
                className="tnum"
                style={numberInput}
              />
            </div>
          ))}
        </Card>

        {/* ── Live preview (task P4-14) ──────────────────────────────── */}
        <Card>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 var(--s1)' }}>Preview</h2>
          <p
            style={{
              margin: '0 0 var(--s3)',
              color: 'var(--text-muted)',
              fontSize: 'var(--text-sm)',
            }}
          >
            What these rules pay, updated as you edit.
          </p>

          {sim?.errors?.length ? (
            <ul
              style={{
                margin: 0,
                paddingLeft: '1.1em',
                color: 'var(--negative)',
                fontSize: 'var(--text-sm)',
              }}
            >
              {sim.errors.map((e: Issue, i) => (
                <li key={i}>{e.detail}</li>
              ))}
            </ul>
          ) : (
            <table
              style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}
            >
              <tbody>
                {(sim?.results ?? []).map((r) => (
                  <tr key={r.label} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: 'var(--s2) 0' }}>
                      {r.label}
                      <span className="tnum" style={{ color: 'var(--text-muted)' }}>
                        {' '}
                        ({r.predicted} on {r.actual})
                      </span>
                    </td>
                    <td
                      className="tnum"
                      style={{
                        padding: 'var(--s2) 0',
                        textAlign: 'right',
                        fontWeight: 700,
                        color:
                          r.points > 0
                            ? 'var(--positive)'
                            : r.points < 0
                              ? 'var(--negative)'
                              : 'var(--text-muted)',
                      }}
                    >
                      {r.points > 0 ? `+${r.points}` : r.points}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {sim?.warnings?.map((w: Issue, i) => (
            <p
              key={i}
              style={{
                marginTop: 'var(--s2)',
                color: 'var(--warning)',
                fontSize: 'var(--text-xs)',
              }}
            >
              ⚠ {w.detail}
            </p>
          ))}
        </Card>
      </div>

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
          <Button full onClick={() => void onSave()} disabled={save.isPending || readOnly}>
            {save.isPending
              ? 'Saving…'
              : rules.isFrozen
                ? `Save as version ${rules.version + 1}`
                : 'Save rules'}
          </Button>
        </div>
      </div>
    </section>
  );
}

const BOOSTER_LABELS: Record<string, string> = {
  DOUBLE_POINTS: 'Double points on one match',
  TRIPLE_POINTS: 'Triple points on one match',
  BANKER: 'Banker (nominate a match)',
  INSURANCE: 'Insurance (floor a bad round)',
  WILDCARD_ROUND: 'Wildcard round',
  NO_NEGATIVES: 'No negatives for a round',
};

const settingRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--s3)',
  minHeight: 52,
  padding: 'var(--s2) 0',
  borderTop: '1px solid var(--border)',
};

const hint: React.CSSProperties = {
  display: 'block',
  color: 'var(--text-muted)',
  fontSize: 'var(--text-xs)',
};

const numberInput: React.CSSProperties = {
  width: 72,
  minHeight: 44,
  padding: '0 var(--s2)',
  fontSize: '16px',
  textAlign: 'right',
  color: 'var(--text)',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
};

const iconBtn: React.CSSProperties = {
  width: 44,
  height: 44,
  background: 'transparent',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
};
