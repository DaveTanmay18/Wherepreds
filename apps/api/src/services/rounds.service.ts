import { DeadlineStrategy, LeagueRoundStatus, prisma, RoundType } from '@wp/db';

/**
 * League round materialisation (tasks P2-12, P2-13).
 *
 * Creates one LeagueRound per football Round, each carrying that league's own
 * deadline and the rule-set version it will be scored under. Two leagues on
 * the same gameweek can therefore have completely different deadlines (§5.1).
 */

/** Resolves the absolute deadline for a round (§10.1). */
export function resolveDeadline(opts: {
  strategy: DeadlineStrategy;
  offsetMinutes: number;
  kickoffs: Date[];
  roundStartsAt: Date | null;
}): { deadlineAt: Date; isProvisional: boolean } {
  const offsetMs = opts.offsetMinutes * 60_000;

  if (opts.kickoffs.length === 0) {
    // No fixtures yet — an undrawn UCL knockout round (§10.5). Estimate from
    // the round window and mark it provisional; the locking job will refuse to
    // lock it, so no MISSED placeholders are created for matches that do not
    // exist.
    const estimate = opts.roundStartsAt ?? new Date(Date.now() + 30 * 24 * 3600_000);
    return { deadlineAt: estimate, isProvisional: true };
  }

  const sorted = [...opts.kickoffs].sort((a, b) => a.getTime() - b.getTime());
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;

  switch (opts.strategy) {
    case DeadlineStrategy.PER_FIXTURE_KICKOFF:
      // Display value only; each LeagueFixture carries its own deadline.
      return { deadlineAt: new Date(last.getTime() - offsetMs), isProvisional: false };
    case DeadlineStrategy.ROUND_FIRST_KICKOFF:
    case DeadlineStrategy.FIXED_DATETIME:
    case DeadlineStrategy.CUSTOM_PER_ROUND:
    default:
      return { deadlineAt: new Date(first.getTime() - offsetMs), isProvisional: false };
  }
}

/**
 * Creates every LeagueRound for a league, idempotently. Safe to re-run after
 * new fixtures are ingested — existing rounds are updated, not duplicated.
 */
export async function materialiseRounds(
  leagueId: string,
): Promise<{ created: number; updated: number }> {
  const league = await prisma.predictionLeague.findUniqueOrThrow({
    where: { id: leagueId },
    include: { ruleSets: { where: { isActive: true }, take: 1 } },
  });

  const ruleSet = league.ruleSets[0];
  if (!ruleSet) throw new Error(`League ${leagueId} has no active rule set`);

  const rounds = await prisma.round.findMany({
    where: { seasonId: league.seasonId },
    orderBy: { number: 'asc' },
    select: { id: true, startsAt: true },
  });

  // Only the first and last kickoff per round matter (§10.1), so aggregate in
  // the database rather than shipping every fixture in the season across the
  // wire to compute a min. For a full UCL + league season that is ~40 rows
  // instead of ~570.
  const kickoffs = await prisma.fixture.groupBy({
    by: ['roundId'],
    where: { seasonId: league.seasonId, roundId: { not: null } },
    _min: { kickoffAt: true },
    _max: { kickoffAt: true },
  });
  const kickoffByRound = new Map(
    kickoffs.map((k) => [k.roundId!, { first: k._min.kickoffAt, last: k._max.kickoffAt }]),
  );

  const existing = await prisma.leagueRound.findMany({
    where: { leagueId },
    select: { id: true, roundId: true, status: true },
  });
  const byRoundId = new Map(existing.map((r) => [r.roundId, r]));

  // ⚠️ Batched deliberately. Creating 38 league rounds one at a time against a
  // remote database took ~58 SECONDS — a minute of staring at a spinner just
  // to create a league. One createMany plus chunked updates makes it ~2s.
  const toCreate: {
    leagueId: string;
    roundId: string;
    ruleSetId: string;
    sequence: number;
    deadlineAt: Date;
    isProvisional: boolean;
    status: LeagueRoundStatus;
  }[] = [];
  const toUpdate: { id: string; deadlineAt: Date; isProvisional: boolean; sequence: number }[] = [];

  let sequence = 0;

  for (const round of rounds) {
    sequence++;

    const k = kickoffByRound.get(round.id);
    const { deadlineAt, isProvisional } = resolveDeadline({
      strategy: ruleSet.deadlineStrategy,
      offsetMinutes: ruleSet.deadlineOffsetMin,
      kickoffs: k?.first && k.last ? [k.first, k.last] : [],
      roundStartsAt: round.startsAt,
    });

    const found = byRoundId.get(round.id);

    if (!found) {
      toCreate.push({
        leagueId,
        roundId: round.id,
        ruleSetId: ruleSet.id,
        sequence,
        deadlineAt,
        isProvisional,
        status: LeagueRoundStatus.UPCOMING,
      });
    } else if (found.status === LeagueRoundStatus.UPCOMING) {
      // Only UPCOMING rounds may move. A locked or scored round keeps the
      // deadline it was actually played under — changing that retroactively
      // would rewrite the record of when predictions closed.
      toUpdate.push({ id: found.id, deadlineAt, isProvisional, sequence });
    }
  }

  if (toCreate.length) {
    await prisma.leagueRound.createMany({ data: toCreate, skipDuplicates: true });
  }

  await materialiseAllFixtures(leagueId, league.seasonId, ruleSet.fixturesPerRound, {
    strategy: ruleSet.deadlineStrategy,
    offsetMinutes: ruleSet.deadlineOffsetMin,
  });

  const CHUNK = 25;
  for (let i = 0; i < toUpdate.length; i += CHUNK) {
    await prisma.$transaction(
      toUpdate.slice(i, i + CHUNK).map((u) =>
        prisma.leagueRound.update({
          where: { id: u.id },
          data: { deadlineAt: u.deadlineAt, isProvisional: u.isProvisional, sequence: u.sequence },
        }),
      ),
    );
  }

  return { created: toCreate.length, updated: toUpdate.length };
}

