import { Router } from 'express';
import { z } from 'zod';
import { BoosterType, prisma } from '@wp/db';
import { loadUser, requireUser } from '../../middleware/auth.js';
import { noStore } from '../../middleware/cache.js';
import { loadLeague, requireMember } from '../../middleware/league.js';
import { validate } from '../../middleware/validate.js';
import {
  boosterBudget,
  revokeBooster,
  roundBoosters,
  useBooster,
} from '../../services/boosters.service.js';

export const boosterRouter: Router = Router();
boosterRouter.use(noStore, loadUser);

const seqParams = z.object({ slug: z.string(), sequence: z.coerce.number().int().min(1) });

/** What this member has left for the season. */
boosterRouter.get(
  '/leagues/:slug/boosters',
  requireUser,
  loadLeague,
  requireMember,
  async (req, res) => {
    res.json({ boosters: await boosterBudget(req.league!.leagueId, req.user!.id) });
  },
);

boosterRouter.post(
  '/leagues/:slug/rounds/:sequence/booster',
  requireUser,
  loadLeague,
  requireMember,
  validate({
    params: seqParams,
    body: z.object({
      type: z.nativeEnum(BoosterType),
      leagueFixtureId: z.string().optional(),
    }),
  }),
  async (req, res) => {
    const body = req.body as { type: BoosterType; leagueFixtureId?: string };
    const result = await useBooster({
      leagueId: req.league!.leagueId,
      userId: req.user!.id,
      sequence: Number(req.params.sequence),
      type: body.type,
      ...(body.leagueFixtureId ? { leagueFixtureId: body.leagueFixtureId } : {}),
    });

    res.status(201).json({
      type: result.usage.type,
      // The value is echoed back from the SNAPSHOT, not from the current rule
      // set — that is the thing being guaranteed.
      value: Number(result.usage.resolvedValue),
      leagueFixtureId: body.leagueFixtureId ?? null,
    });
  },
);

boosterRouter.delete(
  '/leagues/:slug/rounds/:sequence/booster/:type',
  requireUser,
  loadLeague,
  requireMember,
  validate({
    params: seqParams.extend({ type: z.nativeEnum(BoosterType) }),
  }),
  async (req, res) => {
    await revokeBooster({
      leagueId: req.league!.leagueId,
      userId: req.user!.id,
      sequence: Number(req.params.sequence),
      type: req.params.type as BoosterType,
    });
    res.status(204).end();
  },
);

/** Boosters already placed in one round. */
boosterRouter.get(
  '/leagues/:slug/rounds/:sequence/boosters',
  requireUser,
  loadLeague,
  requireMember,
  validate({ params: seqParams }),
  async (req, res) => {
    const leagueRound = await prisma.leagueRound.findFirstOrThrow({
      where: { leagueId: req.league!.leagueId, sequence: Number(req.params.sequence) },
      select: { id: true },
    });
    res.json({ used: await roundBoosters(leagueRound.id, req.user!.id) });
  },
);

/**
 * League activity feed (task P5-08).
 *
 * Rendered from AuditLog so admin power is TRANSPARENT rather than silent
 * (§15.3). Every member can see who changed the rules, moved a deadline, or
 * removed someone — which is what makes an admin who also competes tolerable.
 */
boosterRouter.get('/leagues/:slug/activity', loadLeague, requireMember, async (req, res) => {
  const entries = await prisma.auditLog.findMany({
    where: { entityId: { startsWith: req.league!.leagueId } },
    include: { actor: { select: { username: true, displayName: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  res.json({
    activity: entries.map((e) => ({
      id: e.id,
      action: e.action,
      actor: e.actor?.displayName ?? 'System',
      createdAt: e.createdAt,
      summary: summarise(e.action, e.before, e.after),
    })),
  });
});

/** Plain English, not a JSON diff — the feed is for members, not developers. */
function summarise(action: string, before: unknown, after: unknown): string {
  switch (action) {
    case 'league.create':
      return 'created the league';
    case 'league.update':
      return 'updated the league settings';
    case 'league.archive':
      return 'archived the league';
    case 'league.transfer':
      return 'transferred ownership';
    case 'member.update':
      return 'changed a member';
    case 'ruleset.update':
      return 'edited the scoring rules';
    case 'ruleset.version': {
      const from = (before as { version?: number } | null)?.version;
      const to = (after as { version?: number } | null)?.version;
      return from && to
        ? `changed the scoring rules (version ${from} to ${to})`
        : 'changed the scoring rules';
    }
    default:
      return action;
  }
}
