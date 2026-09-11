import { describe, expect, it } from 'vitest';
import { buildFacts, type ContextFacts } from '../facts.js';
import { scorePrediction } from '../evaluate.js';
import { instantiatePreset } from '../presets.js';
import type { RuleSetConfig } from '../dsl.js';

const ctx = (over: Partial<ContextFacts> = {}): ContextFacts => ({
  roundSequence: 1,
  isFinalRound: false,
  stage: 'REGULAR_SEASON',
  isKnockout: false,
  legNumber: null,
  aggregateBefore: null,
  homePosition: 10,
  awayPosition: 11,
  upsetGap: null,
  isDerby: false,
  consensusShare: 0.5,
  userCorrectStreak: 0,
  boosterActive: null,
  fixtureWeight: 1,
  ...over,
});

/** Predicted h-a against actual h-a. */
function score(
  predicted: [number, number] | null,
  actual: [number, number],
  config: RuleSetConfig,
  context: Partial<ContextFacts> = {},
  extras: { scorerIds?: string[]; actualScorers?: string[]; firstScorerId?: string | null } = {},
) {
  const facts = buildFacts({
    predicted: {
      ...(predicted ? { homeGoals: predicted[0], awayGoals: predicted[1] } : {}),
      scorerIds: extras.scorerIds ?? [],
    },
    actual: {
      homeGoals: actual[0],
      awayGoals: actual[1],
      firstScorerId: extras.firstScorerId ?? null,
      scorerIds: extras.actualScorers ?? [],
      redCardShown: false,
      corners: null,
      wentToExtraTime: false,
      wentToPenalties: false,
      qualifierTeamId: null,
    },
    context: ctx(context),
  });
  return scorePrediction(facts, config);
}

const classic = instantiatePreset('classic');

describe('interpreter — group semantics', () => {
  it('pays 5 for an exact score, NOT 5+2', () => {
    // exact_score and correct_outcome share the "result" group, so only the
    // higher fires. If they ever stack this returns 7 and every Classic
    // league in production is quietly wrong.
    const r = score([2, 1], [2, 1], classic);
    expect(r.points).toBe(5);
    const awards = r.breakdown.filter((b) => b.kind === 'award');
    expect(awards.map((a) => a.ruleId)).toContain('exact_score');
    expect(awards.map((a) => a.ruleId)).not.toContain('correct_outcome');
  });

  it('pays 2 for the right result with the wrong score', () => {
    expect(score([1, 0], [3, 0], classic).points).toBe(2);
  });

  it('stacks goal difference on top of the result award', () => {
    // 2-1 predicted, 3-2 actual: right result (+2) and right GD (+1) = 3.
    // goal_difference is group:null so it stacks; the result award does not.
    const r = score([2, 1], [3, 2], classic);
    expect(r.points).toBe(3);
    const ids = r.breakdown.map((b) => b.ruleId);
    expect(ids).toContain('correct_outcome');
    expect(ids).toContain('goal_difference');
  });

  it('never awards goal difference alongside an exact score', () => {
    const r = score([2, 1], [2, 1], classic);
    expect(r.breakdown.map((b) => b.ruleId)).not.toContain('goal_difference');
  });

  it('pays nothing for a wrong result under Classic', () => {
    expect(score([2, 0], [0, 2], classic).points).toBe(0);
  });

  it('pays nothing when no prediction was made', () => {
    const r = score(null, [1, 1], classic);
    expect(r.points).toBe(0);
    expect(r.breakdown).toHaveLength(0);
  });
});

