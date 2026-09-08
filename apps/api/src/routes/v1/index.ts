import { Router } from 'express';
import { prisma } from '@wp/db';
import { getRedis } from '../../lib/redis.js';
import { adminRouter } from './admin.js';
import { authRouter } from './auth.js';
import { footballRouter } from './football.js';
import { leagueRouter } from './leagues.js';
import { predictionRouter } from './predictions.js';
import { boosterRouter } from './boosters.js';
import { notificationRouter } from './notifications.js';
import { rulesRouter } from './rules.js';
import { standingsRouter } from './standings.js';

export const v1Router: Router = Router();

/**
 * Liveness + dependency check. Returns 200 only when Postgres answers; Redis
 * being down is reported but not fatal, because the API is designed to run
 * without it (see lib/redis.ts).
 */
v1Router.get('/health', async (_req, res) => {
  const started = Date.now();

  const db = await prisma.$queryRaw`SELECT 1`
    .then(() => 'ok' as const)
    .catch((e: Error) => e.message);

  let redis: string;
  const client = getRedis();
  if (!client) {
    redis = 'not-configured';
  } else {
    redis = await client
      .ping()
      .then(() => 'ok')
      .catch((e: Error) => e.message);
  }

  const healthy = db === 'ok';
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    checks: { db, redis },
    latencyMs: Date.now() - started,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

v1Router.use('/auth', authRouter);
v1Router.use('/', leagueRouter);
v1Router.use('/', predictionRouter);
v1Router.use('/', rulesRouter);
v1Router.use('/', boosterRouter);
v1Router.use('/', notificationRouter);
v1Router.use('/', standingsRouter);
v1Router.use('/', footballRouter);
v1Router.use('/', adminRouter);
