import { Router } from 'express';
import { z } from 'zod';
import { LeagueRoundStatus, prisma } from '@wp/db';
import { loadUser, requireAdmin } from '../../middleware/auth.js';
import { noStore } from '../../middleware/cache.js';
import { validate } from '../../middleware/validate.js';
import { notFound } from '../../errors.js';

/**
 * Platform administration.
 *
 * ⚠️ These routes deliberately bypass the two protections that hold the rest
 * of the product together: league membership, and the pre-deadline pick
 * blackout (§15.3). That is the point of them — an operator has to be able to
 * investigate a dispute — but it makes this the most dangerous file in the
 * API. Two rules follow:
 *
 *   1. Every route sits behind `requireAdmin`, path-scoped (see below).
 *   2. Reading picks for a round that is STILL OPEN is written to the audit
 *      log every time, naming the admin and the round. An operator who also
 *      competes must not be able to read everyone's picks and leave no trace.
 *      The log is what makes the power legitimate rather than a back door.
 */
export const adminRouter: Router = Router();

/**
 * ⚠️ PATH-SCOPED. This router mounts at '/' alongside the others, and a
 * router-level `.use` with no path runs for EVERY request that reaches it —
 * which here would put the entire API behind an administrator check.
 */
adminRouter.use('/admin', noStore, loadUser, requireAdmin);

/** Every league on the platform, newest first. */
adminRouter.get('/admin/leagues', async (_req, res) => {
  const leagues = await prisma.predictionLeague.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      season: { include: { competition: { select: { name: true } } } },
      memberships: {
        where: { role: 'OWNER' },
        take: 1,
        include: { user: { select: { username: true, displayName: true, email: true } } },
      },
      _count: { select: { memberships: true, rounds: true } },
    },
  });

  const ids = leagues.map((l) => l.id);

  // Two grouped queries rather than one per league. This list is unbounded, so
  // an N+1 here gets slower with every league anyone creates.
  const fixtures = await prisma.leagueFixture.findMany({
    where: { leagueRound: { leagueId: { in: ids } } },
    select: { id: true, leagueRound: { select: { leagueId: true } } },
  });
  const leagueOfFixture = new Map(fixtures.map((f) => [f.id, f.leagueRound.leagueId]));

  const counts = await prisma.prediction.groupBy({
    by: ['leagueFixtureId'],
    where: { leagueFixture: { leagueRound: { leagueId: { in: ids } } } },
    _count: true,
  });
  const byLeague = new Map<string, number>();
  for (const c of counts) {
    const leagueId = leagueOfFixture.get(c.leagueFixtureId);
    if (leagueId) byLeague.set(leagueId, (byLeague.get(leagueId) ?? 0) + c._count);
  }

  res.json({
    leagues: leagues.map((l) => ({
      id: l.id,
      slug: l.slug,
      name: l.name,
      visibility: l.visibility,
      createdAt: l.createdAt,
      competition: l.season.competition.name,
      season: l.season.label,
      owner: l.memberships[0]?.user ?? null,
      memberCount: l._count.memberships,
      roundCount: l._count.rounds,
      predictionCount: byLeague.get(l.id) ?? 0,
    })),
  });
});

