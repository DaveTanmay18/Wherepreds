import { IngestJobStatus, prisma } from '@wp/db';
import type { Logger } from '../logger.js';

/**
 * Wraps an ingest job in an IngestJob row (task P1-06), so every run is
 * auditable: what ran, when, how many records, and why it failed. Ingest
 * failures are how we find out a provider changed something.
 */
export type IngestResult = { read: number; written: number; note?: string };

export async function runIngest(
  jobType: string,
  scopeKey: string | null,
  log: Logger,
  fn: (ctx: { log: Logger }) => Promise<IngestResult>,
): Promise<IngestResult> {
  const row = await prisma.ingestJob.create({
    data: {
      jobType,
      provider: 'football-data-org',
      scopeKey,
      status: IngestJobStatus.RUNNING,
      startedAt: new Date(),
    },
  });

  const jobLog = log.child({ ingestJob: row.id, jobType, scopeKey });
  const started = Date.now();

  try {
    const result = await fn({ log: jobLog });
    await prisma.ingestJob.update({
      where: { id: row.id },
      data: {
        status: IngestJobStatus.SUCCEEDED,
        recordsRead: result.read,
        recordsWritten: result.written,
        finishedAt: new Date(),
      },
    });
    jobLog.info({ ...result, ms: Date.now() - started }, 'ingest complete');
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.ingestJob.update({
      where: { id: row.id },
      data: {
        status: IngestJobStatus.FAILED,
        error: message.slice(0, 1000),
        finishedAt: new Date(),
      },
    });
    jobLog.error({ err: message, ms: Date.now() - started }, 'ingest failed');
    throw err;
  }
}