describe('interpreter — multipliers', () => {
  const underdog = instantiatePreset('underdog');

  it('doubles a lone correct call', () => {
    // 2 base points for the result, x2 for being one of few who called it.
    const r = score([0, 1], [0, 1], underdog, { consensusShare: 0.1 });
    expect(r.points).toBe(10); // exact score 5 x2
    expect(r.breakdown.some((b) => b.ruleId === 'lone_wolf')).toBe(true);
  });

  it('does not fire the lone-wolf multiplier at consensus', () => {
    const r = score([0, 1], [0, 1], underdog, { consensusShare: 0.9 });
    expect(r.points).toBe(5);
  });

  it('compounds two multiplying multipliers', () => {
    // Lone wolf x2 and upset x2 = x4 on 5 base points.
    const r = score([0, 1], [0, 1], underdog, { consensusShare: 0.1, upsetGap: 10 });
    expect(r.multiplier).toBe(4);
    expect(r.points).toBe(20);
  });

  it('does NOT fire positional multipliers when upsetGap is null', () => {
    // Knockout rounds have no table, so upsetGap is null. A numeric comparison
    // against null must be false — never a coercion (P4b-07).
    const r = score([0, 1], [0, 1], underdog, { consensusShare: 0.9, upsetGap: null });
    expect(r.breakdown.some((b) => b.ruleId === 'upset')).toBe(false);
    expect(r.points).toBe(5);
  });

  it('applies fixture weight as a contextual multiplier', () => {
    const r = score([2, 1], [2, 1], classic, { fixtureWeight: 2 });
    expect(r.points).toBe(10);
  });

  it('applies a booster multiplier from the config', () => {
    const r = score([2, 1], [2, 1], classic, { boosterActive: 'BANKER' });
    expect(r.points).toBe(10); // BANKER value is 2 in Classic
  });
});

describe('interpreter — negatives and floors', () => {
  const survival = instantiatePreset('survival');

  it('deducts for a wrong result', () => {
    expect(score([2, 0], [0, 1], survival).points).toBeLessThan(0);
  });

  it('honours the per-fixture floor', () => {
    // wrong_result -2 and wildly_off -1 = -3, which is exactly the floor.
    const r = score([5, 0], [0, 5], survival);
    expect(r.basePoints).toBe(-3);
    expect(r.points).toBe(-3);
  });

  it('never falls below minPointsPerFixture even with a multiplier', () => {
    const r = score([5, 0], [0, 5], survival, { fixtureWeight: 3 });
    expect(r.points).toBeGreaterThanOrEqual(survival.minPointsPerFixture);
  });
});

describe('interpreter — goalscorer markets', () => {
  const goalscorer = instantiatePreset('goalscorer');

  it('pays the higher of first vs anytime scorer, not both', () => {
    // Both sit in the "scorer" group: first (5) beats anytime (3).
    const r = score(
      [1, 0],
      [1, 0],
      goalscorer,
      {},
      {
        scorerIds: ['p1'],
        actualScorers: ['p1'],
        firstScorerId: 'p1',
      },
    );
    const ids = r.breakdown.map((b) => b.ruleId);
    expect(ids).toContain('first_scorer');
    expect(ids).not.toContain('anytime_scorer');
    expect(r.points).toBe(4 + 5); // exact score 4 + first scorer 5
  });

  it('pays anytime when the scorer was right but not first', () => {
    const r = score(
      [1, 1],
      [1, 1],
      goalscorer,
      {},
      {
        scorerIds: ['p2'],
        actualScorers: ['p1', 'p2'],
        firstScorerId: 'p1',
      },
    );
    expect(r.breakdown.map((b) => b.ruleId)).toContain('anytime_scorer');
  });
});

