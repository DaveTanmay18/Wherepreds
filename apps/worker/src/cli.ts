import { prisma } from '@wp/db';
import { capabilitiesFromEnv, parseEnv, workerEnvSchema } from '@wp/shared/env';
import { logger } from './logger.js';
import { createProvider } from './providers/index.js';
import { ingestCompetitions, ingestSeasonStructure } from './jobs/season-structure.js';
import { ingestLive, ingestUpcoming } from './jobs/live.js';
import { ingestStandings } from './jobs/standings.js';
import { lockDueRounds } from './jobs/lock-rounds.js';
import { scoreLeagueRound } from './jobs/scoring.js';
import { rebuildStandings } from './jobs/standings.service.js';
import { handlePostponements, recomputeDeadlines, settleRounds } from './jobs/round-lifecycle.js';
import { buildTies, resolveTies } from './jobs/ties.js';
import { notifyDeadlines } from './jobs/notifications.js';
import type { JobContext } from './jobs/types.js';

/**
 * Run an ingest job directly, without Redis or BullMQ.
 *
 *   pnpm ingest competitions
 *   pnpm ingest season-structure PL
 *   pnpm ingest standings PL
 *   pnpm ingest upcoming
 *   pnpm ingest live
 *   pnpm ingest bootstrap        # competitions + all six seasons + standings
 *
 * Job logic takes a plain context rather than a BullMQ Job, so the same code
 * path runs here and in the queue. Useful for the first load of a season and
 * for reproducing an ingest failure locally.
 */
const env = parseEnv(workerEnvSchema);
const capabilities = capabilitiesFromEnv(env);
const ctx: JobContext = {
  log: logger,
  env,
  capabilities,
  provider: createProvider(env, logger),
};

const [command, ...args] = process.argv.slice(2);

async function main() {
  logger.info(
    { capabilities, rateLimitPerMin: env.FOOTBALL_RATE_LIMIT_PER_MIN },
    `running "${command}"`,
  );

  if (!capabilities.goalEvents) {
    logger.warn(
      'Deep Data is OFF — goals[]/bookings[] unavailable, so goalscorer and red-card markets stay gated off and PlayerMatchStat cannot be derived (task D-01c).',
    );
  }

  switch (command) {
    case 'competitions':
      return ingestCompetitions(ctx);

    case 'season-structure': {
      const code = args[0];
      if (!code) throw new Error('usage: ingest season-structure <CODE> [season]');
      return ingestSeasonStructure(ctx, {
        code,
        ...(args[1] ? { season: Number(args[1]) } : {}),
      });
    }

    case 'standings': {
      const code = args[0];
      if (!code) throw new Error('usage: ingest standings <CODE>');
      return ingestStandings(ctx, { code });
    }

    case 'upcoming':
      return ingestUpcoming(ctx);

    case 'live':
      return ingestLive(ctx);

    case 'lock':
      return lockDueRounds(logger);

    case 'ties': {
      const code = args[0] ?? 'CL';
      const season = await prisma.season.findFirstOrThrow({
        where: {
          competition: { slug: code === 'CL' ? 'champions-league' : code },
          isCurrent: true,
        },
      });
      const built = await buildTies(season.id, logger);
      const resolved = await resolveTies(season.id, logger);
      return { ...built, ...resolved };
    }

    case 'recompute-deadlines':
      return recomputeDeadlines(logger);

    case 'postponements':
      return handlePostponements(logger);

    case 'settle':
      return settleRounds(logger);

    case 'notify':
      return notifyDeadlines(logger);

    /** Everything the scheduler would run each minute, for local use. */
    case 'tick': {
      const deadlines = await recomputeDeadlines(logger);
      const postponed = await handlePostponements(logger);
      const locked = await lockDueRounds(logger);
      const settled = await settleRounds(logger);
      const notified = await notifyDeadlines(logger);
      return { deadlines, postponed, locked, settled, notified };
    }

    case 'score': {
      const id = args[0];
      if (!id) throw new Error('usage: ingest score <leagueRoundId>');
      return scoreLeagueRound(id, 'manual', logger);
    }

    case 'standings-rebuild': {
      const id = args[0];
      if (!id) throw new Error('usage: ingest standings-rebuild <leagueId> [fromSequence]');
      return rebuildStandings(id, args[1] ? Number(args[1]) : 1, logger);
    }

    case 'bootstrap': {
      // First full load. On the free tier this is rate-limited to 10 calls per
      // minute, so expect it to take a few minutes.
      await ingestCompetitions(ctx);
      for (const code of env.FOOTBALL_COMPETITIONS) {
        await ingestSeasonStructure(ctx, { code });
        await ingestStandings(ctx, { code });
      }
      return { ok: true };
    }

    default:
      logger.error(
        'Unknown command. Try: competitions | season-structure <CODE> | standings <CODE> | upcoming | live | bootstrap | lock | ties [CODE] | tick | recompute-deadlines | postponements | settle | notify | score <leagueRoundId> | standings-rebuild <leagueId>',
      );
      process.exit(2);
  }
}

main()
  .then((result) => {
    logger.info({ result }, 'done');
  })
  .catch((err: unknown) => {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
