import { randomBytes, createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { prisma } from '@wp/db';
import { cacheDel, cacheGet, cacheSet } from './redis.js';

/**
 * Server-side sessions (architecture.md §15.1).
 *
 * Opaque 256-bit tokens, not JWTs. A compromised or abusive account must be
 * terminable *now*, and a stateless token cannot offer that — prediction
 * integrity depends on being able to kill a session instantly.
 */

export const SESSION_COOKIE = 'wp_session';
const SESSION_TTL_DAYS = 30;
const RENEW_AFTER_DAYS = 1; // sliding renewal once a session is a day old
const CACHE_TTL_SECONDS = 300;

const ttlMs = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

export type SessionUser = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  timezone: string;
};

const cacheKey = (id: string) => `session:${id}`;

/** IPs are hashed, never stored raw (§15.4). */
function hashIp(ip: string | undefined): string | null {
  if (!ip) return null;
  const salt = process.env.SESSION_SECRET ?? '';
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}

export async function createSession(
  userId: string,
  req: Request,
): Promise<{ id: string; expiresAt: Date }> {
  const id = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlMs);

  await prisma.session.create({
    data: {
      id,
      userId,
      expiresAt,
      userAgent: req.get('user-agent')?.slice(0, 255) ?? null,
      ipHash: hashIp(req.ip),
    },
  });

  return { id, expiresAt };
}

export async function readSession(sessionId: string): Promise<SessionUser | null> {
  const cached = await cacheGet(cacheKey(sessionId));
  if (cached) {
    try {
      return JSON.parse(cached) as SessionUser;
    } catch {
      /* fall through to the database */
    }
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { user: true },
  });

  if (!session || session.expiresAt < new Date() || session.user.deletedAt) {
    if (session) await destroySession(sessionId);
    return null;
  }

  // Sliding renewal, so an active user is never logged out mid-season.
  const age = Date.now() - session.createdAt.getTime();
  if (age > RENEW_AFTER_DAYS * 24 * 60 * 60 * 1000) {
    const expiresAt = new Date(Date.now() + ttlMs);
    await prisma.session.update({ where: { id: sessionId }, data: { expiresAt } });
  }

  const user: SessionUser = {
    id: session.user.id,
    email: session.user.email,
    username: session.user.username,
    displayName: session.user.displayName,
    avatarUrl: session.user.avatarUrl,
    isAdmin: session.user.isAdmin,
    timezone: session.user.timezone,
  };

  await cacheSet(cacheKey(sessionId), JSON.stringify(user), CACHE_TTL_SECONDS);
  return user;
}

export async function destroySession(sessionId: string): Promise<void> {
  await cacheDel(cacheKey(sessionId));
  await prisma.session.deleteMany({ where: { id: sessionId } });
}

/** Invalidate every session for a user — used on password change and on ban. */
export async function destroyAllSessions(userId: string): Promise<void> {
  const sessions = await prisma.session.findMany({ where: { userId }, select: { id: true } });
  await Promise.all(sessions.map((s) => cacheDel(cacheKey(s.id))));
  await prisma.session.deleteMany({ where: { userId } });
}

export function setSessionCookie(res: Response, id: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE, id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: expiresAt,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}
