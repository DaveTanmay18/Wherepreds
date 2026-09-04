import {
  DeadlineStrategy,
  LeagueRoundStatus,
  type MarketType,
  PredictionStatus,
  prisma,
  type Prisma,
} from '@wp/db';
import { conflict, notFound } from '../errors.js';

/**
 * Prediction writes (tasks P3-01, P3-05, P3-06, P3-07).
 *
 * The whole product rests on one guarantee: nobody may predict a match whose
 * result they could already know. That is enforced here, server-side, against
 * the DATABASE clock — and again by a trigger (§7.2) so no future code path
 * can bypass it.
 */

/** Populates a league round with fixtures. Idempotent (task P3-01). */
export async function materialiseFixtures(leagueRoundId: string): Promise<number> {
  const leagueRound = await prisma.leagueRound.findUniqueOrThrow({
    where: { id: leagueRoundId },
    include: { ruleSet: true },
  });

  const fixtures = await prisma.fixture.findMany({
    where: { roundId: leagueRound.roundId },
    orderBy: { kickoffAt: 'asc' },
    select: { id: true, kickoffAt: true },
  });

  if (fixtures.length === 0) return 0;

  const limit = leagueRound.ruleSet.fixturesPerRound ?? fixtures.length;
  const chosen = fixtures.slice(0, limit);
  const offsetMs = leagueRound.ruleSet.deadlineOffsetMin * 60_000;
  const perFixture = leagueRound.ruleSet.deadlineStrategy === DeadlineStrategy.PER_FIXTURE_KICKOFF;

  await prisma.leagueFixture.createMany({
    data: chosen.map((f, i) => ({
      leagueRoundId,
      fixtureId: f.id,
      position: i + 1,
      // Only PER_FIXTURE_KICKOFF gives a fixture its own deadline; otherwise
      // the round deadline governs and this stays null (§10.1).
      deadlineAt: perFixture ? new Date(f.kickoffAt.getTime() - offsetMs) : null,
    })),
    skipDuplicates: true,
  });

  // Deadline may have shifted now that fixtures are known (an undrawn knockout
  // round becoming real), so clear the provisional flag.
  if (leagueRound.isProvisional) {
    const first = chosen[0]!;
    await prisma.leagueRound.update({
      where: { id: leagueRoundId },
      data: {
        isProvisional: false,
        deadlineAt: new Date(first.kickoffAt.getTime() - offsetMs),
      },
    });
  }

  return chosen.length;
}

/**
 * The effective deadline for a fixture: its own if set, else the round's.
 * `now` comes from Postgres, never from the Node process — clock skew between
 * API replicas would otherwise be an exploitable window (§10.2).
 */
export type DeadlineCheck = { leagueFixtureId: string; deadlineAt: Date; passed: boolean };

export async function checkDeadlines(
  leagueRoundId: string,
): Promise<{ now: Date; roundStatus: LeagueRoundStatus; byFixture: Map<string, DeadlineCheck> }> {
  // One round-trip, not two. `now()` must still come from the DATABASE (§10.2),
  // but it does not need its own query — every round-trip on a remote
  // connection is ~1.4s from a dev machine.
  const [round, [{ now }]] = await Promise.all([
    prisma.leagueRound.findUniqueOrThrow({
      where: { id: leagueRoundId },
      include: { fixtures: { select: { id: true, deadlineAt: true, isVoided: true } } },
    }),
    prisma.$queryRaw<[{ now: Date }]>`SELECT now() AS now`,
  ]);

  const byFixture = new Map<string, DeadlineCheck>();
  for (const f of round.fixtures) {
    const deadlineAt = f.deadlineAt ?? round.deadlineAt;
    byFixture.set(f.id, {
      leagueFixtureId: f.id,
      deadlineAt,
      passed: f.isVoided || deadlineAt.getTime() <= now.getTime(),
    });
  }

  return { now, roundStatus: round.status, byFixture };
}

export type SelectionInput = {
  market: MarketType;
  homeGoals?: number;
  awayGoals?: number;
  outcome?: 'HOME' | 'DRAW' | 'AWAY';
  booleanValue?: boolean;
  numericValue?: number;
  overSelected?: boolean;
  playerId?: string;
  teamId?: string;
};

export type PredictionInput = {
  leagueFixtureId: string;
  selections: SelectionInput[];
  note?: string;
};

export type UpsertOutcome = {
  saved: string[];
  rejected: { leagueFixtureId: string; code: string; detail: string }[];
};

