import { createHash } from 'node:crypto';
import {
  LeagueRoundStatus,
  MarketType,
  PredictionStatus,
  ScoringRunStatus,
  prisma,
  type Prisma,
} from '@wp/db';
import { buildFacts, scorePrediction, type ContextFacts, type RuleSetConfig } from '@wp/scoring';
import type { Logger } from '../logger.js';
import { isDecidingLeg, resolveKnockoutScore } from './knockout.js';

/**
 * Scoring worker (tasks P3-13, P3-14, P3-15).
 *
 * Idempotent by construction: a run is keyed on a hash of its inputs, so
 * re-delivering the same job is a no-op and a corrected result produces a
 * genuinely different run. Provider webhooks are not reliably once-only, so
 * this is what makes the pipeline safe to retry aggressively (§9.1).
 */

/** A member's mean round score so far, for the INSURANCE booster. */
async function averageRoundPoints(leagueId: string, userId: string): Promise<number | null> {
  const rows = await prisma.standingEntry.findMany({
    where: { leagueId, userId },
    select: { roundPoints: true },
  });
  if (rows.length === 0) return null;
  const total = rows.reduce((n, r) => n + Number(r.roundPoints), 0);
  return Math.round((total / rows.length) * 100) / 100;
}

export function computeInputHash(
  leagueRoundId: string,
  ruleSetVersion: number,
  fixtures: { fixtureId: string; resultVersion: number }[],
): string {
  const parts = fixtures
    .map((f) => `${f.fixtureId}:${f.resultVersion}`)
    .sort()
    .join('|');
  return createHash('sha256').update(`${leagueRoundId}‖${ruleSetVersion}‖${parts}`).digest('hex');
}

type Outcome = 'HOME' | 'DRAW' | 'AWAY';
const outcomeOf = (h: number, a: number): Outcome => (h > a ? 'HOME' : h < a ? 'AWAY' : 'DRAW');

