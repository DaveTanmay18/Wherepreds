import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixtureStatus, LeagueRoundStatus, PredictionStatus, prisma } from '@wp/db';
import { instantiatePreset } from '@wp/scoring';
import { logger } from '../logger.js';
import { lockDueRounds } from '../jobs/lock-rounds.js';
import { computeInputHash, scoreLeagueRound } from '../jobs/scoring.js';
import { rebuildStandings } from '../jobs/standings.service.js';

/**
 * The Phase 3 exit criterion, end to end: a full gameweek predicted, locked,
 * scored and ranked. Runs against the real database because the locking
 * trigger and the partial indexes are part of what is being tested (§17.2).
 */

const T = `pipe${Date.now()}`;
// Unique per run: a hardcoded number collides with any leftover round from a
// previous failed run, and the failure surfaces confusingly in beforeAll.
const ROUND_NUMBER = 900 + (Date.now() % 90);
let leagueId = '';
let leagueRoundId = '';
const fixtureIds: string[] = [];
const leagueFixtureIds: string[] = [];
const users: { id: string; name: string }[] = [];

beforeAll(async () => {
  const season = await prisma.season.findFirstOrThrow({
    where: { competition: { slug: 'premier-league' }, isCurrent: true },
  });

  const home = await prisma.team.create({
    data: { slug: `${T}-h`, name: `${T} Home`, tla: 'HOM' },
  });
  const away = await prisma.team.create({
    data: { slug: `${T}-a`, name: `${T} Away`, tla: 'AWY' },
  });

  const round = await prisma.round.create({
    data: { seasonId: season.id, number: ROUND_NUMBER, name: `${T} round` },
  });

  // Two fixtures, kicking off in the near future so the round is predictable.
  const soon = new Date(Date.now() + 60 * 60_000);
  for (let i = 0; i < 2; i++) {
    const f = await prisma.fixture.create({
      data: {
        seasonId: season.id,
        roundId: round.id,
        homeTeamId: home.id,
        awayTeamId: away.id,
        kickoffAt: new Date(soon.getTime() + i * 60_000),
        status: FixtureStatus.SCHEDULED,
      },
    });
    fixtureIds.push(f.id);
  }

  for (const name of ['alice', 'bob', 'carol']) {
    const u = await prisma.user.create({
      data: {
        email: `${T}-${name}@pipe.test`,
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

  const ruleSet = await prisma.ruleSet.create({
    data: { leagueId, version: 1, config: instantiatePreset('classic'), isActive: true },
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
      deadlineAt: soon,
      status: LeagueRoundStatus.UPCOMING,
    },
  });
  leagueRoundId = lr.id;

  for (const [i, fid] of fixtureIds.entries()) {
    const lf = await prisma.leagueFixture.create({
      data: { leagueRoundId, fixtureId: fid, position: i + 1 },
    });
    leagueFixtureIds.push(lf.id);
  }
}, 180_000);

afterAll(async () => {
  // Order matters: PredictionLeague.owner is RESTRICT, so leagues go first.
  // Scoped to THIS run's ids so a parallel or leftover run is untouched.
  await prisma.predictionLeague.deleteMany({ where: { id: leagueId } });
  await prisma.fixture.deleteMany({ where: { id: { in: fixtureIds } } });
  await prisma.round.deleteMany({ where: { name: `${T} round` } });
  await prisma.team.deleteMany({ where: { slug: { startsWith: T } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  await prisma.$disconnect();
}, 120_000);

describe('predict → lock → score → rank', () => {
  it('accepts predictions before the deadline', async () => {
    // alice nails fixture 1 exactly; bob gets the result only; carol is wrong.
    const picks: [string, number, number][] = [
      [users[0]!.id, 2, 1],
      [users[1]!.id, 3, 1],
      [users[2]!.id, 0, 2],
    ];

    for (const [userId, h, a] of picks) {
      const p = await prisma.prediction.create({
        data: {
          leagueFixtureId: leagueFixtureIds[0]!,
          userId,
          status: PredictionStatus.SUBMITTED,
          submittedAt: new Date(),
        },
      });
      await prisma.predictionSelection.create({
        data: { predictionId: p.id, market: 'EXACT_SCORE', homeGoals: h, awayGoals: a },
      });
    }

    expect(await prisma.prediction.count({ where: { leagueFixtureId: leagueFixtureIds[0] } })).toBe(
      3,
    );
  });

  it('locks the round once the deadline passes, and fills in MISSED', async () => {
    await prisma.leagueRound.update({
      where: { id: leagueRoundId },
      // ⚠️ A full minute, not a second. `lockDueRounds` compares against
      // Postgres `now()` (§10.2 — the server clock is the only authority),
      // while this line uses Node's. The two machines here differ by ~1.4s, so
      // "one second ago" by Node was still in the FUTURE by the database and
      // nothing locked. Any margin smaller than the skew makes this test fail
      // for a reason that has nothing to do with locking.
      data: { deadlineAt: new Date(Date.now() - 60_000) },
    });

    const result = await lockDueRounds(logger);
    expect(result.locked).toBeGreaterThanOrEqual(1);

    const round = await prisma.leagueRound.findUniqueOrThrow({ where: { id: leagueRoundId } });
    expect(round.status).toBe(LeagueRoundStatus.LOCKED);

    // Nobody predicted fixture 2, so all three get a MISSED placeholder —
    // otherwise the standings would have a ragged table (§10.3).
    const missed = await prisma.prediction.count({
      where: { leagueFixtureId: leagueFixtureIds[1], status: PredictionStatus.MISSED },
    });
    expect(missed).toBe(3);
  });

  it('refuses to edit a locked prediction — the trigger, not just the service', async () => {
    const locked = await prisma.prediction.findFirstOrThrow({
      where: { leagueFixtureId: leagueFixtureIds[0], userId: users[0]!.id },
    });
    expect(locked.lockedAt).not.toBeNull();

    await expect(
      prisma.prediction.update({ where: { id: locked.id }, data: { note: 'cheating' } }),
    ).rejects.toThrow(/is locked/);
  });

  it('ALLOWS the system to change status on a locked prediction', async () => {
    // The guard protects the user's PICK, not the bookkeeping. Scoring must be
    // able to move LOCKED -> SCORED, or the pipeline deadlocks against its own
    // safety net — which is exactly what this test caught.
    const locked = await prisma.prediction.findFirstOrThrow({
      where: { leagueFixtureId: leagueFixtureIds[0], userId: users[0]!.id },
    });
    await expect(
      prisma.prediction.update({
        where: { id: locked.id },
        data: { status: PredictionStatus.SCORED },
      }),
    ).resolves.toBeTruthy();

    await prisma.prediction.update({
      where: { id: locked.id },
      data: { status: PredictionStatus.LOCKED },
    });
  });

  it('will not score a round whose fixtures have not finished', async () => {
    const r = await scoreLeagueRound(leagueRoundId, 'test', logger);
    expect(r.scored).toBe(0);
    expect(r.skipped).toContain('not all fixtures finished');
  });

  it('scores the round once results are in', async () => {
    await prisma.fixture.updateMany({
      where: { id: { in: fixtureIds } },
      data: {
        status: FixtureStatus.FINISHED,
        homeGoals: 2,
        awayGoals: 1,
        outcome: 'HOME',
        resultVersion: 1,
      },
    });

    const r = await scoreLeagueRound(leagueRoundId, 'test', logger);
    expect(r.scored).toBe(6); // 3 members x 2 fixtures

    const scores = await prisma.predictionScore.findMany({
      where: { prediction: { leagueFixtureId: leagueFixtureIds[0] } },
      include: { prediction: { select: { userId: true } } },
    });
    const byUser = new Map(scores.map((s) => [s.prediction.userId, Number(s.points)]));

    // Classic: exact 5, result 2 (exclusive), wrong 0.
    expect(byUser.get(users[0]!.id)).toBe(5);
    expect(byUser.get(users[1]!.id)).toBe(2);
    expect(byUser.get(users[2]!.id)).toBe(0);
  });

  it('stores a breakdown that names every rule that fired', async () => {
    const score = await prisma.predictionScore.findFirstOrThrow({
      where: { prediction: { leagueFixtureId: leagueFixtureIds[0], userId: users[0]!.id } },
    });
    const breakdown = score.breakdown as { ruleId: string; label: string; points: number }[];
    expect(breakdown.some((b) => b.ruleId === 'exact_score')).toBe(true);
    // This is what answers "why did I get 5 points?" (§5.1).
    expect(breakdown[0]!.label).toBeTruthy();
  });

  it('is IDEMPOTENT — re-running with identical inputs changes nothing', async () => {
    const before = await prisma.predictionScore.count();
    const r = await scoreLeagueRound(leagueRoundId, 'test', logger);
    expect(r.scored).toBe(0);
    expect(r.skipped).toContain('already scored');
    expect(await prisma.predictionScore.count()).toBe(before);
  });

  it('RESCORES when a result is corrected', async () => {
    // A VAR reversal: 2-1 becomes 1-1. resultVersion bumps, so the input hash
    // changes and the previous run is superseded (§9.2).
    await prisma.fixture.update({
      where: { id: fixtureIds[0]! },
      data: { homeGoals: 1, awayGoals: 1, outcome: 'DRAW', resultVersion: 2 },
    });

    const r = await scoreLeagueRound(leagueRoundId, 'correction', logger);
    expect(r.scored).toBe(6);

    const scores = await prisma.predictionScore.findMany({
      where: { prediction: { leagueFixtureId: leagueFixtureIds[0] } },
      include: { prediction: { select: { userId: true } } },
    });
    const byUser = new Map(scores.map((s) => [s.prediction.userId, Number(s.points)]));

    // Nobody predicted a draw, so everyone drops to zero on this fixture.
    expect(byUser.get(users[0]!.id)).toBe(0);
    expect(byUser.get(users[1]!.id)).toBe(0);

    const superseded = await prisma.scoringRun.count({
      where: { leagueRoundId, status: 'SUPERSEDED' },
    });
    expect(superseded).toBeGreaterThanOrEqual(1);
  });

  it('builds a ranked standings table', async () => {
    // Put the original result back so there is something to rank.
    await prisma.fixture.update({
      where: { id: fixtureIds[0]! },
      data: { homeGoals: 2, awayGoals: 1, outcome: 'HOME', resultVersion: 3 },
    });
    await scoreLeagueRound(leagueRoundId, 'test', logger);

    const result = await rebuildStandings(leagueId, 1, logger);
    expect(result.entries).toBe(3);

    const table = await prisma.standingEntry.findMany({
      where: { leagueId },
      orderBy: { position: 'asc' },
      include: { user: { select: { displayName: true } } },
    });

    expect(table[0]!.user.displayName).toBe('alice');
    expect(Number(table[0]!.totalPoints)).toBe(5);
    expect(table[0]!.exactScores).toBe(1);
    expect(table[1]!.user.displayName).toBe('bob');
    expect(Number(table[1]!.totalPoints)).toBe(2);
    expect(table[2]!.user.displayName).toBe('carol');
    expect(Number(table[2]!.totalPoints)).toBe(0);
  });
});

describe('input hash', () => {
  it('is stable regardless of fixture order', () => {
    const a = computeInputHash('r1', 1, [
      { fixtureId: 'f1', resultVersion: 1 },
      { fixtureId: 'f2', resultVersion: 2 },
    ]);
    const b = computeInputHash('r1', 1, [
      { fixtureId: 'f2', resultVersion: 2 },
      { fixtureId: 'f1', resultVersion: 1 },
    ]);
    expect(a).toBe(b);
  });

  it('changes when a result version changes', () => {
    const a = computeInputHash('r1', 1, [{ fixtureId: 'f1', resultVersion: 1 }]);
    const b = computeInputHash('r1', 1, [{ fixtureId: 'f1', resultVersion: 2 }]);
    expect(a).not.toBe(b);
  });

  it('changes when the rule set version changes', () => {
    // A rules change must rescore, not silently reuse the old points (§8.7).
    const a = computeInputHash('r1', 1, [{ fixtureId: 'f1', resultVersion: 1 }]);
    const b = computeInputHash('r1', 2, [{ fixtureId: 'f1', resultVersion: 1 }]);
    expect(a).not.toBe(b);
  });
});
