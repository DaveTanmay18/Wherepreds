import { Router } from 'express';
import { z } from 'zod';
import { MemberRole, MemberStatus, prisma } from '@wp/db';
import { PRESET_LIST } from '@wp/scoring';
import {
  createInviteSchema,
  createLeagueSchema,
  joinLeagueSchema,
  updateLeagueSchema,
  updateMemberSchema,
} from '@wp/shared/dto/league';
import { forbidden, notFound } from '../../errors.js';
import { noStore } from '../../middleware/cache.js';
import { loadUser, requireUser } from '../../middleware/auth.js';
import {
  loadLeague,
  requireLeagueAdmin,
  requireLeagueOwner,
  requireMember,
} from '../../middleware/league.js';
import { validate } from '../../middleware/validate.js';
import {
  createInviteToken,
  createLeagueWithRounds,
  joinLeague,
  leaveLeague,
} from '../../services/league.service.js';
import { nextRound } from '../../services/rounds.service.js';

export const leagueRouter: Router = Router();

// Leagues are user-scoped: a shared cache holding one member's view would
// leak it to the whole league (§12.3).
leagueRouter.use(noStore, loadUser);

// ── Presets (public, no league context) ───────────────────────────────────

leagueRouter.get('/rules/presets', (_req, res) => {
  res.json({
    presets: PRESET_LIST.map((p) => ({
      id: p.id,
      name: p.name,
      summary: p.summary,
      highlights: p.highlights,
      markets: p.config.markets,
    })),
  });
});

// ── Create / list ─────────────────────────────────────────────────────────

leagueRouter.post(
  '/leagues',
  requireUser,
  validate({ body: createLeagueSchema }),
  async (req, res) => {
    const { league, rounds } = await createLeagueWithRounds(req.user!.id, req.body);
    res.status(201).json({
      league: { slug: league.slug, name: league.name, joinCode: league.joinCode },
      rounds: rounds.created,
    });
  },
);

leagueRouter.get('/leagues/mine', requireUser, async (req, res) => {
  const memberships = await prisma.leagueMembership.findMany({
    where: { userId: req.user!.id, status: MemberStatus.ACTIVE },
    include: {
      league: {
        include: {
          season: {
            include: { competition: { select: { name: true, slug: true, logoUrl: true } } },
          },
          _count: { select: { memberships: true } },
        },
      },
    },
    orderBy: { joinedAt: 'desc' },
  });

  res.json({
    leagues: memberships
      .filter((m) => !m.league.isArchived)
      .map((m) => ({
        slug: m.league.slug,
        name: m.league.name,
        role: m.role,
        memberCount: m.league._count.memberships,
        competition: m.league.season.competition,
        seasonLabel: m.league.season.label,
      })),
  });
});

leagueRouter.get(
  '/leagues/public',
  validate({
    query: z.object({
      seasonId: z.string().optional(),
      q: z.string().trim().max(60).optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }),
  }),
  async (req, res) => {
    const q = req.query as unknown as { seasonId?: string; q?: string; limit: number };

    const leagues = await prisma.predictionLeague.findMany({
      where: {
        visibility: 'PUBLIC',
        isArchived: false,
        ...(q.seasonId ? { seasonId: q.seasonId } : {}),
        ...(q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {}),
      },
      take: q.limit,
      orderBy: { createdAt: 'desc' },
      include: {
        season: { include: { competition: { select: { name: true, slug: true } } } },
        _count: { select: { memberships: true } },
      },
    });

    res.json({
      leagues: leagues.map((l) => ({
        slug: l.slug,
        name: l.name,
        description: l.description,
        memberCount: l._count.memberships,
        competition: l.season.competition,
        seasonLabel: l.season.label,
      })),
    });
  },
);

// ── Join / leave ──────────────────────────────────────────────────────────

leagueRouter.post(
  '/leagues/join',
  requireUser,
  validate({ body: joinLeagueSchema }),
  async (req, res) => {
    const result = await joinLeague(req.user!.id, req.body);
    res.status(result.alreadyMember ? 200 : 201).json(result);
  },
);

