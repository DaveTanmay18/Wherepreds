import { Router } from 'express';
import { z } from 'zod';
import { MarketType } from '@wp/db';
import { AppError } from '../../errors.js';
import { loadUser, requireUser } from '../../middleware/auth.js';
import { noStore } from '../../middleware/cache.js';
import { loadLeague, requireLeagueAdmin, requireMember } from '../../middleware/league.js';
import { validate } from '../../middleware/validate.js';
import {
  getRoundForUser,
  materialiseFixtures,
  submitRound,
  upsertPredictions,
} from '../../services/predictions.service.js';

export const predictionRouter: Router = Router();
predictionRouter.use(noStore, loadUser);

const selectionSchema = z.object({
  market: z.nativeEnum(MarketType),
  homeGoals: z.number().int().min(0).max(30).optional(),
  awayGoals: z.number().int().min(0).max(30).optional(),
  outcome: z.enum(['HOME', 'DRAW', 'AWAY']).optional(),
  booleanValue: z.boolean().optional(),
  numericValue: z.number().optional(),
  overSelected: z.boolean().optional(),
  playerId: z.string().optional(),
  teamId: z.string().optional(),
});

const bulkSchema = z.object({
  predictions: z
    .array(
      z.object({
        leagueFixtureId: z.string().min(1),
        selections: z.array(selectionSchema).max(6),
        note: z.string().max(280).optional(),
      }),
    )
    .max(50),
  submit: z.boolean().default(false),
});

const seqParams = z.object({ slug: z.string(), sequence: z.coerce.number().int().min(1) });

predictionRouter.get('/leagues/:slug/rounds', loadLeague, requireMember, async (req, res) => {
  const { prisma } = await import('@wp/db');
  const rounds = await prisma.leagueRound.findMany({
    where: { leagueId: req.league!.leagueId },
    orderBy: { sequence: 'asc' },
    include: {
      round: { select: { name: true, type: true, number: true } },
      _count: { select: { fixtures: true } },
    },
  });

  res.json({
    rounds: rounds.map((r) => ({
      sequence: r.sequence,
      status: r.status,
      deadlineAt: r.deadlineAt,
      isProvisional: r.isProvisional,
      name: r.round.name,
      type: r.round.type,
      fixtureCount: r._count.fixtures,
    })),
  });
});

predictionRouter.get(
  '/leagues/:slug/rounds/:sequence',
  requireUser,
  loadLeague,
  requireMember,
  validate({ params: seqParams }),
  async (req, res) => {
    const round = await getRoundForUser(
      req.league!.leagueId,
      Number(req.params.sequence),
      req.user!.id,
    );
    res.json({ round });
  },
);

/** Admin: pull the football fixtures into this league round (task P3-01). */
predictionRouter.post(
  '/leagues/:slug/rounds/:sequence/fixtures',
  requireUser,
  loadLeague,
  requireLeagueAdmin,
  validate({ params: seqParams }),
  async (req, res) => {
    const { prisma } = await import('@wp/db');
    const leagueRound = await prisma.leagueRound.findFirstOrThrow({
      where: { leagueId: req.league!.leagueId, sequence: Number(req.params.sequence) },
      select: { id: true },
    });
    const count = await materialiseFixtures(leagueRound.id);
    res.json({ fixtures: count });
  },
);

/**
 * Bulk upsert — the single most important endpoint on mobile (§12.2).
 * One round of picks is one request, and partial success is reported per
 * fixture so a late kickoff cannot discard the rest.
 */
predictionRouter.put(
  '/leagues/:slug/rounds/:sequence/predictions',
  requireUser,
  loadLeague,
  requireMember,
  validate({ params: seqParams, body: bulkSchema }),
  async (req, res) => {
    const { prisma } = await import('@wp/db');
    const leagueRound = await prisma.leagueRound.findFirstOrThrow({
      where: { leagueId: req.league!.leagueId, sequence: Number(req.params.sequence) },
      select: { id: true },
    });

    const result = await upsertPredictions(
      req.user!.id,
      req.league!.leagueId,
      leagueRound.id,
      req.body.predictions,
      req.body.submit,
    );

    // 207-style semantics inside a 200: the client needs to know which picks
    // landed and which did not, per fixture.
    res.status(result.rejected.length && !result.saved.length ? 409 : 200).json({
      saved: result.saved,
      rejected: result.rejected,
      ...(result.rejected.length
        ? {
            problem: new AppError({
              status: 409,
              type: 'deadline-passed',
              title: 'Some predictions were not saved',
              detail: `${result.rejected.length} of ${result.saved.length + result.rejected.length} could not be saved.`,
              items: result.rejected.map((r) => ({ ...r, code: r.code })),
            }).toProblem(req.originalUrl),
          }
        : {}),
    });
  },
);

predictionRouter.post(
  '/leagues/:slug/rounds/:sequence/submit',
  requireUser,
  loadLeague,
  requireMember,
  validate({ params: seqParams }),
  async (req, res) => {
    const { prisma } = await import('@wp/db');
    const leagueRound = await prisma.leagueRound.findFirstOrThrow({
      where: { leagueId: req.league!.leagueId, sequence: Number(req.params.sequence) },
      select: { id: true },
    });
    const submitted = await submitRound(req.user!.id, leagueRound.id);
    res.json({ submitted });
  },
);

/** Everyone's picks — gated on the deadline unless the league reveals early. */
predictionRouter.get(
  '/leagues/:slug/rounds/:sequence/picks',
  requireUser,
  loadLeague,
  requireMember,
  validate({ params: seqParams }),
  async (req, res) => {
    const { prisma, LeagueRoundStatus } = await import('@wp/db');
    const leagueRound = await prisma.leagueRound.findFirstOrThrow({
      where: { leagueId: req.league!.leagueId, sequence: Number(req.params.sequence) },
      include: { ruleSet: { select: { revealPicksBeforeDeadline: true } } },
    });

    // ⚠️ Hidden picks are FILTERED SERVER-SIDE (§15.3). Sending them and
    // hiding with CSS is a devtools tab away from being cheating.
    if (
      leagueRound.status === LeagueRoundStatus.UPCOMING &&
      !leagueRound.ruleSet.revealPicksBeforeDeadline
    ) {
      return res.json({ picks: [], hiddenUntilDeadline: true });
    }

    const picks = await prisma.prediction.findMany({
      where: { leagueFixture: { leagueRoundId: leagueRound.id }, status: { not: 'DRAFT' } },
      include: {
        user: { select: { id: true, username: true, displayName: true } },
        selections: true,
        score: { select: { points: true, breakdown: true } },
      },
    });

    res.json({
      hiddenUntilDeadline: false,
      picks: picks.map((p) => ({
        leagueFixtureId: p.leagueFixtureId,
        user: p.user,
        note: p.note,
        selections: p.selections,
        points: p.score?.points ?? null,
        breakdown: p.score?.breakdown ?? null,
      })),
    });
  },
);
