import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from './api.js';

export type Condition =
  | { fact: string; op: string; value: string | number | boolean }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

export type Award = {
  id: string;
  label: string;
  market: string;
  group: string | null;
  when: Condition;
  points: number;
};

export type Multiplier = {
  id: string;
  label: string;
  when: Condition;
  factor: number;
  combine: 'multiply' | 'max';
};

export type RuleConfig = {
  schemaVersion: 1;
  markets: string[];
  awards: Award[];
  multipliers: Multiplier[];
  rounding: 'none' | 'nearest' | 'floor' | 'ceil';
  minPointsPerFixture: number;
  tiebreakers: string[];
  boosters: {
    type: string;
    value: number;
    usesPerSeason: number;
    /** Points lost when a boosted prediction scores nothing. 0 = risk-free. */
    penaltyIfWrong?: number;
  }[];
};

export type RulesResponse = {
  version: number;
  name: string;
  isFrozen: boolean;
  config: RuleConfig;
  deadlineStrategy: string;
  deadlineOffsetMin: number;
  allowEdits: boolean;
  revealPicksBeforeDeadline: boolean;
  missedPredictionPoints: number;
  knockoutScoreBasis: string;
  voidPostponedFixtures: boolean;
  canEditInPlace: boolean;
};

export type Issue = { code: string; detail: string; ruleId?: string; field?: string };

export type SimResult = {
  label: string;
  predicted: string;
  actual: string;
  points: number;
  basePoints: number;
  multiplier: number;
  breakdown: { kind: string; ruleId: string; label: string; points?: number; factor?: number }[];
};

export type MarketOption = { market: string; available: boolean; reason: string | null };
export type FactOption = {
  fact: string;
  label: string;
  type: 'boolean' | 'number';
  markets: readonly string[];
};

export const useRules = (slug: string | undefined) =>
  useQuery({
    queryKey: ['league', slug, 'rules'],
    queryFn: () =>
      api.get<{
        rules: RulesResponse;
        availableMarkets: MarketOption[];
        factOptions: FactOption[];
      }>(`/leagues/${slug}/rules`),
    enabled: !!slug,
  });

export const useRuleVersions = (slug: string | undefined) =>
  useQuery({
    queryKey: ['league', slug, 'rules', 'versions'],
    queryFn: () =>
      api.get<{
        versions: {
          version: number;
          name: string;
          isActive: boolean;
          isFrozen: boolean;
          createdAt: string;
          appliesFromRound: number | null;
        }[];
      }>(`/leagues/${slug}/rules/versions`),
    enabled: !!slug,
  });

/**
 * Live preview (task P4-14). Without this, authoring custom rules is
 * guesswork — the admin needs to see "a 2-1 on a 3-1 pays 3 points" while
 * editing, not three gameweeks later (§12.1).
 */
export function useSimulate(slug: string | undefined) {
  return useMutation({
    mutationFn: (config: RuleConfig) =>
      api.post<{ valid: boolean; warnings?: Issue[]; errors?: Issue[]; results: SimResult[] }>(
        `/leagues/${slug}/rules/simulate`,
        { config },
      ),
  });
}

export type RuleSettings = {
  deadlineStrategy: string;
  deadlineOffsetMin: number;
  allowEdits: boolean;
  revealPicksBeforeDeadline: boolean;
  missedPredictionPoints: number;
  knockoutScoreBasis: string;
  voidPostponedFixtures: boolean;
};

export function useSaveRules(slug: string | undefined) {
  return useMutation({
    mutationFn: (body: { config: RuleConfig } & Record<string, unknown>) =>
      api.post<{ version: number; newVersion: boolean; appliesFromRound: number | null }>(
        `/leagues/${slug}/rules`,
        body,
      ),
  });
}

/** Plain-English labels. The editor must never show a raw fact path (§14.1). */
export const FACT_LABELS: Record<string, string> = {
  'derived.exactScore': 'the exact score is right',
  'derived.outcomeCorrect': 'the result is right',
  'derived.goalDifferenceCorrect': 'the goal difference is right',
  'derived.bttsCorrect': 'both-teams-to-score is right',
  'derived.absoluteGoalError': 'how far off the scoreline was',
  'derived.anytimeScorerHits': 'goalscorers correctly named',
  'derived.firstScorerCorrect': 'the first goalscorer is right',
  'derived.qualifierCorrect': 'the side that went through is right',
  'context.consensusShare': 'share of the league who agreed',
  'context.upsetGap': 'how big an upset it was',
  'context.isFinalRound': 'it is the final round',
  'context.userCorrectStreak': 'the current correct streak',
};

export const OP_LABELS: Record<string, string> = {
  eq: 'is',
  neq: 'is not',
  gt: 'is more than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  in: 'is one of',
};

/** Renders a condition tree as a sentence, not as JSON. */
export function describeCondition(c: Condition): string {
  if ('all' in c) return c.all.map(describeCondition).join(' and ');
  if ('any' in c) return c.any.map(describeCondition).join(' or ');
  if ('not' in c) return `not (${describeCondition(c.not)})`;

  const fact = FACT_LABELS[c.fact] ?? c.fact;
  if (typeof c.value === 'boolean') return c.value ? fact : `not ${fact}`;
  return `${fact} ${OP_LABELS[c.op] ?? c.op} ${String(c.value)}`;
}

export const TIEBREAKER_LABELS: Record<string, string> = {
  TOTAL_POINTS: 'Total points',
  EXACT_SCORES: 'Most exact scores',
  CORRECT_OUTCOMES: 'Most correct results',
  PREDICTIONS_MADE: 'Most predictions made',
  HEAD_TO_HEAD: 'Head to head',
  EARLIEST_SUBMISSION: 'Submitted earliest',
  ALPHABETICAL: 'Alphabetical',
};