// ── Single league ─────────────────────────────────────────────────────────

leagueRouter.get('/leagues/:slug', loadLeague, async (req, res) => {
  const league = await prisma.predictionLeague.findUniqueOrThrow({
    where: { id: req.league!.leagueId },
    include: {
      owner: { select: { id: true, username: true, displayName: true } },
      season: { include: { competition: { select: { name: true, slug: true, logoUrl: true } } } },
      ruleSets: { where: { isActive: true }, take: 1 },
      _count: { select: { memberships: true, rounds: true } },
    },
  });

  res.json({
    league: {
      slug: league.slug,
      name: league.name,
      description: league.description,
      visibility: league.visibility,
      // Only members ever see the join code — it is the credential.
      joinCode: req.league!.isMember ? league.joinCode : null,
      owner: league.owner,
      competition: league.season.competition,
      seasonId: league.seasonId,
      seasonLabel: league.season.label,
      memberCount: league._count.memberships,
      roundCount: league._count.rounds,
      rules: league.ruleSets[0]
        ? {
            version: league.ruleSets[0].version,
            name: league.ruleSets[0].name,
            isFrozen: league.ruleSets[0].isFrozen,
            config: league.ruleSets[0].config,
          }
        : null,
      viewer: { role: req.league!.role, isMember: req.league!.isMember },
      nextRound: await nextRound(league.id),
    },
  });
});

leagueRouter.patch(
  '/leagues/:slug',
  requireUser,
  loadLeague,
  requireLeagueAdmin,
  validate({ body: updateLeagueSchema }),
  async (req, res) => {
    const league = await prisma.predictionLeague.update({
      where: { id: req.league!.leagueId },
      data: req.body,
    });
    await prisma.auditLog.create({
      data: {
        actorId: req.user!.id,
        action: 'league.update',
        entityType: 'PredictionLeague',
        entityId: league.id,
        after: req.body,
      },
    });
    res.json({ league: { slug: league.slug, name: league.name } });
  },
);

leagueRouter.delete(
  '/leagues/:slug',
  requireUser,
  loadLeague,
  requireLeagueOwner,
  async (req, res) => {
    // Soft delete: predictions and standings stay intact so a member's history
    // is not silently rewritten (§15.4).
    await prisma.predictionLeague.update({
      where: { id: req.league!.leagueId },
      data: { isArchived: true },
    });
    await prisma.auditLog.create({
      data: {
        actorId: req.user!.id,
        action: 'league.archive',
        entityType: 'PredictionLeague',
        entityId: req.league!.leagueId,
      },
    });
    res.status(204).end();
  },
);

leagueRouter.post(
  '/leagues/:slug/leave',
  requireUser,
  loadLeague,
  requireMember,
  async (req, res) => {
    await leaveLeague(req.user!.id, req.league!.leagueId, req.league!.ownerId);
    res.status(204).end();
  },
);

// ── Members ───────────────────────────────────────────────────────────────

leagueRouter.get('/leagues/:slug/members', loadLeague, requireMember, async (req, res) => {
  const members = await prisma.leagueMembership.findMany({
    where: {
      leagueId: req.league!.leagueId,
      status: { in: [MemberStatus.ACTIVE, MemberStatus.INVITED] },
    },
    include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
    orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
  });

  res.json({
    members: members.map((m) => ({
      userId: m.user.id,
      username: m.user.username,
      displayName: m.nickname ?? m.user.displayName,
      avatarUrl: m.user.avatarUrl,
      role: m.role,
      status: m.status,
      joinedAt: m.joinedAt,
    })),
  });
});

