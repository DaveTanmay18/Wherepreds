import { LeagueRoundStatus, PredictionStatus, prisma } from '@wp/db';
import type { Logger } from '../logger.js';

/**
 * rounds.lock (task P3-08) — runs every 30 seconds.
 *
 * Locking is server-authoritative and irreversible. Once a round locks, the
 * database trigger (§7.2) refuses every further edit to its predictions,
 * including from an admin script.
 */
export async function lockDueRounds(log: Logger): Promise<{ locked: number; missed: number }> {
  /**
   * ⚠️ FOR UPDATE SKIP LOCKED lets several worker replicas run this job
   * concurrently without double-processing a round — each grabs a disjoint
   * set. AND is_provisional = false is equally load-bearing: a provisional
   * round has no fixtures, so locking it would create MISSED placeholder
   * predictions for matches that do not exist (§10.5).
   */
  const due = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM league_rounds
     WHERE status = 'UPCOMING'
       AND is_provisional = false
       AND deadline_at <= now()
     FOR UPDATE SKIP LOCKED
  `;

  if (due.length === 0) return { locked: 0, missed: 0 };

  let missed = 0;

  for (const { id } of due) {
    const now = new Date();

    const fixtures = await prisma.leagueFixture.findMany({
      where: { leagueRoundId: id },
      select: { id: true },
    });
    if (fixtures.length === 0) {
      log.warn({ leagueRound: id }, 'round due but has no fixtures — skipping lock');
      continue;
    }

    const round = await prisma.leagueRound.findUniqueOrThrow({
      where: { id },
      select: { leagueId: true, ruleSet: { select: { missedPredictionPoints: true } } },
    });

    const members = await prisma.leagueMembership.findMany({
      where: { leagueId: round.leagueId, status: 'ACTIVE' },
      select: { userId: true },
    });

    const existing = await prisma.prediction.findMany({
      where: { leagueFixtureId: { in: fixtures.map((f) => f.id) } },
      select: { leagueFixtureId: true, userId: true },
    });
    const have = new Set(existing.map((p) => `${p.leagueFixtureId}:${p.userId}`));

    // MISSED placeholders so `missedPredictionPoints` applies uniformly and
    // the standings have a row for every member, not a ragged table.
    const placeholders = fixtures.flatMap((f) =>
      members
        .filter((m) => !have.has(`${f.id}:${m.userId}`))
        .map((m) => ({
          leagueFixtureId: f.id,
          userId: m.userId,
          status: PredictionStatus.MISSED,
          lockedAt: now,
        })),
    );

    await prisma.$transaction([
      // Drafts never submitted do not count — locking makes that permanent.
      prisma.prediction.updateMany({
        where: {
          leagueFixtureId: { in: fixtures.map((f) => f.id) },
          status: PredictionStatus.DRAFT,
        },
        data: { status: PredictionStatus.MISSED, lockedAt: now },
      }),
      prisma.prediction.updateMany({
        where: {
          leagueFixtureId: { in: fixtures.map((f) => f.id) },
          status: PredictionStatus.SUBMITTED,
        },
        data: { status: PredictionStatus.LOCKED, lockedAt: now },
      }),
      prisma.prediction.createMany({ data: placeholders, skipDuplicates: true }),
      prisma.leagueRound.update({
        where: { id },
        data: { status: LeagueRoundStatus.LOCKED, lockedAt: now },
      }),
    ]);

    missed += placeholders.length;
    log.info(
      { leagueRound: id, fixtures: fixtures.length, placeholders: placeholders.length },
      'round locked',
    );
  }

  return { locked: due.length, missed };
}