/** One league in detail: members, rounds, and how much has been predicted. */
adminRouter.get(
  '/admin/leagues/:slug',
  validate({ params: z.object({ slug: z.string() }) }),
  async (req, res) => {
    const league = await prisma.predictionLeague.findUnique({
      where: { slug: String(req.params.slug) },
      include: {
        season: { include: { competition: { select: { name: true } } } },
        memberships: {
          include: { user: { select: { id: true, username: true, displayName: true } } },
        },
        rounds: {
          orderBy: { sequence: 'asc' },
          include: { round: { select: { name: true } }, _count: { select: { fixtures: true } } },
        },
      },
    });
    if (!league) throw notFound('No such league.');

    const fixtures = await prisma.leagueFixture.findMany({
      where: { leagueRound: { leagueId: league.id } },
      select: { id: true, leagueRoundId: true },
    });
    const roundOfFixture = new Map(fixtures.map((f) => [f.id, f.leagueRoundId]));

    const counts = await prisma.prediction.groupBy({
      by: ['leagueFixtureId'],
      where: { leagueFixture: { leagueRound: { leagueId: league.id } } },
      _count: true,
    });
    const perRound = new Map<string, number>();
    for (const c of counts) {
      const roundId = roundOfFixture.get(c.leagueFixtureId);
      if (roundId) perRound.set(roundId, (perRound.get(roundId) ?? 0) + c._count);
    }

    res.json({
      league: {
        slug: league.slug,
        name: league.name,
        competition: league.season.competition.name,
        season: league.season.label,
        visibility: league.visibility,
        members: league.memberships.map((m) => ({
          userId: m.user.id,
          username: m.user.username,
          displayName: m.user.displayName,
          role: m.role,
          status: m.status,
        })),
        rounds: league.rounds.map((r) => ({
          sequence: r.sequence,
          name: r.round.name,
          status: r.status,
          deadlineAt: r.deadlineAt,
          fixtureCount: r._count.fixtures,
          predictionCount: perRound.get(r.id) ?? 0,
        })),
      },
    });
  },
);

/**
 * Every prediction in one round, by every member.
 *
 * ⚠️ This is the route that bypasses the blackout. `hiddenFromMembers` in the
 * response says whether ordinary members can see these yet — an admin reading
 * an open round is looking at information nobody else in the league has, and
 * ought to be told so rather than left to infer it.
 */
adminRouter.get(
  '/admin/leagues/:slug/rounds/:sequence/predictions',
  validate({
    params: z.object({ slug: z.string(), sequence: z.coerce.number().int().min(1) }),
  }),
  async (req, res) => {
    const league = await prisma.predictionLeague.findUnique({
      where: { slug: String(req.params.slug) },
      select: { id: true, name: true },
    });
    if (!league) throw notFound('No such league.');

    const leagueRound = await prisma.leagueRound.findFirst({
      where: { leagueId: league.id, sequence: Number(req.params.sequence) },
      include: {
        round: { select: { name: true } },
        ruleSet: { select: { revealPicksBeforeDeadline: true } },
        fixtures: {
          orderBy: { position: 'asc' },
          include: {
            fixture: {
              include: {
                homeTeam: { select: { shortName: true, name: true } },
                awayTeam: { select: { shortName: true, name: true } },
              },
            },
          },
        },
      },
    });
    if (!leagueRound) throw notFound('No such round.');

    const stillHidden =
      leagueRound.status === LeagueRoundStatus.UPCOMING &&
      !leagueRound.ruleSet.revealPicksBeforeDeadline;

    // ⚠️ Audit BEFORE responding. The read is the sensitive act, so the record
    // of it must not depend on the response being delivered successfully.
    if (stillHidden) {
      await prisma.auditLog.create({
        data: {
          actorId: req.user!.id,
          action: 'admin.picks.view',
          entityType: 'LeagueRound',
          entityId: `${league.id}:${leagueRound.id}`,
          after: {
            leagueSlug: String(req.params.slug),
            sequence: Number(req.params.sequence),
            roundStatus: leagueRound.status,
            note: 'Admin viewed picks while the round was still open.',
          },
        },
      });
    }

    const predictions = await prisma.prediction.findMany({
      where: { leagueFixture: { leagueRoundId: leagueRound.id } },
      include: {
        user: { select: { id: true, username: true, displayName: true } },
        selections: true,
        score: { select: { points: true } },
        boosterUsage: { select: { type: true, resolvedValue: true } },
      },
    });

    const byFixture = new Map<string, typeof predictions>();
    for (const p of predictions) {
      const list = byFixture.get(p.leagueFixtureId) ?? [];
      list.push(p);
      byFixture.set(p.leagueFixtureId, list);
    }

    res.json({
      league: { slug: String(req.params.slug), name: league.name },
      round: {
        sequence: leagueRound.sequence,
        name: leagueRound.round.name,
        status: leagueRound.status,
        deadlineAt: leagueRound.deadlineAt,
      },
      /** True when ordinary members cannot see these picks yet. */
      hiddenFromMembers: stillHidden,
      fixtures: leagueRound.fixtures.map((lf) => ({
        leagueFixtureId: lf.id,
        kickoffAt: lf.fixture.kickoffAt,
        homeTeam: lf.fixture.homeTeam.shortName ?? lf.fixture.homeTeam.name,
        awayTeam: lf.fixture.awayTeam.shortName ?? lf.fixture.awayTeam.name,
        result:
          lf.fixture.homeGoals === null
            ? null
            : { home: lf.fixture.homeGoals, away: lf.fixture.awayGoals },
        predictions: (byFixture.get(lf.id) ?? []).map((p) => ({
          user: p.user,
          status: p.status,
          note: p.note,
          submittedAt: p.submittedAt,
          selections: p.selections,
          points: p.score?.points ?? null,
          booster: p.boosterUsage
            ? { type: p.boosterUsage.type, value: Number(p.boosterUsage.resolvedValue) }
            : null,
        })),
      })),
    });
  },
);

