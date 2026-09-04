import { hash, verify } from '@node-rs/argon2';
import { Router } from 'express';
import { prisma } from '@wp/db';
import { loginSchema, registerSchema } from '@wp/shared/dto/auth';
import { conflict, unauthorized } from '../../errors.js';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  setSessionCookie,
} from '../../lib/session.js';
import { loadUser, requireUser } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';

/**
 * Argon2id parameters from architecture.md §15.1: m=19456 KiB, t=2, p=1.
 * These are the OWASP-recommended minimums; raising memory is the meaningful
 * lever if we ever need to harden further.
 */
const ARGON2 = { memoryCost: 19456, timeCost: 2, parallelism: 1, algorithm: 2 as const };

/**
 * A dummy hash to verify against when the email is unknown, so a failed login
 * costs the same time whether or not the account exists. Without it, response
 * timing enumerates registered emails.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$B2f7pVQ4mDMzMv3aVoBRlpHJmXvQyHqXKZQ0RZjfXKI';

export const authRouter: Router = Router();

authRouter.post('/register', validate({ body: registerSchema }), async (req, res) => {
  const { email, username, password, displayName } = req.body;

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
    select: { email: true, username: true },
  });

  if (existing) {
    // Which field collided is safe to reveal on *registration* — the user is
    // about to find out anyway, and hiding it makes the form unusable.
    const field = existing.email === email ? 'email' : 'username';
    throw conflict(
      'account-exists',
      'Account already exists',
      field === 'email' ? 'An account with that email already exists.' : 'That username is taken.',
      [{ code: 'ALREADY_TAKEN', field }],
    );
  }

  const user = await prisma.user.create({
    data: {
      email,
      username,
      displayName: displayName ?? username,
      passwordHash: await hash(password, ARGON2),
    },
  });

  const session = await createSession(user.id, req);
  setSessionCookie(res, session.id, session.expiresAt);

  req.log?.info({ userId: user.id }, 'user registered');

  res.status(201).json({
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      isAdmin: user.isAdmin,
      timezone: user.timezone,
    },
  });
});

authRouter.post('/login', validate({ body: loginSchema }), async (req, res) => {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({ where: { email } });

  // Always run a verification, even with no user, to keep timing flat.
  const valid = await verify(user?.passwordHash ?? DUMMY_HASH, password).catch(() => false);

  if (!user || !user.passwordHash || !valid || user.deletedAt) {
    throw unauthorized('Email or password is incorrect.');
  }

  const session = await createSession(user.id, req);
  setSessionCookie(res, session.id, session.expiresAt);

  req.log?.info({ userId: user.id }, 'user signed in');

  res.json({
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      isAdmin: user.isAdmin,
      timezone: user.timezone,
    },
  });
});

authRouter.post('/logout', loadUser, async (req, res) => {
  if (req.sessionId) await destroySession(req.sessionId);
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get('/session', loadUser, requireUser, (req, res) => {
  res.json({ user: req.user });
});
