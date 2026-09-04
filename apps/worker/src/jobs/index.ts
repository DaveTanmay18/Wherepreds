import type { Job } from 'bullmq';
import type { ProviderCapabilities, WorkerEnv } from '@wp/shared/env';
import type { Logger } from '../logger.js';
import { createProvider } from '../providers/index.js';
import { ingestCompetitions, ingestSeasonStructure } from './season-structure.js';
import { ingestLive, ingestUpcoming } from './live.js';
import { ingestStandings } from './standings.js';
import { lockDueRounds } from './lock-rounds.js';
import { scoreLeagueRound } from './scoring.js';
import { rebuildStandings } from './standings.service.js';
import { handlePostponements, recomputeDeadlines, settleRounds } from './round-lifecycle.js';
import { buildTies, resolveTies } from './ties.js';
import { notifyDeadlines, notifyRoundScored } from './notifications.js';
import type { JobContext } from './types.js';

export type { JobContext } from './types.js';

export type ProcessorArgs = {
  job: Job;
  log: Logger;
  env: WorkerEnv;
  capabilities: ProviderCapabilities;
};

export type Processor = (args: ProcessorArgs) => Promise<unknown>;

const withProvider =
  (fn: (ctx: JobContext, data: Record<string, never>) => Promise<unknown>): Processor =>
  async ({ job, log, env, capabilities }) => {
    const ctx: JobContext = { log, env, capabilities, provider: createProvider(env, log), job };
    return fn(ctx, job.data ?? {});
  };

/**
 * Job registry. Names follow `domain.action` (Appendix A). An unregistered
 * name throws rather than being silently dropped — a typo should surface as a
 * failed job with an alert, not as a round that quietly never scores.
 */
export const processors: Record<string, Processor> = {
  'maintenance.ping': async ({ log }) => {
    log.info('maintenance.ping — worker wiring is alive');
    return { ok: true, at: new Date().toISOString() };
  },

  'ingest.competitions': withProvider((ctx) => ingestCompetitions(ctx)),
  'ingest.season-structure': withProvider((ctx, data) =>
    ingestSeasonStructure(ctx, data as unknown as { code: string; season?: number }),
  ),
  'ingest.fixtures-upcoming': withProvider((ctx) => ingestUpcoming(ctx)),
  'ingest.live': withProvider((ctx) => ingestLive(ctx)),
  'ingest.standings': withProvider((ctx, data) =>
    ingestStandings(ctx, data as unknown as { code: string; season?: number }),
  ),

  // ── Prediction pipeline (Phase 3) ──────────────────────────────────
  'rounds.lock': async ({ log }) => lockDueRounds(log),
  'score.round': async ({ job, log }) => {
    const { leagueRoundId, trigger } = job.data as { leagueRoundId: string; trigger?: string };
    return scoreLeagueRound(leagueRoundId, trigger ?? 'manual', log);
  },
  'rounds.recompute-deadlines': async ({ log }) => recomputeDeadlines(log),
  'rounds.postponements': async ({ log }) => handlePostponements(log),
  'rounds.settle': async ({ log }) => settleRounds(log),
  'notify.deadline': async ({ log }) => notifyDeadlines(log),
  'notify.round-scored': async ({ job, log }) =>
    notifyRoundScored((job.data as { leagueRoundId: string }).leagueRoundId, log),
  'ties.build': async ({ job, log }) => buildTies((job.data as { seasonId: string }).seasonId, log),
  'ties.resolve': async ({ job, log }) =>
    resolveTies((job.data as { seasonId?: string }).seasonId ?? null, log),
  'standings.rebuild': async ({ job, log }) => {
    const { leagueId, fromSequence } = job.data as { leagueId: string; fromSequence?: number };
    return rebuildStandings(leagueId, fromSequence ?? 1, log);
  },
};
