import { describe, expect, it } from 'vitest';
import { KnockoutScoreBasis } from '@wp/db';
import { buildFacts, scorePrediction, instantiatePreset, type ContextFacts } from '@wp/scoring';
import { isDecidingLeg, resolveKnockoutScore } from '../jobs/knockout.js';

/**
 * Knockout scoring (task P4b-11).
 *
 * Pure — no database. The three score bases are where a league's intent is
 * easiest to get subtly wrong, and where getting it wrong produces a
 * plausible-looking but incorrect leaderboard on the biggest nights of the
 * season.
 */

/** Liverpool 0-1 PSG after 90, PSG win 4-1 on penalties (2024/25 R16). */
const REAL_SHOOTOUT = {
  homeGoals: 0,
  awayGoals: 1,
  homeGoalsEt: 0,
  awayGoalsEt: 0,
  homePenalties: 1,
  awayPenalties: 4,
};

/** Inter 3-3 Barcelona after 90, 4-3 after extra time (2024/25 SF). */
const REAL_EXTRA_TIME = {
  homeGoals: 3,
  awayGoals: 3,
  homeGoalsEt: 1,
  awayGoalsEt: 0,
  homePenalties: null,
  awayPenalties: null,
};

/** A level 90 that went to penalties — the case where the bases diverge. */
const LEVEL_SHOOTOUT = {
  homeGoals: 1,
  awayGoals: 1,
  homeGoalsEt: 0,
  awayGoalsEt: 0,
  homePenalties: 5,
  awayPenalties: 3,
};

describe('score basis resolution', () => {
  it('NINETY_MINUTES ignores extra time and penalties', () => {
    const r = resolveKnockoutScore(REAL_EXTRA_TIME, KnockoutScoreBasis.NINETY_MINUTES);
    expect([r.homeGoals, r.awayGoals]).toEqual([3, 3]);
    expect(r.wentToExtraTime).toBe(true);
  });

  it('AFTER_EXTRA_TIME adds extra-time goals', () => {
    const r = resolveKnockoutScore(REAL_EXTRA_TIME, KnockoutScoreBasis.AFTER_EXTRA_TIME);
    expect([r.homeGoals, r.awayGoals]).toEqual([4, 3]);
  });

  it('never reports the provider fullTime, which sums everything', () => {
    // fullTime for Liverpool v PSG was 1-5 — a scoreline that never happened
    // (§11.1). No basis may ever produce it.
    for (const basis of Object.values(KnockoutScoreBasis)) {
      const r = resolveKnockoutScore(REAL_SHOOTOUT, basis);
      expect([r.homeGoals, r.awayGoals]).not.toEqual([1, 5]);
    }
  });

  it('INCLUDING_PENALTIES lets the shootout decide a LEVEL match', () => {
    const r = resolveKnockoutScore(LEVEL_SHOOTOUT, KnockoutScoreBasis.INCLUDING_PENALTIES);
    // Home won the shootout, so the outcome must read as a home win…
    expect(r.homeGoals).toBeGreaterThan(r.awayGoals);
    // …but the scoreline stays honest: 1-1 became 2-1, not 6-4.
    expect(r.homeGoals).toBe(2);
    expect(r.awayGoals).toBe(1);
  });

  it('INCLUDING_PENALTIES leaves an already-decided 90 alone', () => {
    // PSG won 0-1 in normal time AND on penalties. There is nothing to flip,
    // so the score must not be nudged.
    const r = resolveKnockoutScore(REAL_SHOOTOUT, KnockoutScoreBasis.INCLUDING_PENALTIES);
    expect([r.homeGoals, r.awayGoals]).toEqual([0, 1]);
  });

  it('flags extra time and penalties as facts regardless of basis', () => {
    const r = resolveKnockoutScore(LEVEL_SHOOTOUT, KnockoutScoreBasis.NINETY_MINUTES);
    expect(r.wentToPenalties).toBe(true);
    expect(r.wentToExtraTime).toBe(false);
  });
});

describe('deciding leg', () => {
  it('is leg 2 of a two-legged tie', () => {
    expect(isDecidingLeg(1, true)).toBe(false);
    expect(isDecidingLeg(2, true)).toBe(true);
  });

  it('is the only fixture of a one-off final', () => {
    expect(isDecidingLeg(1, false)).toBe(true);
    expect(isDecidingLeg(null, false)).toBe(true);
  });
});