leagueRouter.patch(
  '/leagues/:slug/members/:userId',
  requireUser,
  loadLeague,
  requireLeagueAdmin,
  validate({
    params: z.object({ slug: z.string(), userId: z.string() }),
    body: updateMemberSchema,
  }),
  async (req, res) => {
    const targetId = req.params.userId as string;

    if (targetId === req.league!.ownerId) {
      throw forbidden('The league owner cannot be modified.');
    }
    // Promotion to ADMIN is owner-only (§15.2) — an admin promoting other
    // admins would let one compromised account escalate the whole league.
    if (req.body.role === MemberRole.ADMIN && req.user!.id !== req.league!.ownerId) {
      throw forbidden('Only the league owner can promote members to admin.');
    }

    await prisma.leagueMembership.updateMany({
      where: { leagueId: req.league!.leagueId, userId: targetId },
      data: {
        ...(req.body.role ? { role: req.body.role } : {}),
        ...(req.body.status ? { status: req.body.status } : {}),
        ...(req.body.nickname !== undefined ? { nickname: req.body.nickname } : {}),
      },
    });

    // Admin power is transparent, not silent: this feeds the activity feed
    // every member can read (§15.3).
    await prisma.auditLog.create({
      data: {
        actorId: req.user!.id,
        action: 'member.update',
        entityType: 'LeagueMembership',
        entityId: `${req.league!.leagueId}:${targetId}`,
        after: req.body,
      },
    });

    res.status(204).end();
  },
);

leagueRouter.post(
  '/leagues/:slug/transfer',
  requireUser,
  loadLeague,
  requireLeagueOwner,
  validate({ body: z.object({ userId: z.string() }) }),
  async (req, res) => {
    const newOwnerId = req.body.userId as string;
    const target = await prisma.leagueMembership.findUnique({
      where: { leagueId_userId: { leagueId: req.league!.leagueId, userId: newOwnerId } },
    });
    if (!target || target.status !== MemberStatus.ACTIVE) {
      throw notFound('That member is not in this league.');
    }

    await prisma.$transaction([
      prisma.predictionLeague.update({
        where: { id: req.league!.leagueId },
        data: { ownerId: newOwnerId },
      }),
      prisma.leagueMembership.update({
        where: { leagueId_userId: { leagueId: req.league!.leagueId, userId: newOwnerId } },
        data: { role: MemberRole.OWNER },
      }),
      prisma.leagueMembership.update({
        where: { leagueId_userId: { leagueId: req.league!.leagueId, userId: req.user!.id } },
        data: { role: MemberRole.ADMIN },
      }),
      prisma.auditLog.create({
        data: {
          actorId: req.user!.id,
          action: 'league.transfer',
          entityType: 'PredictionLeague',
          entityId: req.league!.leagueId,
          after: { newOwnerId },
        },
      }),
    ]);

    res.status(204).end();
  },
);

// ── Invites ───────────────────────────────────────────────────────────────

leagueRouter.post(
  '/leagues/:slug/invites',
  requireUser,
  loadLeague,
  requireLeagueAdmin,
  validate({ body: createInviteSchema }),
  async (req, res) => {
    const token = createInviteToken();
    const expiresAt = new Date(Date.now() + req.body.expiresInDays * 24 * 3600_000);

    await prisma.leagueInvite.create({
      data: {
        leagueId: req.league!.leagueId,
        email: req.body.email ?? null,
        token,
        invitedById: req.user!.id,
        maxUses: req.body.maxUses,
        expiresAt,
      },
    });

    res.status(201).json({ token, expiresAt, path: `/join/${token}` });
  },
);

// The activity feed lives in boosters.ts, where it renders AuditLog entries
// as plain-English summaries rather than raw rows (task P5-08).

// Guard against a route ordering mistake: /leagues/mine must never be matched
// as a slug. Express matches in declaration order, so `mine` and `public` are
// declared above `:slug` — this assertion documents why that order matters.
if (process.env.NODE_ENV !== 'production') {
  const stack = (leagueRouter as unknown as { stack: { route?: { path: string } }[] }).stack;
  const paths = stack.map((l) => l.route?.path).filter(Boolean) as string[];
  const slugIdx = paths.indexOf('/leagues/:slug');
  const mineIdx = paths.indexOf('/leagues/mine');
  if (slugIdx !== -1 && mineIdx !== -1 && mineIdx > slugIdx) {
    throw new Error('Route order bug: /leagues/mine must be declared before /leagues/:slug');
  }
}
