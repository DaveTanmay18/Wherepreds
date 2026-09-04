import { prisma, type Prisma } from '@wp/db';
import {
  buildFacts,
  collectFactPaths,
  collectRuleIds,
  POSITIONAL_FACTS,
  ruleSetConfigSchema,
  scorePrediction,
  type ContextFacts,
  type RuleSetConfig,
} from '@wp/scoring';
import {
  capabilitiesFromEnv,
  footballEnvSchema,
  rejectUnavailableMarkets,
  type Market,
} from '@wp/shared';
import { conflict, notFound, unprocessable } from '../errors.js';

/**
 * Rule authoring (tasks P4-01 to P4-07).
 *
 * Rules are data, so authoring them is a validation problem rather than a
 * deployment one. The two things that make it usable are honest errors and a
 * preview — without /simulate, custom rules are guesswork (§12.1).
 */

export type ValidationIssue = {
  code: string;
  severity: 'error' | 'warning';
  detail: string;
  ruleId?: string;
  field?: string;
};

/** Provider capabilities, read once from the environment (§11.5). */
function capabilities() {
  const env = footballEnvSchema.parse(process.env);
  return capabilitiesFromEnv(env);
}

/**
 * Validates a candidate config. Returns EVERY problem at once — fixing rules
 * one round-trip at a time is miserable, and an admin editing scoring wants
 * the whole picture before committing.
 */
export function validateConfig(
  raw: unknown,
  opts: { isKnockoutCompetition: boolean },
): { valid: boolean; issues: ValidationIssue[]; config: RuleSetConfig | null } {
  const parsed = ruleSetConfigSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      valid: false,
      config: null,
      issues: parsed.error.issues.map((i) => ({
        code: i.code,
        severity: 'error' as const,
        detail: i.message,
        field: i.path.join('.'),
      })),
    };
  }

  const config = parsed.data;
  const issues: ValidationIssue[] = [];

  // ── Market gating (task P4-01a) ─────────────────────────────────────
  // A market the plan cannot score would award nobody any points all season,
  // which is indistinguishable from a scoring bug to whoever is looking.
  for (const blocked of rejectUnavailableMarkets(config.markets as Market[], capabilities())) {
    issues.push({
      code: 'MARKET_UNAVAILABLE',
      severity: 'error',
      detail: blocked.reason,
      field: blocked.market,
    });
  }

  // ── Duplicate rule ids ──────────────────────────────────────────────
  const ids = collectRuleIds(config);
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      issues.push({
        code: 'DUPLICATE_RULE_ID',
        severity: 'error',
        detail: `Rule id "${id}" is used more than once. Ids appear in stored breakdowns and must be unique.`,
        ruleId: id,
      });
    }
    seen.add(id);
  }

  // ── Awards referencing markets the league does not play ─────────────
  for (const award of config.awards) {
    if (!config.markets.includes(award.market)) {
      issues.push({
        code: 'AWARD_MARKET_NOT_ENABLED',
        severity: 'error',
        detail: `"${award.label}" scores the ${award.market} market, which this league does not play.`,
        ruleId: award.id,
      });
    }
  }

  // ── Positional facts in a knockout competition (task P4b-07) ────────
  // Null in knockout rounds, so the rule silently stops firing. A warning,
  // not an error — a UCL league may legitimately want it for the league phase.
  if (opts.isKnockoutCompetition) {
    const used = collectFactPaths(config).filter((f) => POSITIONAL_FACTS.includes(f));
    if (used.length) {
      issues.push({
        code: 'POSITIONAL_FACT_IN_KNOCKOUT',
        severity: 'warning',
        detail: `Rules using ${used.join(', ')} will not fire in knockout rounds — there is no league table to read a position from. They still work during the league phase.`,
      });
    }
  }

  // ── Rules that can never fire ───────────────────────────────────────
  for (const award of config.awards) {
    if (award.points === 0) {
      issues.push({
        code: 'ZERO_POINT_AWARD',
        severity: 'warning',
        detail: `"${award.label}" awards 0 points, so it will appear in breakdowns without changing any total.`,
        ruleId: award.id,
      });
    }
  }
  for (const m of config.multipliers) {
    if (m.factor === 1) {
      issues.push({
        code: 'NEUTRAL_MULTIPLIER',
        severity: 'warning',
        detail: `"${m.label}" multiplies by 1, which has no effect.`,
        ruleId: m.id,
      });
    }
  }

  const hasErrors = issues.some((i) => i.severity === 'error');
  return { valid: !hasErrors, issues, config: hasErrors ? null : config };
}

