import type { Award, RuleSetConfig } from './dsl.js';

/**
 * Rule presets (architecture.md §8.6, task P2-09).
 *
 * ⚠️ Presets are COPIED into RuleSet.config at league creation, never
 * referenced by pointer. Editing a preset here must not alter the rules of a
 * league that already exists — a change to a shipped preset would otherwise
 * silently rewrite live competitions.
 */

export type PresetId = 'classic' | 'exact_score_heavy' | 'underdog' | 'survival' | 'goalscorer';

export type Preset = {
  id: PresetId;
  name: string;
  /** One line in plain English, shown on the preset card (§14.1). */
  summary: string;
  /** Three bullets an admin can scan without reading the config. */
  highlights: string[];
  config: RuleSetConfig;
};

/** Reusable award bodies. Typed (not `as const`) so they stay mutable and
 *  assignable to Award — a readonly literal will not satisfy the schema type. */
type AwardTemplate = Omit<Award, 'points'>;

const CORRECT_OUTCOME: AwardTemplate = {
  id: 'correct_outcome',
  label: 'Correct result',
  market: 'MATCH_OUTCOME',
  group: 'result',
  when: { fact: 'derived.outcomeCorrect', op: 'eq', value: true },
};

const EXACT_SCORE: AwardTemplate = {
  id: 'exact_score',
  label: 'Exact score',
  market: 'EXACT_SCORE',
  group: 'result',
  when: { fact: 'derived.exactScore', op: 'eq', value: true },
};

/** Goal difference right but the scoreline wrong — stacks on the result award. */
const GOAL_DIFFERENCE: AwardTemplate = {
  id: 'goal_difference',
  label: 'Right goal difference',
  market: 'EXACT_SCORE',
  group: null,
  when: {
    all: [
      { fact: 'derived.goalDifferenceCorrect', op: 'eq', value: true },
      { fact: 'derived.exactScore', op: 'eq', value: false },
    ],
  },
};

const BASE: Pick<RuleSetConfig, 'schemaVersion' | 'rounding' | 'tiebreakers'> = {
  schemaVersion: 1,
  rounding: 'nearest',
  tiebreakers: ['TOTAL_POINTS', 'EXACT_SCORES', 'CORRECT_OUTCOMES', 'ALPHABETICAL'],
};

