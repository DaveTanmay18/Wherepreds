import { z } from 'zod';

/**
 * Environment validation. Every app parses its slice at boot and exits on
 * failure — a missing key should stop the process immediately, not surface as
 * `undefined` three hours later during a deadline rush.
 *
 * See docs/architecture.md Appendix B and task P0-05.
 */

const boolish = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const port = z.coerce.number().int().positive().max(65535);

export const databaseEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),
  READ_REPLICA_URL: z.string().url().or(z.literal('')).optional(),
});

export const redisEnvSchema = z.object({
  REDIS_URL: z.string().url(),
});

/**
 * ⚠️ The API treats Redis as a pure CACHE and degrades to Postgres when it is
 * missing or down (apps/api/src/lib/redis.ts says so explicitly), so requiring
 * the URL there contradicted the code — and blocked booting on any host where
 * Redis has not been provisioned yet. The WORKER keeps the required schema:
 * BullMQ has no fallback, and a worker without a queue is a silent no-op.
 */
export const optionalRedisEnvSchema = z.object({
  REDIS_URL: z.string().url().optional(),
});

export const authEnvSchema = z.object({
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_PRIVATE_KEY: z.string().optional(),
});

/**
 * Provider capabilities are environment-driven so that upgrading the
 * football-data.org plan is a config change and a redeploy, never a code
 * change. See architecture.md §11.5.
 */
export const footballEnvSchema = z.object({
  FOOTBALL_PROVIDER: z.literal('football-data-org').default('football-data-org'),
  FOOTBALL_API_TOKEN: z.string().min(1),
  FOOTBALL_API_BASE: z.string().url().default('https://api.football-data.org/v4'),
  /**
   * Calls per MINUTE, not per month. Free = 10, Free w/ Livescores = 20,
   * Free + Deep Data = 30, Standard = 60. Exceeding it fails immediately and
   * during exactly the window that matters most (§11.2).
   */
  FOOTBALL_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).max(200).default(10),
  /** goals[], bookings[], substitutions, lineups, squads. */
  FOOTBALL_CAP_DEEP_DATA: boolish.default('false'),
  /** Statistic add-on: corners, shots, possession. */
  FOOTBALL_CAP_STATISTICS: boolish.default('false'),
  FOOTBALL_COMPETITIONS: z
    .string()
    .default('PL,PD,SA,BL1,FL1,CL')
    .transform((s) =>
      s
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean),
    ),
});

export const appEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  API_PORT: port.default(4000),
  API_BASE_URL: z.string().url(),
  WEB_BASE_URL: z.string().url(),
});

export const apiEnvSchema = appEnvSchema
  .merge(databaseEnvSchema)
  .merge(optionalRedisEnvSchema)
  .merge(authEnvSchema);

export const workerEnvSchema = appEnvSchema
  .merge(databaseEnvSchema)
  .merge(redisEnvSchema)
  .merge(footballEnvSchema);

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;
export type FootballEnv = z.infer<typeof footballEnvSchema>;

/**
 * Parse or die. Prints every problem at once rather than one per restart,
 * because fixing env vars one round-trip at a time is miserable.
 */
export function parseEnv<T extends z.ZodTypeAny>(
  schema: T,
  source: NodeJS.ProcessEnv = process.env,
): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    console.error(
      `\nInvalid environment.\n${issues}\n\nCopy .env.example to .env and fill it in.\n`,
    );
    process.exit(1);
  }
  return result.data;
}

/**
 * Derived from the env flags above. Gates which markets a league may enable
 * (§11.5) — a market the plan cannot score is rejected at rule validation
 * rather than silently awarding nobody any points for a whole season.
 */
export type ProviderCapabilities = {
  livescores: boolean;
  goalEvents: boolean;
  cardEvents: boolean;
  teamStatistics: boolean;
  playerMatchStats: false;
  expectedGoals: false;
};

export function capabilitiesFromEnv(env: FootballEnv): ProviderCapabilities {
  return {
    // The free tier serves delayed scores; anything paid is live.
    livescores: env.FOOTBALL_RATE_LIMIT_PER_MIN > 10,
    goalEvents: env.FOOTBALL_CAP_DEEP_DATA,
    cardEvents: env.FOOTBALL_CAP_DEEP_DATA,
    teamStatistics: env.FOOTBALL_CAP_STATISTICS,
    // Never available from football-data.org at any price.
    playerMatchStats: false,
    expectedGoals: false,
  };
}
