import { prisma } from '@wp/db';
import { apiEnvSchema, parseEnv } from '@wp/shared/env';
import { createApp } from './app.js';
import { closeRedis } from './lib/redis.js';
import { logger } from './logger.js';

const env = parseEnv(apiEnvSchema);

const app = createApp({ webOrigin: env.WEB_BASE_URL });

// Every PaaS (Render, Railway, Fly, Heroku) assigns the port at boot via
// $PORT and routes to whatever the process actually binds. API_PORT stays the
// local default so nothing changes in development.
const port = Number(process.env.PORT) || env.API_PORT;

const server = app.listen(port, () => {
  logger.info(
    { port, env: env.NODE_ENV, web: env.WEB_BASE_URL },
    `API listening on ${env.API_BASE_URL}`,
  );
});

/**
 * Graceful shutdown: stop accepting connections, let in-flight requests
 * finish, then close the pools. A hard exit mid-request during a deadline
 * rush would drop predictions users believe they submitted.
 */
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');

  const force = setTimeout(() => {
    logger.error('graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 10_000);
  force.unref();

  server.close(async () => {
    await Promise.allSettled([prisma.$disconnect(), closeRedis()]);
    logger.info('shutdown complete');
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandled rejection');
});