/**
 * Scores sample fixtures under a candidate config (task P4-02).
 *
 * THE feature that makes custom rules usable: the admin sees "a 2-1 prediction
 * on a 3-1 result pays 3 points" before committing, rather than discovering it
 * three gameweeks in.
 */
export type SimulationCase = {
  label: string;
  predicted: [number, number];
  actual: [number, number];
  consensusShare?: number;
};

export const DEFAULT_CASES: SimulationCase[] = [
  { label: 'Exact score', predicted: [2, 1], actual: [2, 1] },
  { label: 'Right result, wrong score', predicted: [2, 1], actual: [3, 1] },
  { label: 'Right goal difference', predicted: [1, 0], actual: [2, 1] },
  { label: 'Wrong result', predicted: [2, 0], actual: [0, 2] },
  { label: 'Score draw predicted, draw happened', predicted: [1, 1], actual: [2, 2] },
  { label: 'Wildly wrong', predicted: [4, 0], actual: [0, 3] },
  { label: 'Lone correct call', predicted: [0, 1], actual: [0, 1], consensusShare: 0.1 },
];

export function simulate(config: RuleSetConfig, cases: SimulationCase[] = DEFAULT_CASES) {
  return cases.map((c) => {
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
      consensusShare: c.consensusShare ?? 0.5,
      userCorrectStreak: 0,
      boosterActive: null,
      fixtureWeight: 1,
    };

    const facts = buildFacts({
      predicted: { homeGoals: c.predicted[0], awayGoals: c.predicted[1], scorerIds: [] },
      actual: {
        homeGoals: c.actual[0],
        awayGoals: c.actual[1],
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

    const result = scorePrediction(facts, config);
    return {
      label: c.label,
      predicted: `${c.predicted[0]}-${c.predicted[1]}`,
      actual: `${c.actual[0]}-${c.actual[1]}`,
      points: result.points,
      basePoints: result.basePoints,
      multiplier: result.multiplier,
      breakdown: result.breakdown,
    };
  });
}

/**
 * Creates the next rule-set version (tasks P4-03, P4-04, P4-07).
 *
 * ⚠️ THE guarantee this product rests on: a rules change can NEVER alter a
 * past leaderboard (§8.7). Once a version has scored anything it is frozen;
 * editing produces version N+1, which attaches only to UPCOMING rounds.
 * Scored rounds keep pointing at the version they were played under.
 */
export async function createRuleSetVersion(
  leagueId: string,
  actorId: string,
  config: RuleSetConfig,
  promoted: {
    name?: string;
    deadlineStrategy?: string;
    deadlineOffsetMin?: number;
    allowEdits?: boolean;
    revealPicksBeforeDeadline?: boolean;
    missedPredictionPoints?: number;
    fixturesPerRound?: number | null;
    knockoutScoreBasis?: string;
    voidPostponedFixtures?: boolean;
  } = {},
) {
  const current = await prisma.ruleSet.findFirst({
    where: { leagueId, isActive: true },
    orderBy: { version: 'desc' },
  });
  if (!current) throw notFound('This league has no active rule set.');

  const data = {
    name: promoted.name ?? current.name,
    config: config as unknown as Prisma.InputJsonValue,
    deadlineStrategy: (promoted.deadlineStrategy ?? current.deadlineStrategy) as never,
    deadlineOffsetMin: promoted.deadlineOffsetMin ?? current.deadlineOffsetMin,
    allowEdits: promoted.allowEdits ?? current.allowEdits,
    revealPicksBeforeDeadline:
      promoted.revealPicksBeforeDeadline ?? current.revealPicksBeforeDeadline,
    missedPredictionPoints: promoted.missedPredictionPoints ?? current.missedPredictionPoints,
    fixturesPerRound:
      promoted.fixturesPerRound !== undefined
        ? promoted.fixturesPerRound
        : current.fixturesPerRound,
    knockoutScoreBasis: (promoted.knockoutScoreBasis ?? current.knockoutScoreBasis) as never,
    voidPostponedFixtures: promoted.voidPostponedFixtures ?? current.voidPostponedFixtures,
    maxBoostersPerSeason: config.boosters.reduce((n, b) => n + b.usesPerSeason, 0),
  };

  // Not yet frozen — no round has been scored under it, so editing in place
  // cannot rewrite anything that already happened.
  if (!current.isFrozen) {
    const updated = await prisma.ruleSet.update({ where: { id: current.id }, data });
    await auditRuleChange(actorId, leagueId, current, updated, 'ruleset.update');
    return { ruleSet: updated, newVersion: false, appliesFromRound: null as number | null };
  }

  // Frozen: a new version, attached to UPCOMING rounds only.
  const result = await prisma.$transaction(async (tx) => {
    // ⚠️ ORDER MATTERS. The partial unique index rule_sets_one_active (§7.2)
    // permits exactly one active version per league, so the outgoing version
    // must be demoted BEFORE the new one is created — creating first leaves
    // two active rows momentarily and the index rejects the whole transaction.
    // Caught by the P4-03 test; the index did its job.
    await tx.ruleSet.update({ where: { id: current.id }, data: { isActive: false } });

    const next = await tx.ruleSet.create({
      data: {
        ...data,
        leagueId,
        version: current.version + 1,
        isActive: true,
        createdById: actorId,
      },
    });

    const upcoming = await tx.leagueRound.findMany({
      where: { leagueId, status: 'UPCOMING' },
      orderBy: { sequence: 'asc' },
      select: { id: true, sequence: true },
    });

    await tx.leagueRound.updateMany({
      where: { id: { in: upcoming.map((r) => r.id) } },
      data: { ruleSetId: next.id },
    });

    return { next, appliesFromRound: upcoming[0]?.sequence ?? null };
  });

  await auditRuleChange(actorId, leagueId, current, result.next, 'ruleset.version');

  // Silent rule changes destroy trust faster than the change itself (§9.2).
  await notifyMembers(leagueId, actorId, result.next.version, result.appliesFromRound);

  return { ruleSet: result.next, newVersion: true, appliesFromRound: result.appliesFromRound };
}

async function auditRuleChange(
  actorId: string,
  leagueId: string,
  before: { version: number; config: unknown },
  after: { version: number; config: unknown },
  action: string,
) {
  await prisma.auditLog.create({
    data: {
      actorId,
      action,
      entityType: 'RuleSet',
      // Prefixed with the league id so the activity feed can find it.
      entityId: `${leagueId}:ruleset`,
      before: { version: before.version, config: before.config } as Prisma.InputJsonValue,
      after: { version: after.version, config: after.config } as Prisma.InputJsonValue,
    },
  });
}

async function notifyMembers(
  leagueId: string,
  actorId: string,
  version: number,
  fromRound: number | null,
) {
  const league = await prisma.predictionLeague.findUnique({
    where: { id: leagueId },
    select: { slug: true, name: true },
  });
  const members = await prisma.leagueMembership.findMany({
    where: { leagueId, status: 'ACTIVE', userId: { not: actorId } },
    select: { userId: true },
  });
  if (members.length === 0) return;

  await prisma.notification.createMany({
    data: members.map((m) => ({
      userId: m.userId,
      type: 'rules.changed',
      title: `Scoring rules changed in ${league?.name ?? 'your league'}`,
      body: fromRound
        ? `Version ${version} applies from round ${fromRound}. Earlier rounds keep the rules they were played under.`
        : `Version ${version} is now active.`,
      linkPath: `/leagues/${league?.slug}/rules`,
    })),
  });
}

/** Blocks in-place edits once a score references the version (task P4-04). */
export async function freezeIfScored(ruleSetId: string): Promise<boolean> {
  const scored = await prisma.predictionScore.findFirst({
    where: { ruleSetId },
    select: { id: true },
  });
  if (!scored) return false;
  await prisma.ruleSet.update({ where: { id: ruleSetId }, data: { isFrozen: true } });
  return true;
}

export function assertEditable(ruleSet: { isFrozen: boolean; version: number }) {
  if (ruleSet.isFrozen) {
    throw conflict(
      'ruleset-frozen',
      'Rules already used for scoring',
      `Version ${ruleSet.version} has scored at least one round, so it cannot be edited. Saving will create version ${ruleSet.version + 1}, which applies to upcoming rounds only.`,
    );
  }
}

export function toValidationError(issues: ValidationIssue[]) {
  return unprocessable(
    'These rules cannot be saved.',
    issues.map((i) => ({ ...i, code: i.code })),
  );
}
