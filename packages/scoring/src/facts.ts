import type { FactPath } from './dsl.js';

/**
 * The fact object (architecture.md §8.2).
 *
 * Everything a rule can read is computed ONCE, here, before any rule runs.
 * Rules only ever compare facts — they never compute. That is what keeps
 * evaluation deterministic, cheap, and free of ordering effects.
 */

export type Outcome = 'HOME' | 'DRAW' | 'AWAY';

export type PredictedFacts = {
  homeGoals?: number;
  awayGoals?: number;
  outcome?: Outcome;
  goalDifference?: number;
  totalGoals?: number;
  btts?: boolean;
  scorerIds: string[];
  qualifierTeamId?: string;
};

export type ActualFacts = {
  /** 90-minute score, resolved per knockoutScoreBasis BEFORE rules run. */
  homeGoals: number;
  awayGoals: number;
  outcome: Outcome;
  goalDifference: number;
  totalGoals: number;
  btts: boolean;
  firstScorerId: string | null;
  scorerIds: string[];
  redCardShown: boolean;
  /** Null without the Statistic add-on (§11.5). A rule reading it never fires. */
  corners: number | null;
  wentToExtraTime: boolean;
  wentToPenalties: boolean;
  /** Null outside knockouts, and on leg 1 where the tie is unsettled. */
  qualifierTeamId: string | null;
};

export type DerivedFacts = {
  exactScore: boolean;
  outcomeCorrect: boolean;
  goalDifferenceCorrect: boolean;
  homeGoalsCorrect: boolean;
  awayGoalsCorrect: boolean;
  totalGoalsCorrect: boolean;
  bttsCorrect: boolean;
  absoluteGoalError: number;
  scorelineDistance: number;
  firstScorerCorrect: boolean;
  anytimeScorerHits: number;
  qualifierCorrect: boolean;
};

export type ContextFacts = {
  roundSequence: number;
  isFinalRound: boolean;
  stage: string;
  isKnockout: boolean;
  legNumber: number | null;
  aggregateBefore: { teamA: number; teamB: number } | null;
  /** Null in knockout rounds — there is no table to read a position from. */
  homePosition: number | null;
  awayPosition: number | null;
  upsetGap: number | null;
  isDerby: boolean;
  /** Fraction of the league making the same outcome call. Backs "lone wolf". */
  consensusShare: number;
  userCorrectStreak: number;
  boosterActive: string | null;
  fixtureWeight: number;
};

export type ScoringFacts = {
  predicted: PredictedFacts;
  actual: ActualFacts;
  derived: DerivedFacts;
  context: ContextFacts;
};

export const outcomeOf = (home: number, away: number): Outcome =>
  home > away ? 'HOME' : home < away ? 'AWAY' : 'DRAW';

export type BuildFactsInput = {
  predicted: Omit<PredictedFacts, 'outcome' | 'goalDifference' | 'totalGoals' | 'btts'> & {
    homeGoals?: number;
    awayGoals?: number;
    outcome?: Outcome;
  };
  actual: Omit<ActualFacts, 'outcome' | 'goalDifference' | 'totalGoals' | 'btts'> & {
    homeGoals: number;
    awayGoals: number;
  };
  context: ContextFacts;
};

/**
 * Builds the complete fact object. A missing prediction leaves `predicted`
 * fields undefined and every `derived` comparison false — which is the correct
 * behaviour for a member who did not submit, rather than a crash.
 */
export function buildFacts(input: BuildFactsInput): ScoringFacts {
  const a = input.actual;
  const p = input.predicted;

  const actual: ActualFacts = {
    ...a,
    outcome: outcomeOf(a.homeGoals, a.awayGoals),
    goalDifference: a.homeGoals - a.awayGoals,
    totalGoals: a.homeGoals + a.awayGoals,
    btts: a.homeGoals > 0 && a.awayGoals > 0,
  };

  const hasScore = p.homeGoals !== undefined && p.awayGoals !== undefined;

  const predicted: PredictedFacts = {
    ...p,
    ...(hasScore
      ? {
          outcome: p.outcome ?? outcomeOf(p.homeGoals!, p.awayGoals!),
          goalDifference: p.homeGoals! - p.awayGoals!,
          totalGoals: p.homeGoals! + p.awayGoals!,
          btts: p.homeGoals! > 0 && p.awayGoals! > 0,
        }
      : { outcome: p.outcome }),
  };

  const exactScore =
    hasScore && p.homeGoals === actual.homeGoals && p.awayGoals === actual.awayGoals;

  const anytimeScorerHits = p.scorerIds.filter((id) => actual.scorerIds.includes(id)).length;

  const derived: DerivedFacts = {
    exactScore,
    outcomeCorrect: predicted.outcome !== undefined && predicted.outcome === actual.outcome,
    goalDifferenceCorrect: hasScore && predicted.goalDifference === actual.goalDifference,
    homeGoalsCorrect: p.homeGoals === actual.homeGoals,
    awayGoalsCorrect: p.awayGoals === actual.awayGoals,
    totalGoalsCorrect: hasScore && predicted.totalGoals === actual.totalGoals,
    bttsCorrect: predicted.btts !== undefined && predicted.btts === actual.btts,
    // Sum of both errors: a 3-0 guess on a 0-3 result is badly wrong even
    // though the total goals match exactly.
    absoluteGoalError: hasScore
      ? Math.abs(p.homeGoals! - actual.homeGoals) + Math.abs(p.awayGoals! - actual.awayGoals)
      : Infinity,
    scorelineDistance: hasScore
      ? Math.max(
          Math.abs(p.homeGoals! - actual.homeGoals),
          Math.abs(p.awayGoals! - actual.awayGoals),
        )
      : Infinity,
    firstScorerCorrect: actual.firstScorerId !== null && p.scorerIds[0] === actual.firstScorerId,
    anytimeScorerHits,
    qualifierCorrect:
      p.qualifierTeamId !== undefined &&
      actual.qualifierTeamId !== null &&
      p.qualifierTeamId === actual.qualifierTeamId,
  };

  return { predicted, actual, derived, context: input.context };
}

/** Reads a dotted fact path. Unknown paths are impossible — the DSL enum
 *  constrains them at validation time — so this never needs a fallback. */
export function readFact(facts: ScoringFacts, path: FactPath): unknown {
  const [group, key] = path.split('.') as [keyof ScoringFacts, string];
  return (facts[group] as Record<string, unknown>)[key];
}
