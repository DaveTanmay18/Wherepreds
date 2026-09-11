import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixtureStatus, LeagueRoundStatus, PredictionStatus, prisma } from '@wp/db';
import { instantiatePreset } from '@wp/scoring';
import { logger } from '../logger.js';
import { scoreLeagueRound } from '../jobs/scoring.js';

/**
 * Boosters applied during scoring (task P5-03).
 *
 * Boosters change points, so nothing here is cosmetic — a booster that fails
 * to apply, or applies twice, is a wrong leaderboard.
 */

const T = `bst${Date.now()}`;
const ROUND_NUMBER = 700 + (Date.now() % 90);
let leagueId = '';
let leagueRoundId = '';
let roundId = '';
const leagueFixtureIds: string[] = [];
const fixtureIds: string[] = [];
const users: { id: string; name: string }[] = [];

beforeAll(async () => {
  const season = await prisma.season.findFirstOrThrow({
    where: { competition: { slug: 'premier-league' }, isCurrent: true },
  });

  const home = await prisma.team.create({ data: { slug: `${T}-h`, name: `${T} Home` } });
  const away = await prisma.team.create({ data: { slug: `${T}-a`, name: `${T} Away` } });

  const round = await prisma.round.create({
    data: { seasonId: season.id, number: ROUND_NUMBER, name: `${T} round` },
  });
  roundId = round.id;

  // Two fixtures, both already finished 2-1.
  for (let i = 0; i < 2; i++) {
    const f = await prisma.fixture.create({
      data: {
        seasonId: season.id,
        roundId: round.id,
        homeTeamId: home.id,
        awayTeamId: away.id,
        kickoffAt: new Date(Date.now() - (2 - i) * 3600_000),
        status: FixtureStatus.FINISHED,
        homeGoals: 2,
        awayGoals: 1,
        outcome: 'HOME',
        resultVersion: 1,
      },
    });
    fixtureIds.push(f.id);
  }

  for (const name of ['plain', 'banker', 'noneg']) {
    const u = await prisma.user.create({
      data: {
        email: `${T}-${name}@bst.test`,
        username: `${T}${name}`.slice(0, 20),
        displayName: name,
      },
    });
    users.push({ id: u.id, name });
  }

  const league = await prisma.predictionLeague.create({
    data: { slug: T, name: T, ownerId: users[0]!.id, seasonId: season.id },
  });
  leagueId = league.id;

  // Survival can go negative, which is what NO_NEGATIVES needs to bite on.
  const config = instantiatePreset('survival');
  // penaltyIfWrong is 0 here on purpose: this suite pins MULTIPLICATION and
  // the NO_NEGATIVES floor. The penalty itself is covered exhaustively in the
  // pure engine (packages/scoring), and the existing "-3 becomes 0" assertion
  // already proves the floor catches negatives whatever produced them.
  config.boosters = [
    { type: 'BANKER', value: 2, usesPerSeason: 5, penaltyIfWrong: 0 },
    { type: 'NO_NEGATIVES', value: 1, usesPerSeason: 2, penaltyIfWrong: 0 },
  ];
  const ruleSet = await prisma.ruleSet.create({
    data: { leagueId, version: 1, config, isActive: true },
  });

  await prisma.leagueMembership.createMany({
    data: users.map((u, i) => ({
      leagueId,
      userId: u.id,
      role: i === 0 ? ('OWNER' as const) : ('MEMBER' as const),
      status: 'ACTIVE' as const,
    })),
  });

  const lr = await prisma.leagueRound.create({
    data: {
      leagueId,
      roundId: round.id,
      ruleSetId: ruleSet.id,
      sequence: 1,
      deadlineAt: new Date(Date.now() - 3600_000),
      status: LeagueRoundStatus.LOCKED,
    },
  });
  leagueRoundId = lr.id;

  for (const [i, fid] of fixtureIds.entries()) {
    const lf = await prisma.leagueFixture.create({
      data: { leagueRoundId, fixtureId: fid, position: i + 1 },
    });
    leagueFixtureIds.push(lf.id);
  }

  // ⚠️ Order matters, and it mirrors the real flow. Both guards enforce it:
  // selections cannot be written once the parent is locked, and boosterUsageId
  // is a protected column so a nomination cannot be attached after lock (§7.2).
  // So: place boosters, make predictions, then lock — exactly as a member does
  // before the deadline.
  const bankerUsage = await prisma.boosterUsage.create({
    data: { userId: users[1]!.id, leagueRoundId, type: 'BANKER', resolvedValue: 2 },
  });
  await prisma.boosterUsage.create({
    data: { userId: users[2]!.id, leagueRoundId, type: 'NO_NEGATIVES', resolvedValue: 1 },
  });

  // Everyone predicts 2-1 on fixture 1 (exact, +5) and 0-3 on fixture 2
  // (wrong result under Survival, negative).
  const createdPredictionIds: string[] = [];
  for (const u of users) {
    for (const [i, lfId] of leagueFixtureIds.entries()) {
      const p = await prisma.prediction.create({
        data: {
          leagueFixtureId: lfId,
          userId: u.id,
          status: PredictionStatus.SUBMITTED,
          submittedAt: new Date(Date.now() - 7200_000),
          // The banker nominates fixture 1 only.
          ...(u.id === users[1]!.id && i === 0 ? { boosterUsageId: bankerUsage.id } : {}),
        },
      });
      await prisma.predictionSelection.create({
        data: {
          predictionId: p.id,
          market: 'EXACT_SCORE',
          homeGoals: i === 0 ? 2 : 0,
          awayGoals: i === 0 ? 1 : 3,
        },
      });
      createdPredictionIds.push(p.id);
    }
  }

  await prisma.prediction.updateMany({
    where: { id: { in: createdPredictionIds } },
    data: { status: PredictionStatus.LOCKED, lockedAt: new Date(Date.now() - 3600_000) },
  });
}, 240_000);

