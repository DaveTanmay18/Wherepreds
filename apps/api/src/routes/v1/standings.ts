import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@wp/db';
import { noStore } from '../../middleware/cache.js';
import { loadUser, requireUser } from '../../middleware/auth.js';
import { loadLeague, requireMember } from '../../middleware/league.js';
import { validate } from '../../middleware/validate.js';

/**
 * League standings (task P3-21).
 *
 * Reads the materialised StandingEntry table — a single indexed scan, never an
 * aggregate over predictions (§5.1). That is what keeps a leaderboard instant
 * on a Saturday evening when everyone opens the app at once.
 */
export const standingsRouter: Router = Router();
standingsRouter.use(noStore, loadUser);

standingsRouter.get(
  '/leagues/:slug/standings',
  requireUser,
  loadLeague,
  requireMember,
  validate({ query: z.object({ roundSequence: z.coerce.number().int().min(1).optional() }) }),
  async (req, res) => {
    const { roundSequence } = req.query as unknown as { roundSequence?: number };

    const leagueRound = await prisma.leagueRound.findFirst({
      where: {
        leagueId: req.league!.leagueId,
        ...(roundSequence ? { sequence: roundSequence } : { standings: { some: {} } }),
      },
      orderBy: { sequence: 'desc' },
      select: { id: true, sequence: true, status: true },
    });

    if (!leagueRound) {
      return res.json({ standings: [], throughRound: null, isProvisional: false });
    }

    const rows = await prisma.standingEntry.findMany({
      where: { leagueRoundId: leagueRound.id },
      orderBy: { position: 'asc' },
      include: {
        user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      },
    });

    res.json({
      throughRound: leagueRound.sequence,
      // Points can still change while a round is provisional (§9.3). Saying so
      // is better than a table that silently moves overnight.
      isProvisional: leagueRound.status === 'PROVISIONAL',
      standings: rows.map((r) => ({
        position: r.position,
        previousPosition: r.previousPosition,
        movement: r.previousPosition === null ? null : r.previousPosition - r.position,
        user: r.user,
        isViewer: r.userId === req.user!.id,
        roundPoints: Number(r.roundPoints),
        totalPoints: Number(r.totalPoints),
        exactScores: r.exactScores,
        correctOutcomes: r.correctOutcomes,
        predictionsMade: r.predictionsMade,
      })),
    });
  },
);

/** Per-round points for one member — sparkline data. */
standingsRouter.get(
  '/leagues/:slug/standings/history',
  requireUser,
  loadLeague,
  requireMember,
  validate({ query: z.object({ userId: z.string().optional() }) }),
  async (req, res) => {
    const userId = (req.query as unknown as { userId?: string }).userId ?? req.user!.id;

    const entries = await prisma.standingEntry.findMany({
      where: { leagueId: req.league!.leagueId, userId },
      orderBy: { leagueRound: { sequence: 'asc' } },
      include: { leagueRound: { select: { sequence: true } } },
    });

    res.json({
      history: entries.map((e) => ({
        sequence: e.leagueRound.sequence,
        roundPoints: Number(e.roundPoints),
        totalPoints: Number(e.totalPoints),
        position: e.position,
      })),
    });
  },
);

/** Every member's scored breakdowns for a round — the results screen. */
standingsRouter.get(
  '/leagues/:slug/rounds/:sequence/scores',
  requireUser,
  loadLeague,
  requireMember,
  validate({ params: z.object({ slug: z.string(), sequence: z.coerce.number().int().min(1) }) }),
  async (req, res) => {
    const leagueRound = await prisma.leagueRound.findFirstOrThrow({
      where: { leagueId: req.league!.leagueId, sequence: Number(req.params.sequence) },
      select: { id: true, status: true },
    });

    const scores = await prisma.predictionScore.findMany({
      where: { prediction: { leagueFixture: { leagueRoundId: leagueRound.id } } },
      include: {
        prediction: {
          select: {
            leagueFixtureId: true,
            user: { select: { id: true, username: true, displayName: true } },
            selections: true,
          },
        },
      },
    });

    res.json({
      status: leagueRound.status,
      scores: scores.map((s) => ({
        leagueFixtureId: s.prediction.leagueFixtureId,
        user: s.prediction.user,
        selections: s.prediction.selections,
        basePoints: Number(s.basePoints),
        multiplier: Number(s.multiplier),
        points: Number(s.points),
        isExactScore: s.isExactScore,
        // Names every rule that fired — this is what answers "why did I get
        // 7 points?" and what makes a dispute resolvable (§5.1).
        breakdown: s.breakdown,
      })),
    });
  },
);
