import { afterAll, describe, expect, it } from 'vitest';
import { prisma, RoundType, TieDecider } from '@wp/db';
import { logger } from '../logger.js';
import { buildTies, resolveTies } from '../jobs/ties.js';

/**
 * Tie resolution (task P1b-14).
 *
 * Runs against synthetic fixtures so every branch can be forced — aggregate,
 * extra time, penalties, and the unresolved case. The real 2025/26 UCL is
 * covered separately by the assertions at the bottom, which check the actual
 * ingested bracket.
 */

const T = `tie${Date.now()}`;
const ROUND_BASE = 800 + (Date.now() % 80);
const made: { teams: string[]; rounds: string[]; fixtures: string[] } = {
  teams: [],
  rounds: [],
  fixtures: [],
};
let seasonId = '';

async function team(name: string) {
  const t = await prisma.team.create({ data: { slug: `${T}-${name}`, name: `${T} ${name}` } });
  made.teams.push(t.id);
  return t.id;
}

/** Two-legged tie with explicit leg scores, ET and penalties. */
async function twoLeggedTie(opts: {
  offset: number;
  a: string;
  b: string;
  leg1: [number, number];
  leg2: [number, number];
  et?: [number, number];
  pens?: [number, number];
}) {
  const round = await prisma.round.create({
    data: {
      seasonId,
      number: ROUND_BASE + opts.offset,
      name: `${T} ko ${opts.offset}`,
      type: RoundType.QUARTER_FINAL,
      isTwoLegged: true,
    },
  });
  made.rounds.push(round.id);

  const base = Date.now() - 10 * 24 * 3600_000;

  // Leg 1: A at home. Leg 2: B at home, carrying any ET/penalties.
  const f1 = await prisma.fixture.create({
    data: {
      seasonId,
      roundId: round.id,
      homeTeamId: opts.a,
      awayTeamId: opts.b,
      kickoffAt: new Date(base),
      status: 'FINISHED',
      homeGoals: opts.leg1[0],
      awayGoals: opts.leg1[1],
    },
  });
  const f2 = await prisma.fixture.create({
    data: {
      seasonId,
      roundId: round.id,
      homeTeamId: opts.b,
      awayTeamId: opts.a,
      kickoffAt: new Date(base + 7 * 24 * 3600_000),
      status: 'FINISHED',
      homeGoals: opts.leg2[0],
      awayGoals: opts.leg2[1],
      ...(opts.et ? { homeGoalsEt: opts.et[0], awayGoalsEt: opts.et[1] } : {}),
      ...(opts.pens ? { homePenalties: opts.pens[0], awayPenalties: opts.pens[1] } : {}),
    },
  });
  made.fixtures.push(f1.id, f2.id);
  return round.id;
}

afterAll(async () => {
  await prisma.fixture.deleteMany({ where: { id: { in: made.fixtures } } });
  await prisma.tie.deleteMany({ where: { roundId: { in: made.rounds } } });
  await prisma.round.deleteMany({ where: { id: { in: made.rounds } } });
  await prisma.team.deleteMany({ where: { id: { in: made.teams } } });
  await prisma.$disconnect();
}, 120_000);

