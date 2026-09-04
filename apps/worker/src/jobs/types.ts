import type { Job } from 'bullmq';
import type { ProviderCapabilities, WorkerEnv } from '@wp/shared/env';
import type { Logger } from '../logger.js';
import type { FootballProvider } from '../providers/types.js';

/**
 * Job logic is deliberately decoupled from BullMQ: every job is a plain async
 * function taking this context. The queue wraps them, and the CLI (src/cli.ts)
 * calls them directly — which is what lets ingestion be exercised without a
 * Redis instance.
 */
export type JobContext = {
  log: Logger;
  env: WorkerEnv;
  capabilities: ProviderCapabilities;
  provider: FootballProvider;
  job?: Job;
};
