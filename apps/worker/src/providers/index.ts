import { capabilitiesFromEnv, type WorkerEnv } from '@wp/shared/env';
import type { Logger } from '../logger.js';
import { FootballDataOrgProvider } from './football-data/adapter.js';
import type { FootballProvider } from './types.js';

export function createProvider(env: WorkerEnv, log: Logger): FootballProvider {
  return FootballDataOrgProvider.create({
    baseUrl: env.FOOTBALL_API_BASE,
    token: env.FOOTBALL_API_TOKEN,
    rateLimitPerMin: env.FOOTBALL_RATE_LIMIT_PER_MIN,
    capabilities: capabilitiesFromEnv(env),
    log,
  });
}

export type { FootballProvider } from './types.js';
