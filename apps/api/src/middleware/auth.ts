import type { RequestHandler } from 'express';
import { unauthorized } from '../errors.js';
import { readSession, SESSION_COOKIE, type SessionUser } from '../lib/session.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
      sessionId?: string;
    }
  }
}

/**
 * Attaches `req.user` when a valid session cookie is present. Never rejects —
 * it only resolves identity. Use `requireUser` to enforce.
 */
export const loadUser: RequestHandler = async (req, _res, next) => {
  const sessionId = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!sessionId) return next();

  const user = await readSession(sessionId);
  if (user) {
    req.user = user;
    req.sessionId = sessionId;
  }
  next();
};

/** Enforces authentication. Assumes `loadUser` ran first. */
export const requireUser: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  next();
};

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!req.user.isAdmin) return next(unauthorized('Administrator access required.'));
  next();
};
