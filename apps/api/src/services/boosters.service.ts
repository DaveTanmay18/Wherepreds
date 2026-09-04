import { BoosterType, LeagueRoundStatus, prisma } from '@wp/db';
import type { RuleSetConfig } from '@wp/scoring';
import { conflict, forbidden, notFound } from '../errors.js';

/**
 * Boosters (tasks P5-01, P5-02, P5-04).
 *
 * Two shapes, and the distinction matters:
 *
 *   FIXTURE-LEVEL  BANKER, DOUBLE_POINTS, TRIPLE_POINTS — nominate one match,
 *                  multiply just that prediction.
 *   ROUND-LEVEL    WILDCARD_ROUND, INSURANCE, NO_NEGATIVES — apply to the
 *                  whole round; no fixture is nominated.
 *
 * ⚠️ `resolvedValue` is snapshotted from the rule set AT USE TIME, so a later
 * rules change cannot retroactively alter a booster someone already spent
 * (§6, BoosterUsage). A 2x banker stays a 2x banker even if the league later
 * makes bankers 3x.
 */

export const FIXTURE_BOOSTERS: BoosterType[] = [
  BoosterType.BANKER,
  BoosterType.DOUBLE_POINTS,
  BoosterType.TRIPLE_POINTS,
];

export const ROUND_BOOSTERS: BoosterType[] = [
  BoosterType.WILDCARD_ROUND,
  BoosterType.INSURANCE,
  BoosterType.NO_NEGATIVES,
];

export const isFixtureBooster = (t: BoosterType) => FIXTURE_BOOSTERS.includes(t);

export type BoosterBudget = {
  type: BoosterType;
  value: number;
  usesPerSeason: number;
  used: number;
  remaining: number;
  scope: 'fixture' | 'round';
};

/** What this member has left for the season (task P5-04). */
export async function boosterBudget(leagueId: string, userId: string): Promise<BoosterBudget[]> {
  const ruleSet = await prisma.ruleSet.findFirst({
    where: { leagueId, isActive: true },
    orderBy: { version: 'desc' },
  });
  if (!ruleSet) return [];

  const config = ruleSet.config as unknown as RuleSetConfig;
  if (!config.boosters?.length) return [];

  // Revoked usages do not count: retracting before the deadline must genuinely
  // give the booster back.
  const spent = await prisma.boosterUsage.groupBy({
    by: ['type'],
    where: { userId, leagueRound: { leagueId }, revokedAt: null },
    _count: true,
  });
  const spentByType = new Map(spent.map((s) => [s.type, s._count]));

  return config.boosters.map((b) => {
    const type = b.type as BoosterType;
    const used = spentByType.get(type) ?? 0;
    return {
      type,
      value: b.value,
      usesPerSeason: b.usesPerSeason,
      used,
      remaining: Math.max(0, b.usesPerSeason - used),
      scope: isFixtureBooster(type) ? ('fixture' as const) : ('round' as const),
    };
  });
}

export type UseBoosterInput = {
  leagueId: string;
  userId: string;
  sequence: number;
  type: BoosterType;
  /** Required for fixture-level boosters, rejected for round-level ones. */
  leagueFixtureId?: string;
};

