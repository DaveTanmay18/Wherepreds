import { FixtureStatus, prisma, RoundType, TieDecider } from '@wp/db';
import type { Logger } from '../logger.js';

/**
 * Knockout ties (tasks P1b-04, P1b-06).
 *
 * ⚠️ football-data.org has NO tie or aggregate concept — it returns two
 * independent matches with a `stage` and nothing linking them (§11.4). So this
 * is entirely our construction, and it is the foundation TO_QUALIFY scoring
 * stands on.
 */

const KNOCKOUT: RoundType[] = [
  RoundType.KNOCKOUT_PLAYOFF,
  RoundType.ROUND_OF_16,
  RoundType.QUARTER_FINAL,
  RoundType.SEMI_FINAL,
  RoundType.FINAL,
];

/** Unordered pair key, so leg 2 matches back to leg 1 regardless of venue. */
const pairKey = (a: string, b: string) => [a, b].sort().join('::');

/**
 * Pairs knockout fixtures into ties (task P1b-04). Idempotent.
 *
 * Team A is whoever is at home in the FIRST leg, so the orientation is stable
 * no matter which leg gets ingested first.
 */
export async function buildTies(seasonId: string, log: Logger): Promise<{ created: number }> {
  const rounds = await prisma.round.findMany({
    where: { seasonId, type: { in: KNOCKOUT } },
    include: {
      fixtures: {
        orderBy: { kickoffAt: 'asc' },
        select: { id: true, homeTeamId: true, awayTeamId: true, tieId: true, kickoffAt: true },
      },
    },
  });

  let created = 0;

  for (const round of rounds) {
    const groups = new Map<string, typeof round.fixtures>();
    for (const f of round.fixtures) {
      const key = pairKey(f.homeTeamId, f.awayTeamId);
      groups.set(key, [...(groups.get(key) ?? []), f]);
    }

    for (const [, legs] of groups) {
      // Already paired.
      if (legs.every((l) => l.tieId)) continue;

      const first = legs[0]!;
      const teamAId = first.homeTeamId;
      const teamBId = first.awayTeamId;

      const existing = await prisma.tie.findUnique({
        where: { roundId_teamAId_teamBId: { roundId: round.id, teamAId, teamBId } },
      });

      const tie =
        existing ??
        (await prisma.tie.create({
          data: { seasonId, roundId: round.id, teamAId, teamBId },
        }));

      await prisma.$transaction(
        legs.map((leg, i) =>
          prisma.fixture.update({
            where: { id: leg.id },
            data: { tieId: tie.id, legNumber: i + 1 },
          }),
        ),
      );

      if (!existing) created++;
    }

    log.info({ round: round.name, ties: groups.size }, 'ties paired');
  }

  return { created };
}

/**
 * resolve.ties (task P1b-06) — computes aggregate, winner and how it was
 * decided. Runs after a knockout leg finishes.
 *
 * ⚠️ We derive the winner ourselves rather than trusting a provider field,
 * because there isn't one. A tie is only settled once EVERY leg is FINISHED
 * and any shootout result is present — scoring TO_QUALIFY against a
 * half-resolved tie is precisely the error that forces a rescore (§9.3).
 */
export async function resolveTies(
  seasonId: string | null,
  log: Logger,
): Promise<{ settled: number; pending: number }> {
  const ties = await prisma.tie.findMany({
    where: { settledAt: null, ...(seasonId ? { seasonId } : {}) },
    include: {
      round: { select: { name: true, isTwoLegged: true } },
      fixtures: { orderBy: { legNumber: 'asc' } },
      teamA: { select: { tla: true, name: true } },
      teamB: { select: { tla: true, name: true } },
    },
  });

  let settled = 0;
  let pending = 0;

  for (const tie of ties) {
    const expectedLegs = tie.round.isTwoLegged ? 2 : 1;
    const finished = tie.fixtures.filter(
      (f) => f.status === FixtureStatus.FINISHED || f.status === FixtureStatus.AWARDED,
    );

    if (tie.fixtures.length < expectedLegs || finished.length < expectedLegs) {
      pending++;
      continue;
    }

    // ── Aggregate, oriented to team A ────────────────────────────────
    // homeGoals is the 90-minute score (§11.1). Extra time is played in the
    // deciding leg and counts towards the aggregate; away goals were abolished
    // in 2021, so there is no tiebreak on them.
    let aggA = 0;
    let aggB = 0;
    let wentToPens = false;
    let wentToEt = false;
    let pensA = 0;
    let pensB = 0;

    for (const f of finished) {
      const aIsHome = f.homeTeamId === tie.teamAId;
      const homeTotal = (f.homeGoals ?? 0) + (f.homeGoalsEt ?? 0);
      const awayTotal = (f.awayGoals ?? 0) + (f.awayGoalsEt ?? 0);

      aggA += aIsHome ? homeTotal : awayTotal;
      aggB += aIsHome ? awayTotal : homeTotal;

      if ((f.homeGoalsEt ?? 0) > 0 || (f.awayGoalsEt ?? 0) > 0) wentToEt = true;
      if (f.homePenalties !== null && f.awayPenalties !== null) {
        wentToPens = true;
        pensA += aIsHome ? f.homePenalties : f.awayPenalties;
        pensB += aIsHome ? f.awayPenalties : f.homePenalties;
      }
    }

    let winnerTeamId: string;
    let decidedBy: TieDecider;

    if (aggA !== aggB) {
      winnerTeamId = aggA > aggB ? tie.teamAId : tie.teamBId;
      decidedBy = wentToEt ? TieDecider.EXTRA_TIME : TieDecider.AGGREGATE;
    } else if (wentToPens && pensA !== pensB) {
      winnerTeamId = pensA > pensB ? tie.teamAId : tie.teamBId;
      decidedBy = TieDecider.PENALTIES;
    } else {
      // Level with no shootout recorded — the tie is genuinely unresolved, so
      // leave it pending rather than inventing a winner. Scoring stays blocked,
      // which is the correct outcome (§9.3).
      log.warn(
        { tie: tie.id, aggregate: `${aggA}-${aggB}` },
        'tie level with no shootout result — leaving unsettled',
      );
      pending++;
      continue;
    }

    await prisma.tie.update({
      where: { id: tie.id },
      data: {
        aggregateA: aggA,
        aggregateB: aggB,
        winnerTeamId,
        decidedBy,
        settledAt: new Date(),
        resultVersion: { increment: 1 },
      },
    });

    settled++;
    log.info(
      {
        tie: `${tie.teamA.tla} v ${tie.teamB.tla}`,
        round: tie.round.name,
        aggregate: `${aggA}-${aggB}`,
        decidedBy,
        winner: winnerTeamId === tie.teamAId ? tie.teamA.tla : tie.teamB.tla,
      },
      'tie settled',
    );
  }

  return { settled, pending };
}