/**
 * Bulk upsert for a whole round (§12.2, task P3-06).
 *
 * Partial success is reported PER FIXTURE rather than failing the batch: one
 * late kickoff must not discard nine valid picks. That is the difference
 * between a user losing one prediction and losing their whole gameweek.
 */
export async function upsertPredictions(
  userId: string,
  leagueId: string,
  leagueRoundId: string,
  predictions: PredictionInput[],
  submit: boolean,
): Promise<UpsertOutcome> {
  // Membership is NOT re-checked here: requireMember has already resolved it
  // into req.league for this request (§15.2). Checking twice cost a round-trip
  // on the single most latency-sensitive write in the product.
  void leagueId;

  const { roundStatus, byFixture } = await checkDeadlines(leagueRoundId);

  if (roundStatus !== LeagueRoundStatus.UPCOMING) {
    throw conflict(
      'round-locked',
      'Round locked',
      'This round is no longer accepting predictions.',
    );
  }

  const accepted: PredictionInput[] = [];
  const rejected: UpsertOutcome['rejected'] = [];

  for (const p of predictions) {
    const check = byFixture.get(p.leagueFixtureId);

    if (!check) {
      rejected.push({
        leagueFixtureId: p.leagueFixtureId,
        code: 'NOT_IN_ROUND',
        detail: 'That fixture is not part of this round.',
      });
    } else if (check.passed) {
      rejected.push({
        leagueFixtureId: p.leagueFixtureId,
        code: 'DEADLINE_PASSED',
        detail: `Closed at ${check.deadlineAt.toISOString()}.`,
      });
    } else {
      accepted.push(p);
    }
  }

  if (accepted.length === 0) return { saved: [], rejected };

  /**
   * ⚠️ BATCHED DELIBERATELY. This ran one interactive transaction per fixture —
   * three sequential queries each — so a ten-match round cost ~30 round-trips
   * and took the best part of a minute against a remote database. This is the
   * most latency-sensitive write in the product: people submit in the last
   * minutes before kickoff, on a phone, and a spinner that long reads as a
   * failure. Now it is three round-trips regardless of round size.
   */
  const status = submit ? PredictionStatus.SUBMITTED : PredictionStatus.DRAFT;
  const submittedAt = submit ? new Date() : null;
  const ids = accepted.map((p) => p.leagueFixtureId);

  // 1. Which of these already exist?
  const existing = await prisma.prediction.findMany({
    where: { userId, leagueFixtureId: { in: ids } },
    select: { id: true, leagueFixtureId: true },
  });
  const existingByFixture = new Map(existing.map((e) => [e.leagueFixtureId, e.id]));

  // 2. Create the missing ones in a single statement.
  const toCreate = accepted.filter((p) => !existingByFixture.has(p.leagueFixtureId));
  if (toCreate.length) {
    const created = await prisma.prediction.createManyAndReturn({
      data: toCreate.map((p) => ({
        leagueFixtureId: p.leagueFixtureId,
        userId,
        status,
        submittedAt,
        note: p.note ?? null,
      })),
      select: { id: true, leagueFixtureId: true },
    });
    for (const c of created) existingByFixture.set(c.leagueFixtureId, c.id);
  }

  // 3. Updates, selection wipe and selection insert, all in ONE round-trip.
  const predictionIds = accepted
    .map((p) => existingByFixture.get(p.leagueFixtureId))
    .filter((id): id is string => !!id);

  const selectionRows: Prisma.PredictionSelectionCreateManyInput[] = accepted.flatMap((p) => {
    const predictionId = existingByFixture.get(p.leagueFixtureId);
    if (!predictionId) return [];
    return p.selections.map((s) => ({
      predictionId,
      market: s.market,
      homeGoals: s.homeGoals ?? null,
      awayGoals: s.awayGoals ?? null,
      outcome: s.outcome ?? null,
      booleanValue: s.booleanValue ?? null,
      numericValue: s.numericValue ?? null,
      overSelected: s.overSelected ?? null,
      playerId: s.playerId ?? null,
      teamId: s.teamId ?? null,
    }));
  });

  // Every update sets the SAME status and submittedAt, so one updateMany
  // replaces N individual updates. Prisma does not pipeline the array form of
  // $transaction over the wire, so ten updates were ten round-trips — the bulk
  // of the submit latency.
  const withNotes = accepted.filter((p) => p.note !== undefined);

  await prisma.$transaction([
    prisma.prediction.updateMany({
      where: { id: { in: predictionIds } },
      data: { status, submittedAt },
    }),
    // Notes are per-prediction and usually absent, so they only cost a
    // statement when someone actually wrote one.
    ...withNotes.map((p) =>
      prisma.prediction.update({
        where: { id: existingByFixture.get(p.leagueFixtureId)! },
        data: { note: p.note ?? null },
      }),
    ),
    // Replace the selection set wholesale: a market removed from the request
    // must disappear, not linger from an earlier save.
    prisma.predictionSelection.deleteMany({ where: { predictionId: { in: predictionIds } } }),
    ...(selectionRows.length
      ? [prisma.predictionSelection.createMany({ data: selectionRows })]
      : []),
  ]);

  return { saved: accepted.map((p) => p.leagueFixtureId), rejected };
}