/**
 * The league's points table, for any round that has one.
 *
 * Served from the admin router rather than reusing `/leagues/:slug/standings`
 * because that route is behind `requireMember` — an operator investigating a
 * league they do not play in would be refused by design. Everything here is
 * already-published information: members see this table on their own standings
 * screen, so unlike the picks route there is nothing to audit.
 */
adminRouter.get(
  '/admin/leagues/:slug/standings',
  validate({
    params: z.object({ slug: z.string() }),
    query: z.object({ sequence: z.coerce.number().int().min(1).optional() }),
  }),
  async (req, res) => {
    const league = await prisma.predictionLeague.findUnique({
      where: { slug: String(req.params.slug) },
      select: { id: true, name: true },
    });
    if (!league) throw notFound('No such league.');

    const q = req.query as unknown as { sequence?: number };

    // ⚠️ The latest round that has actually been PLAYED, not merely the
    // latest that has a standings row. rebuildStandings carries totals forward
    // into every remaining round of the season, so "newest row" resolved to
    // Matchday 8 in a competition where only Matchday 1 has been played — a
    // header that reads as though seven rounds went unscored. Totals are
    // identical either way; only the label was wrong.
    const leagueRound = await prisma.leagueRound.findFirst({
      where: {
        leagueId: league.id,
        ...(q.sequence
          ? { sequence: q.sequence }
          : { standings: { some: {} }, status: { not: LeagueRoundStatus.UPCOMING } }),
      },
      orderBy: { sequence: q.sequence ? 'asc' : 'desc' },
      include: { round: { select: { name: true } } },
    });

    if (!leagueRound) {
      return res.json({
        league: { slug: String(req.params.slug), name: league.name },
        round: null,
        rows: [],
      });
    }

    const rows = await prisma.standingEntry.findMany({
      where: { leagueRoundId: leagueRound.id },
      orderBy: { position: 'asc' },
      include: { user: { select: { id: true, username: true, displayName: true } } },
    });

    res.json({
      league: { slug: String(req.params.slug), name: league.name },
      round: {
        sequence: leagueRound.sequence,
        name: leagueRound.round.name,
        status: leagueRound.status,
      },
      rows: rows.map((r) => ({
        position: r.position,
        previousPosition: r.previousPosition,
        user: r.user,
        // Decimals are serialised as strings by Prisma; Number() here keeps the
        // client from having to know that.
        totalPoints: Number(r.totalPoints),
        roundPoints: Number(r.roundPoints),
        exactScores: r.exactScores,
        correctOutcomes: r.correctOutcomes,
        predictionsMade: r.predictionsMade,
        currentStreak: r.currentStreak,
      })),
    });
  },
);