describe('the same prediction scored under each basis', () => {
  const classic = instantiatePreset('classic');

  const ctx = (over: Partial<ContextFacts> = {}): ContextFacts => ({
    roundSequence: 1,
    isFinalRound: false,
    stage: 'ROUND_OF_16',
    isKnockout: true,
    legNumber: 2,
    aggregateBefore: null,
    homePosition: null,
    awayPosition: null,
    upsetGap: null,
    isDerby: false,
    consensusShare: 0.5,
    userCorrectStreak: 0,
    boosterActive: null,
    fixtureWeight: 1,
    ...over,
  });

  function score(predicted: [number, number], basis: KnockoutScoreBasis) {
    const r = resolveKnockoutScore(LEVEL_SHOOTOUT, basis);
    const facts = buildFacts({
      predicted: { homeGoals: predicted[0], awayGoals: predicted[1], scorerIds: [] },
      actual: {
        homeGoals: r.homeGoals,
        awayGoals: r.awayGoals,
        firstScorerId: null,
        scorerIds: [],
        redCardShown: false,
        corners: null,
        wentToExtraTime: r.wentToExtraTime,
        wentToPenalties: r.wentToPenalties,
        qualifierTeamId: null,
      },
      context: ctx(),
    });
    return scorePrediction(facts, classic);
  }

  it('pays a 1-1 prediction under NINETY_MINUTES but not under penalties', () => {
    // The match finished 1-1 and was decided on spot kicks. A league playing
    // "90 minutes only" rewards the draw; one playing "penalties decide" does
    // not. Both are legitimate — which is exactly why it is configurable.
    expect(score([1, 1], KnockoutScoreBasis.NINETY_MINUTES).points).toBe(5);
    expect(score([1, 1], KnockoutScoreBasis.INCLUDING_PENALTIES).points).toBe(0);
  });

  it('pays a home-win prediction under penalties but not under 90 minutes', () => {
    expect(score([2, 1], KnockoutScoreBasis.INCLUDING_PENALTIES).points).toBe(5);
    expect(score([2, 1], KnockoutScoreBasis.NINETY_MINUTES).points).toBe(0);
  });

  it('AFTER_EXTRA_TIME matches 90 minutes when no ET goals were scored', () => {
    const a = score([1, 1], KnockoutScoreBasis.NINETY_MINUTES);
    const b = score([1, 1], KnockoutScoreBasis.AFTER_EXTRA_TIME);
    expect(b.points).toBe(a.points);
  });
});

describe('TO_QUALIFY facts', () => {
  const ctx: ContextFacts = {
    roundSequence: 1,
    isFinalRound: false,
    stage: 'ROUND_OF_16',
    isKnockout: true,
    legNumber: 2,
    aggregateBefore: { teamA: 1, teamB: 1 },
    homePosition: null,
    awayPosition: null,
    upsetGap: null,
    isDerby: false,
    consensusShare: 0.5,
    userCorrectStreak: 0,
    boosterActive: null,
    fixtureWeight: 1,
  };

  const facts = (picked: string | undefined, actual: string | null) =>
    buildFacts({
      predicted: {
        homeGoals: 1,
        awayGoals: 1,
        scorerIds: [],
        ...(picked ? { qualifierTeamId: picked } : {}),
      },
      actual: {
        homeGoals: 1,
        awayGoals: 1,
        firstScorerId: null,
        scorerIds: [],
        redCardShown: false,
        corners: null,
        wentToExtraTime: false,
        wentToPenalties: true,
        qualifierTeamId: actual,
      },
      context: ctx,
    });

  it('is correct when the pick matches who went through', () => {
    expect(facts('team-a', 'team-a').derived.qualifierCorrect).toBe(true);
  });

  it('is wrong when the pick does not match', () => {
    expect(facts('team-b', 'team-a').derived.qualifierCorrect).toBe(false);
  });

  it('is FALSE — not a crash — on a leg where no qualifier exists yet', () => {
    // Leg 1 has no settled tie, so qualifierTeamId is null. A pick must simply
    // not score rather than blowing up the whole round (task P4b-06).
    expect(facts('team-a', null).derived.qualifierCorrect).toBe(false);
  });

  it('is false when no qualifier was picked at all', () => {
    expect(facts(undefined, 'team-a').derived.qualifierCorrect).toBe(false);
  });
});
