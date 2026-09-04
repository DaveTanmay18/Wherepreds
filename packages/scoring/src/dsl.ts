import { z } from 'zod';

/**
 * The rule DSL (architecture.md §8.3).
 *
 * Rules are DATA, not code. A declarative document validated on write and
 * interpreted deterministically at scoring time. Never user-supplied
 * JavaScript: that would invite non-determinism, infinite loops and RCE, and
 * would make the golden-file test strategy impossible.
 *
 * Everything here is bounded — rule counts, nesting depth, point ranges — so
 * evaluation is O(rules) and provably terminates.
 */

export const MARKETS = [
  'EXACT_SCORE',
  'MATCH_OUTCOME',
  'DOUBLE_CHANCE',
  'BOTH_TEAMS_TO_SCORE',
  'TOTAL_GOALS_OVER_UNDER',
  'CORRECT_MARGIN',
  'HALF_TIME_OUTCOME',
  'FIRST_GOALSCORER',
  'ANYTIME_GOALSCORER',
  'CLEAN_SHEET',
  'RED_CARD_SHOWN',
  'TOTAL_CORNERS_OVER_UNDER',
  'TO_QUALIFY',
] as const;

export const marketSchema = z.enum(MARKETS);
export type Market = z.infer<typeof marketSchema>;

/**
 * Facts a condition may read. A closed list, so a typo is a validation error
 * rather than a rule that silently never fires — which is the single most
 * confusing failure mode a league admin can hit.
 */
export const FACT_PATHS = [
  'derived.exactScore',
  'derived.outcomeCorrect',
  'derived.goalDifferenceCorrect',
  'derived.homeGoalsCorrect',
  'derived.awayGoalsCorrect',
  'derived.totalGoalsCorrect',
  'derived.bttsCorrect',
  'derived.absoluteGoalError',
  'derived.scorelineDistance',
  'derived.firstScorerCorrect',
  'derived.anytimeScorerHits',
  'derived.qualifierCorrect',
  'actual.homeGoals',
  'actual.awayGoals',
  'actual.totalGoals',
  'actual.goalDifference',
  'actual.btts',
  'actual.redCardShown',
  'actual.wentToExtraTime',
  'actual.wentToPenalties',
  'predicted.homeGoals',
  'predicted.awayGoals',
  'predicted.totalGoals',
  'context.roundSequence',
  'context.isFinalRound',
  'context.stage',
  'context.isKnockout',
  'context.legNumber',
  'context.homePosition',
  'context.awayPosition',
  'context.upsetGap',
  'context.isDerby',
  'context.consensusShare',
  'context.userCorrectStreak',
  'context.fixtureWeight',
] as const;

export const factPathSchema = z.enum(FACT_PATHS);
export type FactPath = z.infer<typeof factPathSchema>;

/**
 * Facts that are NULL in knockout rounds — there is no league table to read a
 * position from. `/rules/validate` warns when a UCL rule set depends on these
 * (task P4b-07), because the rule would silently stop firing rather than error.
 */
export const POSITIONAL_FACTS: readonly FactPath[] = [
  'context.homePosition',
  'context.awayPosition',
  'context.upsetGap',
];

const comparable = z.union([z.string(), z.number(), z.boolean()]);

const conditionLeaf = z.discriminatedUnion('op', [
  z.object({ op: z.literal('eq'), fact: factPathSchema, value: comparable }),
  z.object({ op: z.literal('neq'), fact: factPathSchema, value: comparable }),
  z.object({ op: z.literal('gt'), fact: factPathSchema, value: z.number() }),
  z.object({ op: z.literal('gte'), fact: factPathSchema, value: z.number() }),
  z.object({ op: z.literal('lt'), fact: factPathSchema, value: z.number() }),
  z.object({ op: z.literal('lte'), fact: factPathSchema, value: z.number() }),
  z.object({ op: z.literal('in'), fact: factPathSchema, value: z.array(comparable).max(20) }),
]);

