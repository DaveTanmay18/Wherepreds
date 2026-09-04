import { Worker } from 'bullmq';
import { prisma } from '@wp/db';
import { capabilitiesFromEnv, parseEnv, workerEnvSchema } from '@wp/shared/env';
import { logger } from './logger.js';
import { closeQueues, connection, QUEUE_CONFIG, QUEUE_NAMES, type QueueName } from './queues.js';
import { processors } from './jobs/index.js';

const env = parseEnv(workerEnvSchema);
const capabilities = capabilitiesFromEnv(env);

logger.info(
  {
    competitions: env.FOOTBALL_COMPETITIONS,
    rateLimitPerMin: env.FOOTBALL_RATE_LIMIT_PER_MIN,
    capabilities,
  },
  'worker starting',
);

// Surfaced loudly at boot: a plan that cannot supply goal events silently
// disables four markets (§11.5). Better to say so once a day in the logs than
// to have someone wonder why nobody scored a goalscorer point all season.
if (!capabilities.goalEvents) {
  logger.warn(
    'Deep Data is OFF — goals[]/bookings[] unavailable. FIRST_GOALSCORER, ANYTIME_GOALSCORER and RED_CARD_SHOWN are gated off, and PlayerMatchStat cannot be derived. See docs/architecture.md §11.5 (task D-01c).',
  );
}

const workers = (Object.keys(QUEUE_NAMES) as QueueName[]).map((name) => {
  const worker = new Worker(
    QUEUE_NAMES[name],
    async (job) => {
      const processor = processors[job.name];
      if (!processor) {
        // Fail loudly. A silently dropped job is worse than a failed one:
        // nothing retries and nothing alerts.
        throw new Error(`No processor registered for job "${job.name}" on queue "${name}"`);
      }
      const log = logger.child({ queue: name, job: job.name, jobId: job.id });
      return processor({ job, log, env, capabilities });
    },
    { connection, concurrency: QUEUE_CONFIG[name].concurrency },
  );

  worker.on('failed', (job, err) => {
    logger.error({ queue: name, job: job?.name, jobId: job?.id, err: err.message }, 'job failed');
  });
  worker.on('completed', (job) => {
    logger.debug({ queue: name, job: job.name, jobId: job.id }, 'job completed');
  });

  return worker;
});

logger.info({ queues: Object.keys(QUEUE_NAMES) }, 'workers ready');

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'draining in-flight jobs');

  const force = setTimeout(() => {
    logger.error('drain timed out — forcing exit');
    process.exit(1);
  }, 30_000);
  force.unref();

  await Promise.allSettled(workers.map((w) => w.close()));
  await closeQueues();
  await prisma.$disconnect();
  logger.info('worker stopped');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
