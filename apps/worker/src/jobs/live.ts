import { ExternalEntity, FixtureStatus, prisma } from '@wp/db';
import type { JobContext } from './types.js';
import { runIngest, type IngestResult } from './ingest-run.js';
import { resolveMany } from '../providers/external-ref.js';
import { isTerminal } from '../providers/football-data/enums.js';
import { mapMatchCore } from '../providers/football-data/mappers.js';

/** Statuses that mean a match is currently being played. */
const LIVE_STATUSES: FixtureStatus[] = [
  FixtureStatus.LIVE,
  FixtureStatus.HALF_TIME,
  FixtureStatus.SECOND_HALF,
  FixtureStatus.EXTRA_TIME,
  FixtureStatus.PENALTY_SHOOTOUT,
];

/** Cheap guard so the poller costs nothing outside match windows (§11.2). */
export async function anyFixtureLive(): Promise<boolean> {
  const soon = new Date(Date.now() + 15 * 60_000);
  const recent = new Date(Date.now() - 3 * 60 * 60_000);

  const count = await prisma.fixture.count({
    where: {
      OR: [
        { status: { in: LIVE_STATUSES } },
        // Also poll around kickoff, or nothing would ever transition INTO a
        // live status and the guard would keep itself switched off forever.
        { status: FixtureStatus.SCHEDULED, kickoffAt: { lte: soon, gte: recent } },
      ],
    },
  });
  return count > 0;
}

/**
 * ingest.live (P1-11) — ONE batched call covering every competition.
 *
 * Ten simultaneous matches cost one request per minute, not ten. Polling per
 * fixture would exhaust a 10 calls/min plan on a single Saturday afternoon
 * (§11.2), which is exactly when the app matters most.
 */
export async function ingestLive(ctx: JobContext): Promise<IngestResult> {
  return runIngest('ingest.live', null, ctx.log, async ({ log }) => {
    if (!(await anyFixtureLive())) {
      return { read: 0, written: 0, note: 'no live fixtures — skipped' };
    }

    const today = new Date();
    const matches = await ctx.provider.listMatches({
      competitions: ctx.env.FOOTBALL_COMPETITIONS,
      dateFrom: new Date(today.getTime() - 24 * 3600_000),
      dateTo: new Date(today.getTime() + 24 * 3600_000),
    });

    log.info({ matches: matches.length }, 'live poll (1 API call)');

    const written = await applyMatchUpdates(matches, log);
    return { read: matches.length, written };
  });
}

/**
 * Applies live/finished updates with the result confirmation guard (P1-12).
 *
 * A fixture only reaches FINISHED after TWO consecutive terminal polls.
 * Providers occasionally emit a premature full-time, and scoring a round on a
 * wrong result then rescoring it minutes later damages trust far more than a
 * 60-second delay does (§11.4).
 */
export async function applyMatchUpdates(
  matches: { id: number; status: string; score: Parameters<typeof mapMatchCore>[0]['score'] }[],
  log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void },
): Promise<number> {
  const ids = await resolveMany(
    ExternalEntity.FIXTURE,
    matches.map((m) => m.id),
  );
  if (ids.size === 0) return 0;

  const existing = await prisma.fixture.findMany({
    where: { id: { in: [...ids.values()] } },
    select: {
      id: true,
      status: true,
      homeGoals: true,
      awayGoals: true,
      resultVersion: true,
      terminalSeenAt: true,
      resultConfirmedAt: true,
    },
  });
  const byId = new Map(existing.map((f) => [f.id, f]));

  let written = 0;

  for (const raw of matches) {
    const internalId = ids.get(String(raw.id));
    if (!internalId) continue;
    const current = byId.get(internalId);
    if (!current) continue;

    const core = mapMatchCore(raw as never);
    const terminal = isTerminal(raw.status);

    if (!terminal) {
      await prisma.fixture.update({
        where: { id: internalId },
        data: { ...core, terminalSeenAt: null },
      });
      written++;
      continue;
    }

    // ── Terminal: apply the two-poll guard ──────────────────────────────
    if (!current.terminalSeenAt && current.status !== FixtureStatus.FINISHED) {
      // First sighting. Record the score but hold the status back, so nothing
      // downstream treats this as a result yet.
      await prisma.fixture.update({
        where: { id: internalId },
        data: { ...core, status: current.status, terminalSeenAt: new Date() },
      });
      log.info({ fixture: internalId }, 'terminal seen once — awaiting confirmation');
      written++;
      continue;
    }

    // Second sighting (or already finished): confirm it.
    const scoreChanged =
      current.status === FixtureStatus.FINISHED &&
      (current.homeGoals !== core.homeGoals || current.awayGoals !== core.awayGoals);

    if (scoreChanged) {
      // A corrected result. Bumping resultVersion is what makes the scoring
      // idempotency hash change and triggers a rescore (§9.2).
      log.warn(
        {
          fixture: internalId,
          from: `${current.homeGoals}-${current.awayGoals}`,
          to: `${core.homeGoals}-${core.awayGoals}`,
        },
        'RESULT CORRECTED — rescore required',
      );
    }

    await prisma.fixture.update({
      where: { id: internalId },
      data: {
        ...core,
        status: FixtureStatus.FINISHED,
        resultConfirmedAt: current.resultConfirmedAt ?? new Date(),
        ...(scoreChanged || current.status !== FixtureStatus.FINISHED
          ? { resultVersion: { increment: 1 } }
          : {}),
      },
    });
    written++;
  }

  return written;
}

/**
 * ingest.fixtures-upcoming (P1-10) — hourly, ONE batched call across all six
 * competitions for the next 14 days. Catches kickoff changes so UPCOMING
 * deadlines can be recomputed (§10.1).
 */
export async function ingestUpcoming(ctx: JobContext): Promise<IngestResult> {
  return runIngest('ingest.fixtures-upcoming', null, ctx.log, async ({ log }) => {
    const now = new Date();
    const matches = await ctx.provider.listMatches({
      competitions: ctx.env.FOOTBALL_COMPETITIONS,
      dateFrom: now,
      dateTo: new Date(now.getTime() + 14 * 24 * 3600_000),
    });

    const ids = await resolveMany(
      ExternalEntity.FIXTURE,
      matches.map((m) => m.id),
    );

    let written = 0;
    let moved = 0;

    for (const raw of matches) {
      const internalId = ids.get(String(raw.id));
      if (!internalId) continue;

      const core = mapMatchCore(raw);
      const before = await prisma.fixture.findUnique({
        where: { id: internalId },
        select: { kickoffAt: true },
      });

      if (before && before.kickoffAt.getTime() !== core.kickoffAt.getTime()) {
        moved++;
        // Phase 3 (P3-03) subscribes to this to recompute league deadlines.
        log.info(
          { fixture: internalId, from: before.kickoffAt, to: core.kickoffAt },
          'kickoff moved — deadlines need recomputing',
        );
      }

      await prisma.fixture.update({ where: { id: internalId }, data: core });
      written++;
    }

    return { read: matches.length, written, note: moved ? `${moved} kickoff(s) moved` : undefined };
  });
}