export type ConditionGroup =
  | z.infer<typeof conditionLeaf>
  | { all: ConditionGroup[] }
  | { any: ConditionGroup[] }
  | { not: ConditionGroup };

export const conditionGroupSchema: z.ZodType<ConditionGroup> = z.lazy(() =>
  z.union([
    conditionLeaf,
    z.object({ all: z.array(conditionGroupSchema).min(1).max(8) }),
    z.object({ any: z.array(conditionGroupSchema).min(1).max(8) }),
    z.object({ not: conditionGroupSchema }),
  ]),
);

export const awardSchema = z.object({
  /**
   * PERMANENT identifier. It appears in stored `breakdown` JSON on every
   * historical score, so renaming one orphans every past explanation
   * (Appendix A). Treat the id list as append-only.
   */
  id: z.string().regex(/^[a-z0-9_]{1,40}$/, 'lower_snake_case, max 40 chars'),
  label: z.string().min(1).max(60),
  market: marketSchema,
  /**
   * Awards sharing a group are EXCLUSIVE — the highest-scoring one wins.
   * `null` means the award STACKS on top of everything else. Getting this
   * backwards makes every preset score wrong in a way that looks plausible.
   */
  group: z.string().max(30).nullable().default(null),
  when: conditionGroupSchema,
  points: z.number().min(-50).max(200),
});

export const multiplierSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]{1,40}$/),
  label: z.string().min(1).max(60),
  when: conditionGroupSchema,
  factor: z.number().min(0).max(10),
  combine: z.enum(['multiply', 'max']).default('multiply'),
});

export const TIEBREAKERS = [
  'TOTAL_POINTS',
  'EXACT_SCORES',
  'CORRECT_OUTCOMES',
  'PREDICTIONS_MADE',
  'HEAD_TO_HEAD',
  'EARLIEST_SUBMISSION',
  'ALPHABETICAL',
] as const;

export const BOOSTER_TYPES = [
  'DOUBLE_POINTS',
  'TRIPLE_POINTS',
  'BANKER',
  'INSURANCE',
  'WILDCARD_ROUND',
  'NO_NEGATIVES',
] as const;

export const ruleSetConfigSchema = z.object({
  schemaVersion: z.literal(1),
  markets: z.array(marketSchema).min(1).max(6),
  awards: z.array(awardSchema).max(50),
  multipliers: z.array(multiplierSchema).max(10),
  rounding: z.enum(['none', 'nearest', 'floor', 'ceil']).default('nearest'),
  /** Floor applied after multipliers, so a negative rule cannot spiral. */
  minPointsPerFixture: z.number().min(-50).default(-50),
  tiebreakers: z.array(z.enum(TIEBREAKERS)).min(1).max(7),
  boosters: z
    .array(
      z.object({
        type: z.enum(BOOSTER_TYPES),
        value: z.number().min(0).max(5),
        usesPerSeason: z.number().int().min(0).max(38),
      }),
    )
    .max(4)
    .default([]),
});

export type RuleSetConfig = z.infer<typeof ruleSetConfigSchema>;
export type Award = z.infer<typeof awardSchema>;
export type Multiplier = z.infer<typeof multiplierSchema>;

/** Every award id referenced by a config, for duplicate detection. */
export function collectRuleIds(config: RuleSetConfig): string[] {
  return [...config.awards.map((a) => a.id), ...config.multipliers.map((m) => m.id)];
}

/** Every fact path a config reads. Powers the positional-fact warning. */
export function collectFactPaths(config: RuleSetConfig): FactPath[] {
  const out = new Set<FactPath>();
  const walk = (c: ConditionGroup): void => {
    if ('all' in c) return c.all.forEach(walk);
    if ('any' in c) return c.any.forEach(walk);
    if ('not' in c) return walk(c.not);
    out.add(c.fact);
  };
  config.awards.forEach((a) => walk(a.when));
  config.multipliers.forEach((m) => walk(m.when));
  return [...out];
}
