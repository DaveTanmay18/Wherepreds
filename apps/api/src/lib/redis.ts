import Redis from 'ioredis';
import { logger } from '../logger.js';

/**
 * Redis is a CACHE here, never the source of truth. Sessions live in Postgres
 * (§15.1); Redis only makes the lookup cheap. So the API must run correctly
 * with Redis absent or down — it just runs slower.
 *
 * That is a deliberate call: an outage in the cache tier must not log every
 * user out thirty minutes before a Saturday deadline.
 */
let client: Redis | null = null;
let warned = false;

export function getRedis(): Redis | null {
  if (client) return client;

  const url = process.env.REDIS_URL;
  if (!url) {
    if (!warned) {
      logger.warn('REDIS_URL not set — running without cache. Sessions read from Postgres.');
      warned = true;
    }
    return null;
  }

  client = new Redis(url, {
    maxRetriesPerRequest: 2,
    lazyConnect: true,
    retryStrategy: (times) => (times > 5 ? null : Math.min(times * 200, 2000)),
  });

  client.on('error', (err) => {
    if (!warned) {
      logger.warn({ err: err.message }, 'redis unavailable — degrading to Postgres-only');
      warned = true;
    }
  });

  client.connect().catch(() => {
    /* handled by the error listener above */
  });

  return client;
}

/** Never let a cache failure fail a request. */
export async function cacheGet(key: string): Promise<string | null> {
  try {
    return (await getRedis()?.get(key)) ?? null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  try {
    await getRedis()?.set(key, value, 'EX', ttlSeconds);
  } catch {
    /* ignore */
  }
}

export async function cacheDel(key: string): Promise<void> {
  try {
    await getRedis()?.del(key);
  } catch {
    /* ignore */
  }
}

export async function closeRedis(): Promise<void> {
  await client?.quit().catch(() => undefined);
  client = null;
}