afterAll(async () => {
  /**
   * ⚠️ Predictions and booster usages go FIRST, explicitly.
   *
   * Deleting the league cascades to BoosterUsage, and the SET NULL that puts
   * on `prediction.booster_usage_id` is an UPDATE — which the locked-
   * prediction trigger refuses, correctly, once the round has locked. The
   * cascade order is not guaranteed, so this only failed intermittently.
   * DELETE is not guarded (the trigger is BEFORE UPDATE), so removing the
   * predictions outright sidesteps the update entirely.
   */
  await prisma.prediction.deleteMany({
    where: { leagueFixture: { leagueRound: { leagueId } } },
  });
  await prisma.boosterUsage.deleteMany({ where: { leagueRound: { leagueId } } });
  await prisma.predictionLeague.deleteMany({ where: { id: leagueId } });
  await prisma.fixture.deleteMany({ where: { id: { in: fixtureIds } } });
  await prisma.round.deleteMany({ where: { id: roundId } });
  await prisma.team.deleteMany({ where: { slug: { startsWith: T } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  await prisma.$disconnect();
}, 120_000);

async function pointsFor(userName: string) {
  const user = users.find((u) => u.name === userName)!;
  const scores = await prisma.predictionScore.findMany({
    where: { prediction: { userId: user.id, leagueFixture: { leagueRoundId } } },
    include: { prediction: { select: { leagueFixtureId: true } } },
  });
  const byFixture = new Map(scores.map((s) => [s.prediction.leagueFixtureId, Number(s.points)]));
  return {
    fixture1: byFixture.get(leagueFixtureIds[0]!) ?? 0,
    fixture2: byFixture.get(leagueFixtureIds[1]!) ?? 0,
    total: scores.reduce((n, s) => n + Number(s.points), 0),
  };
}

describe('boosters during scoring', () => {
  it('scores the round', async () => {
    const r = await scoreLeagueRound(leagueRoundId, 'test', logger);
    expect(r.scored).toBe(6); // 3 members x 2 fixtures
  });

  it('leaves an unboosted member at the plain total', async () => {
    const p = await pointsFor('plain');
    // Survival: exact score +5; wrong result -2 and wildly off -1 = -3.
    expect(p.fixture1).toBe(5);
    expect(p.fixture2).toBe(-3);
    expect(p.total).toBe(2);
  });

  it('DOUBLES only the nominated fixture for a banker', async () => {
    const p = await pointsFor('banker');
    expect(p.fixture1).toBe(10);
    // The other fixture is untouched — a banker is one match, not the round.
    expect(p.fixture2).toBe(-3);
    expect(p.total).toBe(7);
  });

  it('floors every negative fixture with NO_NEGATIVES, without inflating wins', async () => {
    const p = await pointsFor('noneg');
    expect(p.fixture1).toBe(5);
    expect(p.fixture2).toBe(0);
    expect(p.total).toBe(5);
  });

  it('records the booster multiplier so the breakdown reconstructs', async () => {
    const user = users.find((u) => u.name === 'banker')!;
    const score = await prisma.predictionScore.findFirstOrThrow({
      where: {
        prediction: { userId: user.id, leagueFixtureId: leagueFixtureIds[0]! },
      },
    });
    // The UI rebuilds points from basePoints x multiplier, so the booster must
    // show up in the multiplier rather than being applied invisibly.
    expect(Number(score.multiplier)).toBe(2);
    expect(Number(score.basePoints)).toBe(5);
    expect(Number(score.points)).toBe(10);
  });

  it('is still idempotent with boosters in play', async () => {
    const before = await prisma.predictionScore.count({
      where: { prediction: { leagueFixture: { leagueRoundId } } },
    });
    const r = await scoreLeagueRound(leagueRoundId, 'test', logger);
    expect(r.scored).toBe(0);
    expect(
      await prisma.predictionScore.count({
        where: { prediction: { leagueFixture: { leagueRoundId } } },
      }),
    ).toBe(before);
  });
});