export async function useBooster(input: UseBoosterInput) {
  const leagueRound = await prisma.leagueRound.findFirst({
    where: { leagueId: input.leagueId, sequence: input.sequence },
    include: { ruleSet: true },
  });
  if (!leagueRound) throw notFound('No such round.');

  // A booster is a prediction decision, so it lives under the same deadline —
  // and the clock comes from the database, never the caller (§10.2).
  if (leagueRound.status !== LeagueRoundStatus.UPCOMING) {
    throw conflict(
      'round-locked',
      'Round locked',
      'Boosters can only be used before the deadline.',
    );
  }
  const [{ now }] = await prisma.$queryRaw<[{ now: Date }]>`SELECT now() AS now`;
  if (leagueRound.deadlineAt.getTime() <= now.getTime()) {
    throw conflict('deadline-passed', 'Deadline passed', 'This round is closed.');
  }

  const config = leagueRound.ruleSet.config as unknown as RuleSetConfig;
  const declared = config.boosters?.find((b) => b.type === input.type);
  if (!declared) {
    throw conflict(
      'booster-not-offered',
      'Booster not available',
      'This league does not offer that booster.',
    );
  }

  const wantsFixture = isFixtureBooster(input.type);
  if (wantsFixture && !input.leagueFixtureId) {
    throw conflict('booster-needs-fixture', 'Pick a match', 'This booster applies to one match.');
  }
  if (!wantsFixture && input.leagueFixtureId) {
    throw conflict(
      'booster-is-round-wide',
      'Applies to the whole round',
      'This booster is not tied to a single match.',
    );
  }

  // ── Season budget (task P5-04) ──────────────────────────────────────
  // The unique constraint already prevents two of the same type in ONE round;
  // this counts every OTHER round in the season.
  const usedElsewhere = await prisma.boosterUsage.count({
    where: {
      userId: input.userId,
      type: input.type,
      revokedAt: null,
      leagueRound: { leagueId: input.leagueId },
      NOT: { leagueRoundId: leagueRound.id },
    },
  });
  if (usedElsewhere >= declared.usesPerSeason) {
    throw conflict(
      'booster-exhausted',
      'No uses left',
      `You have used all ${declared.usesPerSeason} of these this season.`,
    );
  }

  if (wantsFixture) {
    const fixture = await prisma.leagueFixture.findFirst({
      where: { id: input.leagueFixtureId, leagueRoundId: leagueRound.id },
    });
    if (!fixture) throw notFound('That match is not in this round.');
  }

  return prisma.$transaction(async (tx) => {
    // Re-using the same type in the same round REPLACES the nomination rather
    // than erroring — moving your banker is a normal thing to do before the
    // deadline, not a mistake.
    const usage = await tx.boosterUsage.upsert({
      where: {
        userId_leagueRoundId_type: {
          userId: input.userId,
          leagueRoundId: leagueRound.id,
          type: input.type,
        },
      },
      update: { revokedAt: null, resolvedValue: declared.value, usedAt: new Date() },
      create: {
        userId: input.userId,
        leagueRoundId: leagueRound.id,
        type: input.type,
        resolvedValue: declared.value,
      },
    });

    if (!wantsFixture) return { usage, predictionId: null };

    // Detach from any previously nominated match in this round.
    await tx.prediction.updateMany({
      where: {
        userId: input.userId,
        boosterUsageId: usage.id,
        leagueFixtureId: { not: input.leagueFixtureId },
      },
      data: { boosterUsageId: null },
    });

    const prediction = await tx.prediction.upsert({
      where: {
        leagueFixtureId_userId: {
          leagueFixtureId: input.leagueFixtureId as string,
          userId: input.userId,
        },
      },
      update: { boosterUsageId: usage.id },
      create: {
        leagueFixtureId: input.leagueFixtureId as string,
        userId: input.userId,
        status: 'DRAFT',
        boosterUsageId: usage.id,
      },
    });

    return { usage, predictionId: prediction.id };
  });
}

/** Retract before the deadline — the use returns to the budget. */
export async function revokeBooster(input: {
  leagueId: string;
  userId: string;
  sequence: number;
  type: BoosterType;
}) {
  const leagueRound = await prisma.leagueRound.findFirst({
    where: { leagueId: input.leagueId, sequence: input.sequence },
  });
  if (!leagueRound) throw notFound('No such round.');
  if (leagueRound.status !== LeagueRoundStatus.UPCOMING) {
    throw forbidden('Boosters cannot be retracted after the deadline.');
  }

  const usage = await prisma.boosterUsage.findUnique({
    where: {
      userId_leagueRoundId_type: {
        userId: input.userId,
        leagueRoundId: leagueRound.id,
        type: input.type,
      },
    },
  });
  if (!usage || usage.revokedAt) throw notFound('That booster is not in use.');

  await prisma.$transaction([
    prisma.prediction.updateMany({
      where: { boosterUsageId: usage.id },
      data: { boosterUsageId: null },
    }),
    prisma.boosterUsage.update({ where: { id: usage.id }, data: { revokedAt: new Date() } }),
  ]);
}

/** Active boosters for one round, for the prediction screen. */
export async function roundBoosters(leagueRoundId: string, userId: string) {
  const usages = await prisma.boosterUsage.findMany({
    where: { leagueRoundId, userId, revokedAt: null },
    include: { prediction: { select: { leagueFixtureId: true } } },
  });

  return usages.map((u) => ({
    type: u.type,
    value: Number(u.resolvedValue),
    leagueFixtureId: u.prediction?.leagueFixtureId ?? null,
    scope: isFixtureBooster(u.type) ? ('fixture' as const) : ('round' as const),
  }));
}
