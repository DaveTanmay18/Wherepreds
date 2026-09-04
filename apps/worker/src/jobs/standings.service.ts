import { prisma, type Prisma } from '@wp/db';
import type { RuleSetConfig } from '@wp/scoring';
import type { Logger } from '../logger.js';

/**
 * Standings worker (tasks P3-18, P3-19, P3-20).
 *
 * Rebuilds StandingEntry from the scored round FORWARD — totalPoints and
 * position are cumulative, so a rescore of round 5 changes every table after
 * it (§9.2). Reading a leaderboard is then a single indexed scan, never an
 * aggregate over predictions.
 */
export async function rebuildStandings(
  leagueId: string,
  fromSequence: number,
  log: Logger,
): Promise<{ rounds: number; entries: number }> {
  const rounds = await prisma.leagueRound.findMany({
    where: { leagueId, sequence: { gte: fromSequence } },
    orderBy: { sequence: 'asc' },
    include: { ruleSet: { select: { config: true } } },
  });
  if (rounds.length === 0) return { rounds: 0, entries: 0 };

  const members = await prisma.leagueMembership.findMany({
    where: { leagueId, status: 'ACTIVE' },
    select: { userId: true, effectiveFromRound: true, user: { select: { displayName: true } } },
  });

  // Carry forward the totals from the round before the rebuild point, so a
  // partial rebuild produces the same numbers as a full one.
  const carry = new Map<string, { total: number; exact: number; correct: number; made: number }>();
  if (fromSequence > 1) {
    const prior = await prisma.standingEntry.findMany({
      where: { leagueId, leagueRound: { sequence: fromSequence - 1 } },
    });
    for (const p of prior) {
      carry.set(p.userId, {
        total: Number(p.totalPoints),
        exact: p.exactScores,
        correct: p.correctOutcomes,
        made: p.predictionsMade,
      });
    }
  }
  for (const m of members) {
    if (!carry.has(m.userId)) carry.set(m.userId, { total: 0, exact: 0, correct: 0, made: 0 });
  }

  let entries = 0;

  for (const round of rounds) {
    const config = round.ruleSet.config as unknown as RuleSetConfig;

    const scores = await prisma.predictionScore.findMany({
      where: { prediction: { leagueFixture: { leagueRoundId: round.id } } },
      include: { prediction: { select: { userId: true, status: true } } },
    });

    const roundTotals = new Map<
      string,
      { points: number; exact: number; correct: number; made: number }
    >();
    for (const s of scores) {
      const u = s.prediction.userId;
      const t = roundTotals.get(u) ?? { points: 0, exact: 0, correct: 0, made: 0 };
      t.points += Number(s.points);
      if (s.isExactScore) t.exact++;
      if (s.isOutcomeCorrect) t.correct++;
      t.made++;
      roundTotals.set(u, t);
    }

    const rows = members.map((m) => {
      // Late joiners score nothing before their effective round (§P3-20).
      const eligible = !m.effectiveFromRound || round.sequence >= m.effectiveFromRound;
      const t = eligible
        ? (roundTotals.get(m.userId) ?? { points: 0, exact: 0, correct: 0, made: 0 })
        : { points: 0, exact: 0, correct: 0, made: 0 };
      const prev = carry.get(m.userId)!;

      return {
        userId: m.userId,
        displayName: m.user.displayName,
        roundPoints: t.points,
        totalPoints: prev.total + t.points,
        exactScores: prev.exact + t.exact,
        correctOutcomes: prev.correct + t.correct,
        predictionsMade: prev.made + t.made,
      };
    });

    // Tiebreakers in the order the league declared them (task P3-19).
    rows.sort((a, b) => {
      for (const rule of config.tiebreakers) {
        const cmp = compareBy(rule, a, b);
        if (cmp !== 0) return cmp;
      }
      return 0;
    });

    const previous = await prisma.standingEntry.findMany({
      where: { leagueId, leagueRound: { sequence: round.sequence - 1 } },
      select: { userId: true, position: true },
    });
    const prevPos = new Map(previous.map((p) => [p.userId, p.position]));

    const data: Prisma.StandingEntryCreateManyInput[] = rows.map((r, i) => ({
      leagueId,
      leagueRoundId: round.id,
      userId: r.userId,
      roundPoints: r.roundPoints,
      totalPoints: r.totalPoints,
      position: i + 1,
      previousPosition: prevPos.get(r.userId) ?? null,
      exactScores: r.exactScores,
      correctOutcomes: r.correctOutcomes,
      predictionsMade: r.predictionsMade,
    }));

    await prisma.$transaction([
      prisma.standingEntry.deleteMany({ where: { leagueRoundId: round.id } }),
      prisma.standingEntry.createMany({ data }),
    ]);

    for (const r of rows) {
      carry.set(r.userId, {
        total: r.totalPoints,
        exact: r.exactScores,
        correct: r.correctOutcomes,
        made: r.predictionsMade,
      });
    }
    entries += data.length;
  }

  log.info({ leagueId, fromSequence, rounds: rounds.length, entries }, 'standings rebuilt');
  return { rounds: rounds.length, entries };
}

type Row = {
  displayName: string;
  totalPoints: number;
  exactScores: number;
  correctOutcomes: number;
  predictionsMade: number;
};

/** Descending for points-like values; ascending for name. */
function compareBy(rule: string, a: Row, b: Row): number {
  switch (rule) {
    case 'TOTAL_POINTS':
      return b.totalPoints - a.totalPoints;
    case 'EXACT_SCORES':
      return b.exactScores - a.exactScores;
    case 'CORRECT_OUTCOMES':
      return b.correctOutcomes - a.correctOutcomes;
    case 'PREDICTIONS_MADE':
      return b.predictionsMade - a.predictionsMade;
    case 'ALPHABETICAL':
      return a.displayName.localeCompare(b.displayName);
    // HEAD_TO_HEAD and EARLIEST_SUBMISSION need per-pair data the caller does
    // not hold; they fall through to the next declared tiebreaker rather than
    // ordering arbitrarily.
    default:
      return 0;
  }
}
