import type { ConditionGroup, RuleSetConfig } from './dsl.js';
import { readFact, type ScoringFacts } from './facts.js';

/**
 * The interpreter (architecture.md §8.5, task P3-12).
 *
 * Pure and total: no I/O, no clock, no randomness, and bounded by the DSL's
 * own caps, so it always terminates. Same inputs, same points, forever — which
 * is what makes the golden-file tests meaningful and rescoring safe.
 */

export type BreakdownEntry =
  | { kind: 'award'; ruleId: string; label: string; points: number; group: string | null }
  | { kind: 'multiplier'; ruleId: string; label: string; factor: number }
  // Recorded so a breakdown can say WHY a fixture shows a negative score.
  // Without an entry the sheet reads "-1" with nothing to point at.
  | { kind: 'penalty'; ruleId: string; label: string; points: number };

export type ScoreResult = {
  basePoints: number;
  multiplier: number;
  points: number;
  breakdown: BreakdownEntry[];
};

/** Evaluates a condition tree against the facts. */
export function matches(condition: ConditionGroup, facts: ScoringFacts): boolean {
  if ('all' in condition) return condition.all.every((c) => matches(c, facts));
  if ('any' in condition) return condition.any.some((c) => matches(c, facts));
  if ('not' in condition) return !matches(condition.not, facts);

  const value = readFact(facts, condition.fact);

  switch (condition.op) {
    case 'eq':
      return value === condition.value;
    case 'neq':
      return value !== condition.value;
    case 'in':
      return (condition.value as unknown[]).includes(value);
    // Numeric comparisons against a null or undefined fact are FALSE, never a
    // coercion. `null > 5` would be false anyway, but `null >= 0` coerces to
    // true in JS — and a rule silently firing on missing data is exactly the
    // bug that would be impossible to spot in a leaderboard (§11.5).
    case 'gt':
      return typeof value === 'number' && value > condition.value;
    case 'gte':
      return typeof value === 'number' && value >= condition.value;
    case 'lt':
      return typeof value === 'number' && value < condition.value;
    case 'lte':
      return typeof value === 'number' && value <= condition.value;
  }
}

function applyRounding(value: number, mode: RuleSetConfig['rounding']): number {
  switch (mode) {
    case 'floor':
      return Math.floor(value);
    case 'ceil':
      return Math.ceil(value);
    case 'nearest':
      return Math.round(value);
    case 'none':
    default:
      // Two decimal places, so floating-point noise never reaches a standings
      // table. 0.1 + 0.2 must not become 0.30000000000000004 on a leaderboard.
      return Math.round(value * 100) / 100;
  }
}

/** What a boosted prediction costs when it earns nothing. 0 disables it. */
function boosterPenalty(active: string | null, config: RuleSetConfig): number {
  if (!active) return 0;
  const booster = config.boosters.find((b) => b.type === active);
  // Round-level boosters are not a per-fixture bet, so they cannot miss one.
  if (!booster || active === 'INSURANCE' || active === 'NO_NEGATIVES') return 0;
  return booster.penaltyIfWrong ?? 0;
}

/** Booster multipliers, resolved from the config's declared boosters. */
function boosterFactor(active: string | null, config: RuleSetConfig): number {
  if (!active) return 1;
  const booster = config.boosters.find((b) => b.type === active);
  if (!booster) return 1;
  switch (active) {
    case 'DOUBLE_POINTS':
    case 'TRIPLE_POINTS':
    case 'BANKER':
    case 'WILDCARD_ROUND':
      return booster.value;
    // INSURANCE and NO_NEGATIVES change the floor, not the multiplier; they
    // are applied at round level by the scoring worker.
    default:
      return 1;
  }
}

export function scorePrediction(facts: ScoringFacts, config: RuleSetConfig): ScoreResult {
  const fired: BreakdownEntry[] = [];

  // ── 1. Awards ────────────────────────────────────────────────────────
  // Awards sharing a group are EXCLUSIVE — highest wins. `group: null`
  // awards STACK. Reversing this makes every preset score plausibly wrong:
  // Classic would pay 7 for an exact score instead of 5.
  const bestByGroup = new Map<string, Extract<BreakdownEntry, { kind: 'award' }>>();

  for (const award of config.awards) {
    if (!matches(award.when, facts)) continue;

    const entry = {
      kind: 'award' as const,
      ruleId: award.id,
      label: award.label,
      points: award.points,
      group: award.group,
    };

    if (award.group === null) {
      fired.push(entry);
    } else {
      const incumbent = bestByGroup.get(award.group);
      if (!incumbent || entry.points > incumbent.points) bestByGroup.set(award.group, entry);
    }
  }
  fired.push(...bestByGroup.values());

  const basePoints = fired.reduce((sum, e) => (e.kind === 'award' ? sum + e.points : sum), 0);

  // ── 2. Multipliers ───────────────────────────────────────────────────
  let product = 1;
  let max = 1;
  let sawMax = false;

  for (const m of config.multipliers) {
    if (!matches(m.when, facts)) continue;
    fired.push({ kind: 'multiplier', ruleId: m.id, label: m.label, factor: m.factor });
    if (m.combine === 'multiply') {
      product *= m.factor;
    } else {
      max = Math.max(max, m.factor);
      sawMax = true;
    }
  }

  // ── 3. Contextual multipliers, outside the DSL ───────────────────────
  const contextual =
    facts.context.fixtureWeight * boosterFactor(facts.context.boosterActive, config);
  const multiplier = (sawMax ? Math.max(product, max) : product) * contextual;

  // ── 4. Apply, floor, round ───────────────────────────────────────────
  const raw = basePoints * multiplier;
  const floored = Math.max(raw, config.minPointsPerFixture);
  let points = applyRounding(floored, config.rounding);

  /**
   * ── 5. Booster penalty ───────────────────────────────────────────────
   *
   * A boosted prediction that earned NOTHING costs the member points, if the
   * league declared a penalty for it.
   *
   * ⚠️ Deliberately REPLACES the score rather than being added as an award.
   * An award of -1 would be multiplied by the booster's own factor (-1 x 2 =
   * -2), and then clamped straight back to 0 by `minPointsPerFixture`, which
   * is 0 in every preset — so the penalty would silently do nothing at all.
   * Bypassing both is the only way the declared number is the number applied.
   *
   * "Earned nothing" is the test, not "got the outcome wrong": in a league
   * paying 1 for the outcome and 5 for the exact score, a banked prediction
   * that lands the outcome has earned something and is not a miss.
   *
   * NO_NEGATIVES still floors this to 0 — that booster is applied at round
   * level by the worker, after this runs, which is exactly its purpose.
   */
  const penalty = boosterPenalty(facts.context.boosterActive, config);
  if (penalty > 0 && points <= 0) {
    points = -penalty;
    fired.push({
      kind: 'penalty',
      ruleId: `booster-miss:${facts.context.boosterActive}`,
      label: `${facts.context.boosterActive} missed`,
      points: -penalty,
    });
  }

  return {
    basePoints,
    // Rounded so the stored value reconstructs exactly what the UI shows.
    multiplier: Math.round(multiplier * 1000) / 1000,
    points,
    breakdown: fired,
  };
}
