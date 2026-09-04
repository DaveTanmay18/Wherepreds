import { FixtureStatus, LeagueRoundStatus, PredictionStatus, prisma } from '@wp/db';
import type { Logger } from '../logger.js';

/**
 * Round lifecycle jobs (tasks P3-03, P3-09, P3-17).
 *
 * These handle the untidy parts of a real season: kickoffs move, matches get
 * postponed, and results are only final once nobody is going to change them.
 */

/**
 * rounds.recompute-deadlines (task P3-03).
 *
 * A kickoff moving must move the deadline with it — but ONLY for rounds still
 * open. A locked or scored round keeps the deadline it was actually played
 * under; changing that retroactively would rewrite the record of when
 * predictions closed (§10.1).
 */
export async function recomputeDeadlines(log: Logger): Promise<{ updated: number }> {
  const rounds = await prisma.leagueRound.findMany({
    where: { status: LeagueRoundStatus.UPCOMING, isProvisional: false },
    include: {
      ruleSet: { select: { deadlineStrategy: true, deadlineOffsetMin: true } },
      fixtures: { include: { fixture: { select: { kickoffAt: true } } } },
    },
  });

  const updates: { id: string; deadlineAt: Date }[] = [];

  for (const r of rounds) {
    if (r.fixtures.length === 0) continue;

    const kickoffs = r.fixtures.map((f) => f.fixture.kickoffAt.getTime()).sort((a, b) => a - b);
    const offsetMs = r.ruleSet.deadlineOffsetMin * 60_000;
    const reference =
      r.ruleSet.deadlineStrategy === 'PER_FIXTURE_KICKOFF'
        ? kickoffs[kickoffs.length - 1]!
        : kickoffs[0]!;
    const next = new Date(reference - offsetMs);

    if (next.getTime() !== r.deadlineAt.getTime()) {
      updates.push({ id: r.id, deadlineAt: next });
      log.info(
        { leagueRound: r.id, from: r.deadlineAt, to: next },
        'deadline moved with the kickoff',
      );
    }
  }

  if (updates.length) {
    await prisma.$transaction(
      updates.map((u) =>
        prisma.leagueRound.update({ where: { id: u.id }, data: { deadlineAt: u.deadlineAt } }),
      ),
    );
  }

  return { updated: updates.length };
}

/**
 * rounds.handle-postponements (task P3-09).
 *
 * Before the deadline a postponed fixture is simply dropped from the round.
 * After it, `voidPostponedFixtures` decides: void it (predictions score zero
 * and are excluded), or carry it forward and score it whenever it is played.
 * Leagues genuinely disagree, so this is a per-league setting (§10.4).
 */
export async function handlePostponements(
  log: Logger,
): Promise<{ dropped: number; voided: number }> {
  const affected = await prisma.leagueFixture.findMany({
    where: {
      isVoided: false,
      fixture: {
        status: {
          in: [FixtureStatus.POSTPONED, FixtureStatus.CANCELLED, FixtureStatus.ABANDONED],
        },
      },
    },
    include: {
      leagueRound: { include: { ruleSet: { select: { voidPostponedFixtures: true } } } },
    },
  });

  let dropped = 0;
  let voided = 0;

  for (const lf of affected) {
    const open = lf.leagueRound.status === LeagueRoundStatus.UPCOMING;

    if (open) {
      // Still open — remove it entirely so nobody predicts a match that will
      // not be played. Cascade takes any predictions with it.
      await prisma.leagueFixture.delete({ where: { id: lf.id } });
      dropped++;
      log.info({ leagueFixture: lf.id }, 'postponed fixture dropped from open round');
      continue;
    }

    if (lf.leagueRound.ruleSet.voidPostponedFixtures) {
      await prisma.$transaction([
        prisma.leagueFixture.update({ where: { id: lf.id }, data: { isVoided: true } }),
        prisma.prediction.updateMany({
          where: { leagueFixtureId: lf.id },
          data: { status: PredictionStatus.VOID },
        }),
      ]);
      voided++;
      log.info({ leagueFixture: lf.id }, 'postponed fixture voided after lock');
    }
    // Otherwise it is carried forward: scoring already skips fixtures without
    // a result, so the round simply stays unscored until the match is played.
  }

  return { dropped, voided };
}

/**
 * rounds.settle (task P3-17).
 *
 * PROVISIONAL → FINAL once the results have had time to stop changing. Points
 * can still move while provisional (§9.3), so boosters and prizes settle only
 * on FINAL — and the UI says so rather than letting a table shift overnight
 * with no explanation.
 */
const SETTLE_AFTER_HOURS = 24;

export async function settleRounds(log: Logger): Promise<{ settled: number }> {
  const cutoff = new Date(Date.now() - SETTLE_AFTER_HOURS * 3600_000);

  const due = await prisma.leagueRound.findMany({
    where: { status: LeagueRoundStatus.PROVISIONAL, scoredAt: { lte: cutoff } },
    select: { id: true, leagueId: true, sequence: true },
  });

  if (due.length === 0) return { settled: 0 };

  await prisma.leagueRound.updateMany({
    where: { id: { in: due.map((r) => r.id) } },
    data: { status: LeagueRoundStatus.FINAL },
  });

  for (const r of due) {
    log.info({ leagueRound: r.id, sequence: r.sequence }, 'round settled as FINAL');
  }

  return { settled: due.length };
}