describe('tie resolution', () => {
  it('decides on aggregate', async () => {
    const season = await prisma.season.findFirstOrThrow({
      where: { competition: { slug: 'champions-league' }, isCurrent: true },
    });
    seasonId = season.id;

    const a = await team('agg-a');
    const b = await team('agg-b');
    // A wins 3-1 on aggregate (2-0 then 1-1).
    const roundId = await twoLeggedTie({ offset: 1, a, b, leg1: [2, 0], leg2: [1, 1] });

    await buildTies(seasonId, logger);
    await resolveTies(seasonId, logger);

    const tie = await prisma.tie.findFirstOrThrow({ where: { roundId } });
    expect(tie.aggregateA).toBe(3);
    expect(tie.aggregateB).toBe(1);
    expect(tie.winnerTeamId).toBe(a);
    expect(tie.decidedBy).toBe(TieDecider.AGGREGATE);
    expect(tie.settledAt).not.toBeNull();
  });

  it('decides on extra time when ET breaks a level aggregate', async () => {
    const a = await team('et-a');
    const b = await team('et-b');
    // 1-1 then 1-1 = level; B scores once in extra time at home.
    const roundId = await twoLeggedTie({
      offset: 2,
      a,
      b,
      leg1: [1, 1],
      leg2: [1, 1],
      et: [1, 0],
    });

    await buildTies(seasonId, logger);
    await resolveTies(seasonId, logger);

    const tie = await prisma.tie.findFirstOrThrow({ where: { roundId } });
    expect(tie.winnerTeamId).toBe(b);
    expect(tie.decidedBy).toBe(TieDecider.EXTRA_TIME);
    // ET goals count towards the aggregate — away goals were abolished in 2021.
    expect(tie.aggregateB).toBe(3);
  });

  it('decides on penalties when still level after extra time', async () => {
    const a = await team('pk-a');
    const b = await team('pk-b');
    const roundId = await twoLeggedTie({
      offset: 3,
      a,
      b,
      leg1: [0, 0],
      leg2: [1, 1],
      et: [0, 0],
      pens: [2, 4], // leg 2 is at B's ground, so B scores 2 and A scores 4
    });

    await buildTies(seasonId, logger);
    await resolveTies(seasonId, logger);

    const tie = await prisma.tie.findFirstOrThrow({ where: { roundId } });
    expect(tie.aggregateA).toBe(tie.aggregateB);
    expect(tie.decidedBy).toBe(TieDecider.PENALTIES);
    // A took 4 penalties as the away side in leg 2.
    expect(tie.winnerTeamId).toBe(a);
  });

  it('leaves a level tie with no shootout UNSETTLED rather than inventing a winner', async () => {
    const a = await team('lvl-a');
    const b = await team('lvl-b');
    const roundId = await twoLeggedTie({ offset: 4, a, b, leg1: [1, 1], leg2: [0, 0] });

    await buildTies(seasonId, logger);
    await resolveTies(seasonId, logger);

    const tie = await prisma.tie.findFirstOrThrow({ where: { roundId } });
    // Scoring stays blocked, which is the correct outcome (§9.3) — a guessed
    // winner would score TO_QUALIFY wrongly and force a rescore.
    expect(tie.winnerTeamId).toBeNull();
    expect(tie.settledAt).toBeNull();
  });

  it('will not settle a tie whose second leg has not finished', async () => {
    const a = await team('pend-a');
    const b = await team('pend-b');
    const roundId = await twoLeggedTie({ offset: 5, a, b, leg1: [2, 0], leg2: [0, 0] });

    await prisma.fixture.updateMany({
      where: { roundId, homeTeamId: b },
      data: { status: 'SCHEDULED', homeGoals: null, awayGoals: null },
    });

    await buildTies(seasonId, logger);
    await resolveTies(seasonId, logger);

    const tie = await prisma.tie.findFirstOrThrow({ where: { roundId } });
    expect(tie.settledAt).toBeNull();
  });

  it('is idempotent — re-running creates no duplicate ties', async () => {
    const before = await prisma.tie.count({ where: { roundId: { in: made.rounds } } });
    await buildTies(seasonId, logger);
    const after = await prisma.tie.count({ where: { roundId: { in: made.rounds } } });
    expect(after).toBe(before);
  });
});

describe('the real 2025/26 Champions League bracket', () => {
  it('resolves every tie with no ambiguity left', async () => {
    const season = await prisma.season.findFirstOrThrow({
      where: { competition: { slug: 'champions-league' }, isCurrent: true },
    });

    const ties = await prisma.tie.findMany({
      // Real stage ordinals are 100-500 (see STAGE_ORDER); this file's
      // synthetic rounds use 800+, so excluding them keeps the assertion about
      // the ingested bracket rather than about the test's own fixtures.
      where: { seasonId: season.id, round: { isTwoLegged: true, number: { lt: 800 } } },
      include: { round: { select: { type: true } } },
    });

    // 8 play-off + 8 R16 + 4 QF + 2 SF = 22 two-legged ties.
    expect(ties).toHaveLength(22);
    expect(ties.every((t) => t.winnerTeamId !== null)).toBe(true);
    expect(ties.every((t) => t.settledAt !== null)).toBe(true);
  });

  it('never names a winner who was not in the tie', async () => {
    // The DB CHECK constraint enforces this too; asserting it here proves the
    // resolver agrees with the constraint rather than relying on it.
    const bad = await prisma.tie.findFirst({
      where: {
        winnerTeamId: { not: null },
        NOT: [{ winnerTeamId: { equals: prisma.tie.fields.teamAId } }],
        AND: [{ NOT: { winnerTeamId: { equals: prisma.tie.fields.teamBId } } }],
      },
    });
    expect(bad).toBeNull();
  });

  it('has exactly one final, decided', async () => {
    const season = await prisma.season.findFirstOrThrow({
      where: { competition: { slug: 'champions-league' }, isCurrent: true },
    });
    const finals = await prisma.tie.findMany({
      where: { seasonId: season.id, round: { type: RoundType.FINAL } },
    });
    expect(finals).toHaveLength(1);
    expect(finals[0]!.winnerTeamId).not.toBeNull();
  });
});
