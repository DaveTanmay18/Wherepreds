import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { useCreateLeague, usePresets } from '../lib/leagues.js';
import { Button, Card, ErrorText } from '../components/ui.jsx';

type Competition = {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  country: { name: string } | null;
  confederation: string | null;
  currentSeason: { id: string; label: string } | null;
};

/**
 * League creation wizard (task P2-15).
 *
 * Four steps, ONE decision per screen (§14.1). A single long form with
 * competition, preset, name and visibility together is the obvious build and
 * the wrong one on a phone — the preset choice needs room to be read.
 */
export function LeagueNewRoute() {
  const navigate = useNavigate();
  const create = useCreateLeague();
  const presets = usePresets();

  const competitions = useQuery({
    queryKey: ['competitions'],
    queryFn: () => api.get<{ competitions: Competition[] }>('/competitions'),
    staleTime: 5 * 60_000,
  });

  const [step, setStep] = useState(0);
  const [seasonId, setSeasonId] = useState('');
  const [presetId, setPresetId] = useState('classic');
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState('UNLISTED');
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ slug: string; joinCode: string; rounds: number } | null>(
    null,
  );

  const chosenCompetition = competitions.data?.competitions.find(
    (c) => c.currentSeason?.id === seasonId,
  );

  async function submit() {
    setError(null);
    try {
      const res = await create.mutateAsync({ name: name.trim(), seasonId, presetId, visibility });
      setCreated({ ...res.league, rounds: res.rounds });
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.problem.detail ?? e.problem.title)
          : 'Could not create the league.',
      );
    }
  }

  if (created) {
    return (
      <section style={{ maxWidth: 480 }}>
        <h1 style={{ fontSize: 'var(--text-xl)', margin: '0 0 var(--s2)' }}>{name} is ready</h1>
        <p style={{ color: 'var(--text-muted)', margin: '0 0 var(--s5)' }}>
          {created.rounds} rounds are set up and waiting.
        </p>

        <Card>
          <p
            style={{
              margin: '0 0 var(--s2)',
              fontSize: 'var(--text-sm)',
              color: 'var(--text-muted)',
            }}
          >
            Share this code so friends can join
          </p>
          <p
            className="tnum"
            style={{
              margin: 0,
              fontSize: 'var(--text-2xl)',
              fontWeight: 700,
              letterSpacing: '0.15em',
            }}
          >
            {created.joinCode}
          </p>
        </Card>

        <div style={{ display: 'grid', gap: 'var(--s2)', marginTop: 'var(--s4)' }}>
          <Button full onClick={() => void navigator.clipboard?.writeText(created.joinCode)}>
            Copy code
          </Button>
          <Button full variant="secondary" onClick={() => navigate(`/leagues/${created.slug}`)}>
            Go to league
          </Button>
        </div>
      </section>
    );
  }

  const steps = ['Competition', 'Scoring', 'Details'];

  return (
    <section style={{ maxWidth: 560 }}>
      <h1 style={{ fontSize: 'var(--text-xl)', margin: '0 0 var(--s1)' }}>New league</h1>
      <p
        style={{ color: 'var(--text-muted)', margin: '0 0 var(--s4)', fontSize: 'var(--text-sm)' }}
      >
        Step {step + 1} of 3 · {steps[step]}
      </p>

      {step === 0 && (
        <>
          <div style={{ display: 'grid', gap: 'var(--s2)' }}>
            {competitions.data?.competitions
              .filter((c) => c.currentSeason)
              .map((c) => (
                <Card
                  key={c.id}
                  selected={seasonId === c.currentSeason!.id}
                  onClick={() => setSeasonId(c.currentSeason!.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
                    {c.logoUrl && <img src={c.logoUrl} alt="" width={28} height={28} />}
                    <div>
                      <strong style={{ display: 'block' }}>{c.name}</strong>
                      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                        {c.country?.name ?? c.confederation} · {c.currentSeason!.label}
                      </span>
                    </div>
                  </div>
                </Card>
              ))}
          </div>
          <div style={{ marginTop: 'var(--s4)' }}>
            <Button full disabled={!seasonId} onClick={() => setStep(1)}>
              Continue
            </Button>
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <div style={{ display: 'grid', gap: 'var(--s2)' }}>
            {presets.data?.presets.map((p) => (
              <Card key={p.id} selected={presetId === p.id} onClick={() => setPresetId(p.id)}>
                <strong style={{ display: 'block', marginBottom: 'var(--s1)' }}>{p.name}</strong>
                <p
                  style={{
                    margin: '0 0 var(--s2)',
                    color: 'var(--text-muted)',
                    fontSize: 'var(--text-sm)',
                  }}
                >
                  {p.summary}
                </p>
                <ul style={{ margin: 0, paddingLeft: '1.1em', fontSize: 'var(--text-sm)' }}>
                  {p.highlights.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
          <p
            style={{
              color: 'var(--text-muted)',
              fontSize: 'var(--text-xs)',
              marginTop: 'var(--s3)',
            }}
          >
            You can customise every rule later — this is just a starting point.
          </p>
          <div style={{ display: 'flex', gap: 'var(--s2)', marginTop: 'var(--s3)' }}>
            <Button variant="secondary" onClick={() => setStep(0)}>
              Back
            </Button>
            <Button full onClick={() => setStep(2)}>
              Continue
            </Button>
          </div>
        </>
      )}

      {step === 2 && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label
            htmlFor="lname"
            style={{ display: 'block', fontSize: 'var(--text-sm)', marginBottom: 'var(--s1)' }}
          >
            League name
          </label>
          <input
            id="lname"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="The Sunday League"
            style={{
              width: '100%',
              minHeight: 44,
              padding: '0 var(--s3)',
              fontSize: '16px',
              color: 'var(--text)',
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              marginBottom: 'var(--s4)',
            }}
          />

          <fieldset style={{ border: 'none', padding: 0, margin: '0 0 var(--s4)' }}>
            <legend style={{ fontSize: 'var(--text-sm)', padding: 0, marginBottom: 'var(--s2)' }}>
              Who can join?
            </legend>
            {[
              ['UNLISTED', 'Anyone with the code', 'Recommended'],
              ['PRIVATE', 'Invite only', ''],
              ['PUBLIC', 'Listed publicly', ''],
            ].map(([value, label, hint]) => (
              <label
                key={value}
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', minHeight: 44 }}
              >
                <input
                  type="radio"
                  name="visibility"
                  value={value}
                  checked={visibility === value}
                  onChange={() => setVisibility(value!)}
                />
                <span>{label}</span>
                {hint && (
                  <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
                    {hint}
                  </span>
                )}
              </label>
            ))}
          </fieldset>

          <p
            style={{
              color: 'var(--text-muted)',
              fontSize: 'var(--text-sm)',
              marginBottom: 'var(--s4)',
            }}
          >
            {chosenCompetition?.name} · {presets.data?.presets.find((p) => p.id === presetId)?.name}
          </p>

          {error && <ErrorText>{error}</ErrorText>}

          <div style={{ display: 'flex', gap: 'var(--s2)' }}>
            <Button variant="secondary" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button full type="submit" disabled={name.trim().length < 3 || create.isPending}>
              {create.isPending ? 'Creating…' : 'Create league'}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
