import { randomBytes } from 'node:crypto';
import { MemberRole, MemberStatus, prisma, type PredictionLeague } from '@wp/db';
import { instantiatePreset, type PresetId } from '@wp/scoring';
import type { CreateLeagueInput } from '@wp/shared/dto/league';
import { conflict, notFound } from '../errors.js';
import { materialiseRounds } from './rounds.service.js';

/**
 * League creation and membership (tasks P2-01 to P2-03, P2-11).
 */

/**
 * Join codes exclude I, O, 0 and 1. These get read aloud in a pub and typed
 * on a phone keyboard, and a code nobody can dictate accurately is a code
 * nobody uses.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateJoinCode(): string {
  const bytes = randomBytes(6);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

function slugify(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'league'
  );
}

/** Retries on collision rather than pre-checking, which would race. */
async function uniqueSlug(base: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${randomBytes(2).toString('hex')}`;
    const taken = await prisma.predictionLeague.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  return `${base}-${randomBytes(4).toString('hex')}`;
}

async function uniqueJoinCode(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generateJoinCode();
    const taken = await prisma.predictionLeague.findUnique({
      where: { joinCode: code },
      select: { id: true },
    });
    if (!taken) return code;
  }
  throw new Error('Could not allocate a unique join code');
}

/**
 * Creates the league, its owner membership and RuleSet v1 in ONE transaction.
 * A league without an active rule set could not score anything, and a partial
 * create would leave exactly that.
 */
export async function createLeague(
  ownerId: string,
  input: CreateLeagueInput,
): Promise<PredictionLeague> {
  const season = await prisma.season.findUnique({
    where: { id: input.seasonId },
    select: { id: true, competition: { select: { name: true } } },
  });
  if (!season) throw notFound('No such season.');

  const slug = await uniqueSlug(slugify(input.name));
  const joinCode = await uniqueJoinCode();

  // Copied, never referenced — editing a preset must not alter live leagues.
  const config = instantiatePreset(input.presetId as PresetId);

  return prisma.$transaction(async (tx) => {
    const league = await tx.predictionLeague.create({
      data: {
        slug,
        name: input.name,
        description: input.description ?? null,
        ownerId,
        seasonId: input.seasonId,
        visibility: input.visibility,
        joinCode,
        maxMembers: input.maxMembers ?? null,
      },
    });

    await tx.ruleSet.create({
      data: {
        leagueId: league.id,
        version: 1,
        name: 'House rules',
        isActive: true,
        isFrozen: false,
        config,
        createdById: ownerId,
        // Promoted columns the interpreter and locking job read directly.
        knockoutScoreBasis: 'NINETY_MINUTES',
        deadlineStrategy: 'ROUND_FIRST_KICKOFF',
        maxBoostersPerSeason: config.boosters.reduce((n, b) => n + b.usesPerSeason, 0),
      },
    });

    await tx.leagueMembership.create({
      data: {
        leagueId: league.id,
        userId: ownerId,
        role: MemberRole.OWNER,
        status: MemberStatus.ACTIVE,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: ownerId,
        action: 'league.create',
        entityType: 'PredictionLeague',
        entityId: league.id,
        after: { name: league.name, preset: input.presetId, visibility: input.visibility },
      },
    });

    return league;
  });
}

/**
 * Materialises rounds immediately after creation so the league is playable at
 * once. Kept OUT of the creation transaction: a season can have 38+ rounds and
 * holding a transaction open across all of them against a serverless database
 * is exactly the long transaction §7.4 warns about. If this fails the league
 * still exists and the job can be re-run — it is idempotent.
 */
export async function createLeagueWithRounds(ownerId: string, input: CreateLeagueInput) {
  const league = await createLeague(ownerId, input);
  const rounds = await materialiseRounds(league.id).catch(() => ({ created: 0, updated: 0 }));
  return { league, rounds };
}

export type JoinResult = { leagueSlug: string; alreadyMember: boolean };

/**
 * Join by code or invite token. Re-joining after leaving reactivates the old
 * membership rather than creating a second one, which the unique constraint
 * would refuse anyway.
 */
export async function joinLeague(
  userId: string,
  input: { joinCode?: string; inviteToken?: string },
): Promise<JoinResult> {
  const league = input.inviteToken
    ? await leagueFromInvite(input.inviteToken)
    : await prisma.predictionLeague.findUnique({
        where: { joinCode: input.joinCode! },
        select: { id: true, slug: true, maxMembers: true, isArchived: true },
      });

  if (!league || league.isArchived) throw notFound('That code or link is not valid.');

  const existing = await prisma.leagueMembership.findUnique({
    where: { leagueId_userId: { leagueId: league.id, userId } },
  });

  if (existing?.status === MemberStatus.BANNED) {
    throw conflict('banned', 'Removed from league', 'You cannot rejoin this league.');
  }
  if (existing?.status === MemberStatus.ACTIVE) {
    return { leagueSlug: league.slug, alreadyMember: true };
  }

  if (league.maxMembers) {
    const count = await prisma.leagueMembership.count({
      where: { leagueId: league.id, status: MemberStatus.ACTIVE },
    });
    if (count >= league.maxMembers) {
      throw conflict('league-full', 'League full', 'This league has reached its member limit.');
    }
  }

  await prisma.leagueMembership.upsert({
    where: { leagueId_userId: { leagueId: league.id, userId } },
    update: { status: MemberStatus.ACTIVE, leftAt: null },
    create: {
      leagueId: league.id,
      userId,
      role: MemberRole.MEMBER,
      status: MemberStatus.ACTIVE,
    },
  });

  if (input.inviteToken) {
    await prisma.leagueInvite.updateMany({
      where: { token: input.inviteToken },
      data: { useCount: { increment: 1 } },
    });
  }

  return { leagueSlug: league.slug, alreadyMember: false };
}

async function leagueFromInvite(token: string) {
  const invite = await prisma.leagueInvite.findUnique({
    where: { token },
    include: {
      league: { select: { id: true, slug: true, maxMembers: true, isArchived: true } },
    },
  });

  if (!invite || invite.expiresAt < new Date() || invite.useCount >= invite.maxUses) {
    throw notFound('That invite link has expired or been used up.');
  }
  return invite.league;
}

/**
 * Leaving is a status change, not a delete: predictions already made stay
 * attached, so historical rounds keep their full field (§15.4).
 */
export async function leaveLeague(userId: string, leagueId: string, ownerId: string) {
  if (userId === ownerId) {
    throw conflict(
      'owner-cannot-leave',
      'Transfer ownership first',
      'Transfer the league to another member before leaving.',
    );
  }
  await prisma.leagueMembership.updateMany({
    where: { leagueId, userId },
    data: { status: MemberStatus.LEFT, leftAt: new Date() },
  });
}

export function createInviteToken(): string {
  return randomBytes(24).toString('base64url');
}