/**
 * Attaches the season's fixtures to every UPCOMING league round.
 *
 * ⚠️ This runs as part of round materialisation, NOT only from the admin
 * endpoint. Creating a league used to leave every round with zero fixtures, so
 * the prediction screen was empty and there was no way to fix it from the UI —
 * the league looked broken from the moment it was created. A league must be
 * playable the instant it exists.
 *
 * Idempotent: `skipDuplicates` plus the (leagueRoundId, fixtureId) unique
 * constraint mean re-running after new fixtures are ingested only adds what is
 * missing. Locked and scored rounds are skipped so their fixture list — the
 * one members actually played — can never change retroactively.
 */
export async function materialiseAllFixtures(
  leagueId: string,
  seasonId: string,
  fixturesPerRound: number | null,
  /**
   * ⚠️ REQUIRED for PER_FIXTURE_KICKOFF. Without it every LeagueFixture is
   * written with a null deadline, `checkDeadlines` falls back to the ROUND
   * deadline, and a league whose whole point is "each match closes at its own
   * kickoff" closes every match the moment the first one starts.
   */
  deadline: { strategy: DeadlineStrategy; offsetMinutes: number },
): Promise<number> {
  const rounds = await prisma.leagueRound.findMany({
    where: { leagueId, status: LeagueRoundStatus.UPCOMING },
    select: { id: true, roundId: true },
  });
  if (rounds.length === 0) return 0;

  const fixtures = await prisma.fixture.findMany({
    where: { seasonId, roundId: { in: rounds.map((r) => r.roundId) } },
    orderBy: { kickoffAt: 'asc' },
    select: { id: true, roundId: true, kickoffAt: true },
  });

  const byRound = new Map<string, { id: string; kickoffAt: Date }[]>();
  for (const f of fixtures) {
    if (!f.roundId) continue;
    const list = byRound.get(f.roundId) ?? [];
    list.push({ id: f.id, kickoffAt: f.kickoffAt });
    byRound.set(f.roundId, list);
  }

  const perFixture = deadline.strategy === DeadlineStrategy.PER_FIXTURE_KICKOFF;
  const offsetMs = deadline.offsetMinutes * 60_000;

  const rows = rounds.flatMap((lr) => {
    const all = byRound.get(lr.roundId) ?? [];
    const chosen = fixturesPerRound ? all.slice(0, fixturesPerRound) : all;
    return chosen.map((f, i) => ({
      leagueRoundId: lr.id,
      fixtureId: f.id,
      position: i + 1,
      // Only PER_FIXTURE_KICKOFF gives a fixture its own deadline; every other
      // strategy leaves this null and defers to the round (§10.1).
      deadlineAt: perFixture ? new Date(f.kickoffAt.getTime() - offsetMs) : null,
    }));
  });

  if (rows.length === 0) return 0;

  await prisma.leagueFixture.createMany({ data: rows, skipDuplicates: true });
  return rows.length;
}

/** Rounds a league can currently be played on, for the overview screen. */
export async function nextRound(leagueId: string) {
  return prisma.leagueRound.findFirst({
    where: { leagueId, status: LeagueRoundStatus.UPCOMING, isProvisional: false },
    orderBy: { deadlineAt: 'asc' },
    include: {
      round: { select: { name: true, type: true, number: true } },
      _count: { select: { fixtures: true } },
    },
  });
}

export const KNOCKOUT_TYPES: RoundType[] = [
  RoundType.KNOCKOUT_PLAYOFF,
  RoundType.ROUND_OF_16,
  RoundType.QUARTER_FINAL,
  RoundType.SEMI_FINAL,
  RoundType.FINAL,
];
