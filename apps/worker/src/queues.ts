import { Queue, type QueueOptions } from 'bullmq';
import IORedis from 'ioredis';

/**
 * Queue topology from architecture.md §16.1.
 *
 * Unlike the API, the worker genuinely requires Redis — BullMQ is the
 * transport, not a cache — so a missing REDIS_URL is fatal here.
 */
export const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  // BullMQ requires this to be null: blocking commands must not time out.
  maxRetriesPerRequest: null,
});

export const QUEUE_NAMES = {
  ingest: 'ingest',
  scoring: 'scoring',
  standings: 'standings',
  notifications: 'notifications',
  maintenance: 'maintenance',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Concurrency and retry policy per queue (§16.1). */
export const QUEUE_CONFIG: Record<
  QueueName,
  { concurrency: number; attempts: number; backoffMs: number }
> = {
  // Rate-limited to the provider's plan — 10 calls/min on the current free
  // tier (§11.2). Concurrency above 2 just produces 429s.
  ingest: { concurrency: 2, attempts: 5, backoffMs: 5_000 },
  // Idempotent by input hash (§9.1), so retries are free.
  scoring: { concurrency: 4, attempts: 3, backoffMs: 2_000 },
  // Serialised per league via a Redis lock inside the processor.
  standings: { concurrency: 2, attempts: 3, backoffMs: 2_000 },
  notifications: { concurrency: 8, attempts: 3, backoffMs: 1_000 },
  maintenance: { concurrency: 1, attempts: 1, backoffMs: 0 },
};

const defaults = (name: QueueName): QueueOptions => ({
  connection,
  defaultJobOptions: {
    attempts: QUEUE_CONFIG[name].attempts,
    backoff: { type: 'exponential', delay: QUEUE_CONFIG[name].backoffMs || 1000 },
    removeOnComplete: { age: 24 * 3600, count: 1000 },
    // Keep failures for a week — a dead job is evidence, and the ingest ones
    // are how we find out a provider changed something.
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});

export const queues = {
  ingest: new Queue(QUEUE_NAMES.ingest, defaults('ingest')),
  scoring: new Queue(QUEUE_NAMES.scoring, defaults('scoring')),
  standings: new Queue(QUEUE_NAMES.standings, defaults('standings')),
  notifications: new Queue(QUEUE_NAMES.notifications, defaults('notifications')),
  maintenance: new Queue(QUEUE_NAMES.maintenance, defaults('maintenance')),
} satisfies Record<QueueName, Queue>;

export async function closeQueues(): Promise<void> {
  await Promise.allSettled(Object.values(queues).map((q) => q.close()));
  await connection.quit().catch(() => undefined);
}