export const PRESETS: Record<PresetId, Preset> = {
  classic: {
    id: 'classic',
    name: 'Classic',
    summary: '5 points for the exact score, 2 for the right result. The pub standard.',
    highlights: ['Exact score 5 pts', 'Correct result 2 pts', 'Nothing to lose — no negatives'],
    config: {
      ...BASE,
      markets: ['EXACT_SCORE', 'MATCH_OUTCOME'],
      awards: [
        { ...EXACT_SCORE, points: 5 },
        { ...CORRECT_OUTCOME, points: 2 },
        { ...GOAL_DIFFERENCE, points: 1 },
      ],
      multipliers: [],
      minPointsPerFixture: 0,
      boosters: [{ type: 'BANKER', value: 2, usesPerSeason: 5 }],
    },
  },

  exact_score_heavy: {
    id: 'exact_score_heavy',
    name: 'Exact Score Heavy',
    summary: 'Big reward for nailing the scoreline, almost nothing for the result alone.',
    highlights: ['Exact score 10 pts', 'Correct result just 1 pt', 'Rewards bravery over hedging'],
    config: {
      ...BASE,
      markets: ['EXACT_SCORE', 'MATCH_OUTCOME'],
      awards: [
        { ...EXACT_SCORE, points: 10 },
        { ...CORRECT_OUTCOME, points: 1 },
      ],
      multipliers: [],
      minPointsPerFixture: 0,
      boosters: [{ type: 'DOUBLE_POINTS', value: 2, usesPerSeason: 3 }],
    },
  },

  underdog: {
    id: 'underdog',
    name: 'Underdog',
    summary:
      'Ordinary scoring, but calling an upset — or being the only one who got it right — pays double.',
    highlights: ['Exact score 5 pts, result 2 pts', 'Upset win x2', 'Lone correct caller x2'],
    config: {
      ...BASE,
      markets: ['EXACT_SCORE', 'MATCH_OUTCOME'],
      awards: [
        { ...EXACT_SCORE, points: 5 },
        { ...CORRECT_OUTCOME, points: 2 },
        { ...GOAL_DIFFERENCE, points: 1 },
      ],
      multipliers: [
        {
          id: 'lone_wolf',
          label: 'Only one who called it',
          when: {
            all: [
              { fact: 'derived.outcomeCorrect', op: 'eq', value: true },
              { fact: 'context.consensusShare', op: 'lte', value: 0.15 },
            ],
          },
          factor: 2,
          combine: 'multiply',
        },
        {
          id: 'upset',
          label: 'Called the upset',
          when: {
            all: [
              { fact: 'derived.outcomeCorrect', op: 'eq', value: true },
              { fact: 'context.upsetGap', op: 'gte', value: 6 },
            ],
          },
          factor: 2,
          combine: 'multiply',
        },
      ],
      minPointsPerFixture: 0,
      boosters: [{ type: 'BANKER', value: 2, usesPerSeason: 5 }],
    },
  },

  survival: {
    id: 'survival',
    name: 'Survival',
    summary: 'Wrong results cost you points. Not for the faint-hearted.',
    highlights: ['Exact score 5 pts', 'Wrong result −2 pts', 'Wildly wrong scoreline −1 more'],
    config: {
      ...BASE,
      markets: ['EXACT_SCORE', 'MATCH_OUTCOME'],
      awards: [
        { ...EXACT_SCORE, points: 5 },
        { ...CORRECT_OUTCOME, points: 2 },
        {
          id: 'wrong_result',
          label: 'Wrong result',
          market: 'MATCH_OUTCOME',
          group: null,
          when: { fact: 'derived.outcomeCorrect', op: 'eq', value: false },
          points: -2,
        },
        {
          id: 'wildly_off',
          label: 'Way off',
          market: 'EXACT_SCORE',
          group: null,
          when: { fact: 'derived.absoluteGoalError', op: 'gte', value: 4 },
          points: -1,
        },
      ],
      multipliers: [],
      minPointsPerFixture: -3,
      boosters: [{ type: 'NO_NEGATIVES', value: 1, usesPerSeason: 2 }],
    },
  },

  goalscorer: {
    id: 'goalscorer',
    name: 'Goalscorer',
    summary: 'Naming the scorers matters as much as the scoreline.',
    highlights: ['Exact score 4 pts', 'Any goalscorer 3 pts', 'First goalscorer 5 pts'],
    config: {
      ...BASE,
      markets: ['EXACT_SCORE', 'MATCH_OUTCOME', 'ANYTIME_GOALSCORER', 'FIRST_GOALSCORER'],
      awards: [
        { ...EXACT_SCORE, points: 4 },
        { ...CORRECT_OUTCOME, points: 2 },
        {
          id: 'anytime_scorer',
          label: 'Named a goalscorer',
          market: 'ANYTIME_GOALSCORER',
          group: 'scorer',
          when: { fact: 'derived.anytimeScorerHits', op: 'gte', value: 1 },
          points: 3,
        },
        {
          id: 'first_scorer',
          label: 'First goalscorer',
          market: 'FIRST_GOALSCORER',
          group: 'scorer',
          when: { fact: 'derived.firstScorerCorrect', op: 'eq', value: true },
          points: 5,
        },
      ],
      multipliers: [],
      minPointsPerFixture: 0,
      boosters: [{ type: 'BANKER', value: 2, usesPerSeason: 5 }],
    },
  },
};

export const PRESET_LIST: Preset[] = Object.values(PRESETS);

/** Deep copy, so a league never shares a config object with the preset. */
export function instantiatePreset(id: PresetId): RuleSetConfig {
  const preset = PRESETS[id];
  if (!preset) throw new Error(`Unknown preset "${id}"`);
  return structuredClone(preset.config);
}
