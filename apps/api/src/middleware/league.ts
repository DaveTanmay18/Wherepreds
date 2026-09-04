import type { RequestHandler } from 'express';
import { MemberRole, MemberStatus, prisma } from '@wp/db';
import { forbidden, notFound, unauthorized } from '../errors.js';

/**
 * League authorization (architecture.md §15.2, task P2-04).
 *
 * Resolves the caller's membership ONCE per request into `req.membership`, and
 * enforces the permission matrix. Every admin action goes through this —
 * conditional rendering on the client is not authorization, which is exactly
 * what the P2-18 test matrix exists to prove.
 */

export type LeagueContext = {
  leagueId: string;
  slug: string;
  ownerId: string;
  role: MemberRole | null;
  status: MemberStatus | null;
  isMember: boolean;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      league?: LeagueContext;
    }
  }
}

/** Rank so comparisons read as "at least ADMIN" rather than a set membership. */
const RANK: Record<MemberRole, number> = {
  [MemberRole.MEMBER]: 1,
  [MemberRole.ADMIN]: 2,
  [MemberRole.OWNER]: 3,
};

/**
 * Loads the league by slug and the caller's membership. Does not enforce
 * anything by itself — public leagues are readable by anyone.
 */
export const loadLeague: RequestHandler = async (req, _res, next) => {
  const slug = req.params.slug as string | undefined;
  if (!slug) return next(notFound('No league specified.'));

  const league = await prisma.predictionLeague.findUnique({
    where: { slug },
    select: { id: true, slug: true, ownerId: true, visibility: true, isArchived: true },
  });

  if (!league || league.isArchived) return next(notFound('No such league.'));

  const membership = req.user
    ? await prisma.leagueMembership.findUnique({
        where: { leagueId_userId: { leagueId: league.id, userId: req.user.id } },
        select: { role: true, status: true },
      })
    : null;

  const active = membership?.status === MemberStatus.ACTIVE;

  req.league = {
    leagueId: league.id,
    slug: league.slug,
    ownerId: league.ownerId,
    role: active ? membership.role : null,
    status: membership?.status ?? null,
    isMember: active,
  };

  // A private league does not exist as far as a non-member is concerned.
  // Returning 403 would confirm the slug, which leaks that the league is real.
  if (league.visibility === 'PRIVATE' && !req.league.isMember && !req.user?.isAdmin) {
    return next(notFound('No such league.'));
  }

  next();
};

/** Requires an ACTIVE membership of at least `min`. */
export function requireLeagueRole(min: MemberRole): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!req.league) return next(notFound('No such league.'));

    // Platform admins bypass league roles for moderation, and every such
    // action is audit-logged so the power is visible rather than silent.
    if (req.user.isAdmin) return next();

    if (req.league.status === MemberStatus.BANNED) {
      return next(forbidden('You have been removed from this league.'));
    }
    if (!req.league.isMember || !req.league.role) {
      return next(forbidden('You are not a member of this league.'));
    }
    if (RANK[req.league.role] < RANK[min]) {
      return next(
        forbidden(
          min === MemberRole.OWNER
            ? 'Only the league owner can do that.'
            : 'Only league admins can do that.',
        ),
      );
    }
    next();
  };
}

// Explicit annotations: pnpm's nested node_modules make the inferred Express
// handler type unnameable across package boundaries (TS2742).
export const requireMember: RequestHandler = requireLeagueRole(MemberRole.MEMBER);
export const requireLeagueAdmin: RequestHandler = requireLeagueRole(MemberRole.ADMIN);
export const requireLeagueOwner: RequestHandler = requireLeagueRole(MemberRole.OWNER);