describe('interpreter — invariants (§17.2)', () => {
  const presets = ['classic', 'exact_score_heavy', 'underdog', 'survival', 'goalscorer'] as const;

  it('is deterministic across repeated evaluation', () => {
    for (const id of presets) {
      const config = instantiatePreset(id);
      const a = score([2, 1], [3, 1], config, { consensusShare: 0.2 });
      const b = score([2, 1], [3, 1], config, { consensusShare: 0.2 });
      expect(a).toEqual(b);
    }
  });

  it('reconstructs points from basePoints x multiplier for every scoreline', () => {
    // The UI rebuilds the arithmetic from stored fields alone, so this
    // relationship must hold or a breakdown will not add up on screen.
    for (const id of presets) {
      const config = instantiatePreset(id);
      for (let ph = 0; ph <= 4; ph++)
        for (let pa = 0; pa <= 4; pa++)
          for (let ah = 0; ah <= 4; ah++)
            for (let aa = 0; aa <= 4; aa++) {
              const r = score([ph, pa], [ah, aa], config);
              const expected = Math.max(r.basePoints * r.multiplier, config.minPointsPerFixture);
              expect(r.points).toBe(Math.round(expected));
            }
    }
  });

  it('never emits two awards from the same group', () => {
    for (const id of presets) {
      const config = instantiatePreset(id);
      for (let ah = 0; ah <= 3; ah++)
        for (let aa = 0; aa <= 3; aa++) {
          const r = score(
            [1, 1],
            [ah, aa],
            config,
            {},
            {
              scorerIds: ['p1'],
              actualScorers: ['p1'],
              firstScorerId: 'p1',
            },
          );
          const groups = r.breakdown
            .filter((b) => b.kind === 'award' && b.group !== null)
            .map((b) => (b as { group: string }).group);
          expect(new Set(groups).size).toBe(groups.length);
        }
    }
  });

  it('sums the breakdown to exactly basePoints', () => {
    for (const id of presets) {
      const config = instantiatePreset(id);
      const r = score([2, 1], [2, 2], config);
      const sum = r.breakdown
        .filter((b) => b.kind === 'award')
        .reduce((n, b) => n + (b as { points: number }).points, 0);
      expect(sum).toBe(r.basePoints);
    }
  });

  it('produces no floating-point noise in stored points', () => {
    const config = instantiatePreset('classic');
    const r = score([2, 1], [2, 1], config, { fixtureWeight: 1.1 });
    expect(Number.isInteger(r.points * 100)).toBe(true);
  });
});

/**
 * Booster penalty (banker risk).
 *
 * A booster that only ever multiplies is pure upside — nominating your least
 * confident match costs the same as your most confident one, so the "banker"
 * is not a decision. These pin the behaviour that makes it a bet.
 */
describe('booster penalty when a boosted prediction misses', () => {
  const withPenalty = (penalty: number): RuleSetConfig => {
    const c = instantiatePreset('classic');
    c.boosters = [{ type: 'BANKER', value: 2, usesPerSeason: 5, penaltyIfWrong: penalty }];
    return c;
  };

  it('deducts the declared penalty when a banked prediction earns nothing', () => {
    const res = score([3, 0], [0, 2], withPenalty(1), { boosterActive: 'BANKER' });
    expect(res.points).toBe(-1);
  });

  it('applies the penalty EXACTLY, not multiplied by the booster', () => {
    // ⚠️ The trap this guards: expressed as a -1 award the banker's own x2
    // would turn it into -2. The declared number must be the number applied.
    const res = score([3, 0], [0, 2], withPenalty(1), { boosterActive: 'BANKER' });
    expect(res.points).toBe(-1);

    const bigger = score([3, 0], [0, 2], withPenalty(3), { boosterActive: 'BANKER' });
    expect(bigger.points).toBe(-3);
  });

  it('survives minPointsPerFixture, which is 0 in every preset', () => {
    // ⚠️ The other trap: the floor would clamp a negative straight back to 0
    // and the setting would silently do nothing.
    const config = withPenalty(1);
    expect(config.minPointsPerFixture).toBe(0);
    expect(score([3, 0], [0, 2], config, { boosterActive: 'BANKER' }).points).toBe(-1);
  });

  it('does NOT penalise a banked prediction that earned something', () => {
    // Right outcome, wrong scoreline: Classic still pays for the outcome, so
    // this is not a miss even though the exact score was wrong.
    const res = score([2, 0], [1, 0], withPenalty(1), { boosterActive: 'BANKER' });
    expect(res.points).toBeGreaterThan(0);
  });

  it('doubles a correct banked prediction as before', () => {
    const plain = score([2, 1], [2, 1], withPenalty(1));
    const banked = score([2, 1], [2, 1], withPenalty(1), { boosterActive: 'BANKER' });
    expect(banked.points).toBe(plain.points * 2);
  });

  it('leaves rule sets without a penalty exactly as they were', () => {
    expect(score([3, 0], [0, 2], withPenalty(0), { boosterActive: 'BANKER' }).points).toBe(0);
  });

  it('never penalises an unboosted prediction', () => {
    expect(score([3, 0], [0, 2], withPenalty(1)).points).toBe(0);
  });

  it('records the penalty in the breakdown, so a -1 can be explained', () => {
    const res = score([3, 0], [0, 2], withPenalty(1), { boosterActive: 'BANKER' });
    const entry = res.breakdown.find((e) => e.kind === 'penalty');
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({ points: -1 });
  });
});