export async function scoreLeagueRound(
  leagueRoundId: string,
  trigger: string,
  log: Logger,
): Promise<{ scored: number; skipped?: string }> {
  const leagueRound = await prisma.leagueRound.findUniqueOrThrow({
    where: { id: leagueRoundId },
    include: {
      ruleSet: true,
      round: { select: { type: true, number: true, isTwoLegged: true } },
      fixtures: {
        include: {
          fixture: {
            select: {
              id: true,
              status: true,
              homeGoals: true,
              awayGoals: true,
              homeGoalsEt: true,
              awayGoalsEt: true,
              homePenalties: true,
              awayPenalties: true,
              homeTeamId: true,
              awayTeamId: true,
              resultVersion: true,
              legNumber: true,
              tie: {
                select: {
                  winnerTeamId: true,
                  settledAt: true,
                  aggregateA: true,
                  aggregateB: true,
                  teamAId: true,
                },
              },
            },
          },
          predictions: { include: { selections: true } },
        },
      },
      // Boosters are per (user, round); fixture-level ones additionally point
      // at a prediction (task P5-03).
      boosterUsages: {
        where: { revokedAt: null },
        include: { prediction: { select: { id: true, leagueFixtureId: true } } },
      },
    },
  });

  const playable = leagueRound.fixtures.filter((lf) => !lf.isVoided);
  const allFinished = playable.every((lf) => lf.fixture.homeGoals !== null);

  if (!allFinished) return { scored: 0, skipped: 'not all fixtures finished' };

  // ⚠️ A tie that has finished on the pitch but is not yet settled must NOT be
  // scored — a TO_QUALIFY market resolved against a half-resolved tie is
  // exactly the error that forces a rescore (§9.3, task P4b-05).
  const unsettledTie = playable.find((lf) => lf.fixture.tie && lf.fixture.tie.settledAt === null);
  if (unsettledTie) return { scored: 0, skipped: 'tie not settled' };

  const inputHash = computeInputHash(
    leagueRoundId,
    leagueRound.ruleSet.version,
    playable.map((lf) => ({
      fixtureId: lf.fixture.id,
      resultVersion: lf.fixture.resultVersion,
    })),
  );

  const priorRun = await prisma.scoringRun.findUnique({
    where: { leagueRoundId_inputHash: { leagueRoundId, inputHash } },
  });
  if (priorRun?.status === ScoringRunStatus.COMPLETED) {
    return { scored: 0, skipped: 'already scored with identical inputs' };
  }

  // Any earlier run for this round used different inputs — a corrected result.
  await prisma.scoringRun.updateMany({
    where: { leagueRoundId, status: ScoringRunStatus.COMPLETED },
    data: { status: ScoringRunStatus.SUPERSEDED },
  });

  const run = await prisma.scoringRun.upsert({
    where: { leagueRoundId_inputHash: { leagueRoundId, inputHash } },
    update: { status: ScoringRunStatus.RUNNING, startedAt: new Date(), error: null },
    create: {
      leagueRoundId,
      ruleSetId: leagueRound.ruleSetId,
      inputHash,
      trigger,
      status: ScoringRunStatus.RUNNING,
      startedAt: new Date(),
    },
  });

  try {
    const config = leagueRound.ruleSet.config as unknown as RuleSetConfig;
    const scores: Prisma.PredictionScoreCreateManyInput[] = [];

    // ── Boosters (task P5-03) ────────────────────────────────────────
    // Fixture-level boosters multiply one prediction; round-level ones change
    // how the ROUND is totalled and are applied after every fixture is scored.
    const fixtureBooster = new Map<string, string>(); // predictionId -> type
    const roundBoosterByUser = new Map<string, { type: string; value: number }[]>();

    for (const b of leagueRound.boosterUsages) {
      if (b.prediction) {
        fixtureBooster.set(b.prediction.id, b.type);
      } else {
        roundBoosterByUser.set(b.userId, [
          ...(roundBoosterByUser.get(b.userId) ?? []),
          { type: b.type, value: Number(b.resolvedValue) },
        ]);
      }
    }

    for (const lf of playable) {
      const fx = lf.fixture;

      // ⚠️ Resolved BEFORE any rule runs, so rules never branch on the basis
      // (§8.8, task P4b-02).
      const resolved = resolveKnockoutScore(
        {
          homeGoals: fx.homeGoals!,
          awayGoals: fx.awayGoals!,
          homeGoalsEt: fx.homeGoalsEt,
          awayGoalsEt: fx.awayGoalsEt,
          homePenalties: fx.homePenalties,
          awayPenalties: fx.awayPenalties,
        },
        leagueRound.ruleSet.knockoutScoreBasis,
      );

      const deciding = isDecidingLeg(fx.legNumber, leagueRound.round.isTwoLegged);

      // consensusShare (task P3-13): computed ONCE per fixture, not per
      // prediction. It backs "the only one who called it".
      const counted = lf.predictions.filter((p) => p.status !== PredictionStatus.DRAFT);
      const outcomeCounts = new Map<string, number>();
      for (const p of counted) {
        const sel = p.selections.find(
          (s) => s.market === MarketType.EXACT_SCORE || s.market === MarketType.MATCH_OUTCOME,
        );
        const o =
          sel?.outcome ??
          (sel?.homeGoals != null && sel.awayGoals != null
            ? outcomeOf(sel.homeGoals, sel.awayGoals)
            : null);
        if (o) outcomeCounts.set(o, (outcomeCounts.get(o) ?? 0) + 1);
      }

      for (const prediction of counted) {
        const bySlot = new Map(prediction.selections.map((s) => [s.market, s]));
        const scoreSel = bySlot.get(MarketType.EXACT_SCORE) ?? bySlot.get(MarketType.MATCH_OUTCOME);

        const predictedOutcome =
          scoreSel?.outcome ??
          (scoreSel?.homeGoals != null && scoreSel.awayGoals != null
            ? outcomeOf(scoreSel.homeGoals, scoreSel.awayGoals)
            : undefined);

        const share = predictedOutcome
          ? (outcomeCounts.get(predictedOutcome) ?? 0) / Math.max(1, counted.length)
          : 0;

        const context: ContextFacts = {
          roundSequence: leagueRound.sequence,
          isFinalRound: false,
          stage: leagueRound.round.type,
          isKnockout: fx.tie !== null,
          legNumber: fx.legNumber,
          aggregateBefore:
            fx.tie && fx.tie.aggregateA !== null && fx.tie.aggregateB !== null
              ? { teamA: fx.tie.aggregateA, teamB: fx.tie.aggregateB }
              : null,
          // Null in knockout rounds: no table means no position (§8.8).
          homePosition: null,
          awayPosition: null,
          upsetGap: null,
          isDerby: false,
          consensusShare: share,
          userCorrectStreak: 0,
          boosterActive: fixtureBooster.get(prediction.id) ?? null,
          fixtureWeight: Number(lf.weight),
        };

        const facts = buildFacts({
          predicted: {
            ...(scoreSel?.homeGoals != null ? { homeGoals: scoreSel.homeGoals } : {}),
            ...(scoreSel?.awayGoals != null ? { awayGoals: scoreSel.awayGoals } : {}),
            ...(predictedOutcome ? { outcome: predictedOutcome } : {}),
            scorerIds: prediction.selections
              .filter((s) => s.playerId)
              .map((s) => s.playerId as string),
            ...(bySlot.get(MarketType.TO_QUALIFY)?.teamId
              ? { qualifierTeamId: bySlot.get(MarketType.TO_QUALIFY)!.teamId as string }
              : {}),
          },
          actual: {
            // Per the league's knockoutScoreBasis; NINETY_MINUTES by default.
            homeGoals: resolved.homeGoals,
            awayGoals: resolved.awayGoals,
            firstScorerId: null,
            scorerIds: [],
            redCardShown: false,
            corners: null,
            wentToExtraTime: resolved.wentToExtraTime,
            wentToPenalties: resolved.wentToPenalties,
            // Only the deciding leg carries a qualifier, so a leg-1 TO_QUALIFY
            // pick simply never matches (task P4b-06).
            qualifierTeamId: deciding ? (fx.tie?.winnerTeamId ?? null) : null,
          },
          context,
        });

        const result = scorePrediction(facts, config);

        scores.push({
          predictionId: prediction.id,
          ruleSetId: leagueRound.ruleSetId,
          scoringRunId: run.id,
          basePoints: result.basePoints,
          multiplier: result.multiplier,
          points: result.points,
          isExactScore: facts.derived.exactScore,
          isOutcomeCorrect: facts.derived.outcomeCorrect,
          breakdown: result.breakdown as unknown as Prisma.InputJsonValue,
        });
      }
    }

    // ── Round-level boosters ─────────────────────────────────────────
    // WILDCARD_ROUND multiplies the whole round; NO_NEGATIVES floors each
    // fixture at zero; INSURANCE floors the ROUND total at the member's
    // running average. All are applied after per-fixture scoring, because
    // they are statements about the round rather than about one match.
    if (roundBoosterByUser.size > 0) {
      const byUser = new Map<string, Prisma.PredictionScoreCreateManyInput[]>();
      const predictionOwner = new Map<string, string>();
      for (const lf of playable) {
        for (const p of lf.predictions) predictionOwner.set(p.id, p.userId);
      }
      for (const sc of scores) {
        const owner = predictionOwner.get(sc.predictionId);
        if (owner) byUser.set(owner, [...(byUser.get(owner) ?? []), sc]);
      }

      for (const [userId, boosters] of roundBoosterByUser) {
        const userScores = byUser.get(userId) ?? [];
        if (userScores.length === 0) continue;

        for (const booster of boosters) {
          if (booster.type === 'NO_NEGATIVES') {
            for (const sc of userScores) {
              if (Number(sc.points) < 0) {
                sc.points = 0;
                sc.multiplier = 0;
              }
            }
          } else if (booster.type === 'WILDCARD_ROUND') {
            for (const sc of userScores) {
              sc.points = Number(sc.points) * booster.value;
              sc.multiplier = Number(sc.multiplier) * booster.value;
            }
          } else if (booster.type === 'INSURANCE') {
            const total = userScores.reduce((n, sc) => n + Number(sc.points), 0);
            const average = await averageRoundPoints(leagueRound.leagueId, userId);
            if (average !== null && total < average) {
              // Top the round up to the member's average, spread evenly so the
              // per-fixture breakdowns still sum to the round total.
              const topUp = (average - total) / userScores.length;
              for (const sc of userScores) sc.points = Number(sc.points) + topUp;
              log.info({ userId, from: total, to: average }, 'insurance booster applied');
            }
          }
        }
      }
    }

    // Upsert, not append: a rescore replaces the previous score for the same
    // prediction. History lives in the ScoringRun chain (§9.2).
    await prisma.$transaction([
      prisma.predictionScore.deleteMany({
        where: { predictionId: { in: scores.map((s) => s.predictionId) } },
      }),
      prisma.predictionScore.createMany({ data: scores }),
      prisma.prediction.updateMany({
        where: { id: { in: scores.map((s) => s.predictionId) } },
        data: { status: PredictionStatus.SCORED },
      }),
      prisma.scoringRun.update({
        where: { id: run.id },
        data: {
          status: ScoringRunStatus.COMPLETED,
          predictionsScored: scores.length,
          finishedAt: new Date(),
        },
      }),
      prisma.leagueRound.update({
        where: { id: leagueRoundId },
        data: { status: LeagueRoundStatus.PROVISIONAL, scoredAt: new Date() },
      }),
    ]);

    log.info({ leagueRoundId, scored: scores.length, trigger }, 'round scored');
    return { scored: scores.length };
  } catch (err) {
    await prisma.scoringRun.update({
      where: { id: run.id },
      data: {
        status: ScoringRunStatus.FAILED,
        error: err instanceof Error ? err.message.slice(0, 1000) : String(err),
        finishedAt: new Date(),
      },
    });
    throw err;
  }
}
