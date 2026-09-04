import { describe, expect, it } from 'vitest';
import corpus from './fixtures/pl-2024-25-results.json' with { type: 'json' };
import { buildFacts, type ContextFacts } from '../facts.js';
import { scorePrediction } from '../evaluate.js';
import { instantiatePreset, PRESET_LIST } from '../presets.js';

/**
 * Golden-file tests (task P3-29, §17.2).
 *
 * Every preset scored against 190 REAL Premier League 2024/25 results. The
 * totals are snapshotted, so any unintended change to the interpreter, a
 * preset, or the fact builder shows up as a diff in a number rather than as a
 * silently different leaderboard three months into a season.
 *
 * Real results matter here: synthetic scorelines cluster unnaturally and would
 * miss the distribution that actually occurs — 1-1 and 2-1 dominate, and heavy
 * wins are rare enough that a rule keyed on goal difference barely fires.
 *
 * If a diff appears, DO NOT re-baseline without reading it. A changed total is
 * either a bug or a deliberate rules change; both deserve a sentence in the
 * commit message.
 */

type Result = {
  id: number;
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
};

const results = corpus as Result[];

/**
 * Deterministic predictions derived from the fixture id — no randomness, so
 * the corpus is stable across machines and runs. Six archetypes covering the
 * ways people actually predict.
 */
const ARCHETYPES = [
  { name: 'home-banker', pick: () => [2, 0] as [number, number] },
  { name: 'score-draw', pick: () => [1, 1] as [number, number] },
  { name: 'narrow-home', pick: () => [2, 1] as [number, number] },
  { name: 'narrow-away', pick: () => [1, 2] as [number, number] },
  { name: 'goalless', pick: () => [0, 0] as [number, number] },
  // Varies with the fixture, so not every match sees identical picks.
  { name: 'rotating', pick: (id: number) => [id % 4, (id >> 2) % 3] as [number, number] },
];

const context: ContextFacts = {
  roundSequence: 1,
  isFinalRound: false,
  stage: 'REGULAR_SEASON',
  isKnockout: false,
  legNumber: null,
  aggregateBefore: null,
  homePosition: null,
  awayPosition: null,
  upsetGap: null,
  isDerby: false,
  consensusShare: 0.5,
  userCorrectStreak: 0,
  boosterActive: null,
  fixtureWeight: 1,
};

function scoreCorpus(presetId: string, archetype: (typeof ARCHETYPES)[number]) {
  const config = instantiatePreset(presetId as Parameters<typeof instantiatePreset>[0]);
  let total = 0;
  let exact = 0;
  let outcomes = 0;
  let negatives = 0;

  for (const m of results) {
    const [ph, pa] = archetype.pick(m.id);
    const facts = buildFacts({
      predicted: { homeGoals: ph, awayGoals: pa, scorerIds: [] },
      actual: {
        homeGoals: m.homeGoals,
        awayGoals: m.awayGoals,
        firstScorerId: null,
        scorerIds: [],
        redCardShown: false,
        corners: null,
        wentToExtraTime: false,
        wentToPenalties: false,
        qualifierTeamId: null,
      },
      context,
    });
    const r = scorePrediction(facts, config);
    total += r.points;
    if (facts.derived.exactScore) exact++;
    if (facts.derived.outcomeCorrect) outcomes++;
    if (r.points < 0) negatives++;
  }

  return { total: Math.round(total * 100) / 100, exact, outcomes, negatives };
}

describe('golden file — 190 real PL 2024/25 results', () => {
  it('has a stable corpus', () => {
    expect(results).toHaveLength(190);
    // Guards against the file being regenerated with different data, which
    // would make every snapshot below meaningless.
    expect(results[0]).toMatchObject({ home: 'MUN', away: 'FUL', homeGoals: 1, awayGoals: 0 });
  });

  for (const preset of PRESET_LIST) {
    describe(preset.name, () => {
      for (const archetype of ARCHETYPES) {
        it(`scores "${archetype.name}" consistently`, () => {
          expect(scoreCorpus(preset.id, archetype)).toMatchSnapshot();
        });
      }
    });
  }
});

describe('golden file — cross-preset sanity', () => {
  it('Exact Score Heavy pays more than Classic for perfect calls', () => {
    // Same picks, same results: the preset weighted towards exact scores must
    // reward an accurate predictor more. If this ever inverts, a preset has
    // been edited into something it does not claim to be.
    const a = scoreCorpus('classic', ARCHETYPES[2]!);
    const b = scoreCorpus('exact_score_heavy', ARCHETYPES[2]!);
    expect(b.exact).toBe(a.exact);
    expect(b.total).toBeGreaterThan(a.total);
  });

  it('Survival is the only preset that can go negative', () => {
    for (const preset of PRESET_LIST) {
      const worst = scoreCorpus(preset.id, ARCHETYPES[4]!); // 0-0 every match
      if (preset.id === 'survival') expect(worst.negatives).toBeGreaterThan(0);
      else expect(worst.negatives).toBe(0);
    }
  });

  it('every preset agrees on which predictions were exactly right', () => {
    // The interpreter varies the POINTS, never the facts. A disagreement here
    // would mean a preset is influencing fact derivation, which it must not.
    const counts = PRESET_LIST.map((p) => scoreCorpus(p.id, ARCHETYPES[1]!).exact);
    expect(new Set(counts).size).toBe(1);
  });

  it('a real-world hit rate lands in a plausible band', () => {
    // 1-1 is the single most common PL scoreline. Predicting it every week
    // should hit somewhere in the low tens out of 190 — if this drifts far,
    // either the corpus or exact-score detection has changed.
    const r = scoreCorpus('classic', ARCHETYPES[1]!);
    expect(r.exact).toBeGreaterThan(10);
    expect(r.exact).toBeLessThan(40);
  });
});