/** Flips every draft in the round to SUBMITTED (task P3-07). */
export async function submitRound(userId: string, leagueRoundId: string): Promise<number> {
  const { byFixture } = await checkDeadlines(leagueRoundId);
  const open = [...byFixture.values()].filter((c) => !c.passed).map((c) => c.leagueFixtureId);

  const result = await prisma.prediction.updateMany({
    where: {
      userId,
      leagueFixtureId: { in: open },
      status: PredictionStatus.DRAFT,
      lockedAt: null,
    },
    data: { status: PredictionStatus.SUBMITTED, submittedAt: new Date() },
  });

  return result.count;
}

/** A round with its fixtures and the caller's picks — one request per screen. */
export async function getRoundForUser(leagueId: string, sequence: number, userId: string) {
  const leagueRound = await prisma.leagueRound.findFirst({
    where: { leagueId, sequence },
    include: {
      round: { select: { name: true, type: true, number: true, isTwoLegged: true } },
      ruleSet: { select: { config: true, allowEdits: true, revealPicksBeforeDeadline: true } },
      fixtures: {
        orderBy: { position: 'asc' },
        include: {
          fixture: {
            include: {
              homeTeam: {
                select: {
                  id: true,
                  slug: true,
                  name: true,
                  shortName: true,
                  tla: true,
                  crestUrl: true,
                },
              },
              awayTeam: {
                select: {
                  id: true,
                  slug: true,
                  name: true,
                  shortName: true,
                  tla: true,
                  crestUrl: true,
                },
              },
              tie: { select: { id: true, teamAId: true, teamBId: true, settledAt: true } },
            },
          },
          predictions: {
            where: { userId },
            include: { selections: true, score: true },
          },
        },
      },
    },
  });

  if (!leagueRound) throw notFound('No such round.');

  const [{ now }] = await prisma.$queryRaw<[{ now: Date }]>`SELECT now() AS now`;

  return {
    id: leagueRound.id,
    sequence: leagueRound.sequence,
    status: leagueRound.status,
    deadlineAt: leagueRound.deadlineAt,
    isProvisional: leagueRound.isProvisional,
    // Sent so the client can compute a countdown against server time rather
    // than a device clock that may be minutes out (§13.3).
    serverTime: now,
    round: leagueRound.round,
    markets: (leagueRound.ruleSet.config as { markets: string[] }).markets,
    allowEdits: leagueRound.ruleSet.allowEdits,
    fixtures: leagueRound.fixtures.map((lf) => ({
      leagueFixtureId: lf.id,
      // The underlying football fixture, so the UI can link to the match
      // centre. Predictions still attach to leagueFixtureId, never this.
      fixtureId: lf.fixture.id,
      position: lf.position,
      weight: lf.weight,
      isVoided: lf.isVoided,
      deadlineAt: lf.deadlineAt ?? leagueRound.deadlineAt,
      kickoffAt: lf.fixture.kickoffAt,
      status: lf.fixture.status,
      homeTeam: lf.fixture.homeTeam,
      awayTeam: lf.fixture.awayTeam,
      legNumber: lf.fixture.legNumber,
      // TO_QUALIFY is asked on the deciding leg only — leg 2, or a one-off
      // final (§8.8, task P4b-06). Leg 1 must not offer the pick at all.
      isDecidingLeg: lf.fixture.tie
        ? leagueRound.round.type === 'FINAL' || lf.fixture.legNumber === 2
        : false,
      result:
        lf.fixture.homeGoals === null
          ? null
          : { home: lf.fixture.homeGoals, away: lf.fixture.awayGoals },
      prediction: lf.predictions[0]
        ? {
            status: lf.predictions[0].status,
            note: lf.predictions[0].note,
            selections: lf.predictions[0].selections,
            points: lf.predictions[0].score?.points ?? null,
            breakdown: lf.predictions[0].score?.breakdown ?? null,
          }
        : null,
    })),
  };
}
