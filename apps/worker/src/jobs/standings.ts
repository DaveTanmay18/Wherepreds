import { ExternalEntity, prisma, RoundType } from '@wp/db';
import type { JobContext } from './types.js';
import { runIngest, type IngestResult } from './ingest-run.js';
import { resolveInternalId, resolveMany } from '../providers/external-ref.js';

/**
 * ingest.standings (P1-14) — snapshots the league table after each round.
 *
 * Knockout rounds are skipped: there is no table to snapshot (§11.2). The UCL
 * league phase DOES have one — a single 36-team table — which the existing
 * StandingRow model handles unchanged (§5.2).
 */
export async function ingestStandings(
  ctx: JobContext,
  args: { code: string; season?: number },
): Promise<IngestResult> {
  return runIngest('ingest.standings', `competition:${args.code}`, ctx.log, async ({ log }) => {
    const competition = await prisma.competition.findFirst({
      where: {
        id: (await resolveCompetitionId(args.code)) ?? '__none__',
      },
      include: { seasons: { where: { isCurrent: true }, take: 1 } },
    });

    const season = competition?.seasons[0];
    if (!season) {
      return { read: 0, written: 0, note: `no current season for ${args.code}` };
    }

    const groups = await ctx.provider.getStandings(args.code, args.season ?? season.startYear);

    // TOTAL is the real table; HOME/AWAY splits are extra views we do not model.
    const tables = groups.filter((g) => g.type === 'TOTAL');
    const rows = tables.flatMap((g) => g.table.map((entry) => ({ entry, group: g.group ?? null })));

    if (rows.length === 0) {
      return { read: 0, written: 0, note: 'no TOTAL standings returned (knockout stage?)' };
    }

    const teamIds = await resolveMany(
      ExternalEntity.TEAM,
      rows.map((r) => r.entry.team.id),
    );

    // The current league round, so the snapshot is attributable to a matchday.
    const round = await prisma.round.findFirst({
      where: {
        seasonId: season.id,
        type: { in: [RoundType.REGULAR_SEASON, RoundType.GROUP_STAGE, RoundType.LEAGUE_PHASE] },
      },
      orderBy: { number: 'desc' },
    });

    // Demote the previous snapshot before promoting this one — the partial
    // unique index allows exactly one isLatest row per team per season.
    await prisma.standingRow.updateMany({
      where: { seasonId: season.id, isLatest: true },
      data: { isLatest: false },
    });

    let written = 0;
    for (const { entry, group } of rows) {
      const teamId = teamIds.get(String(entry.team.id));
      if (!teamId) {
        log.warn({ team: entry.team.id }, 'standings row for unknown team — skipped');
        continue;
      }

      const data = {
        position: entry.position,
        played: entry.playedGames,
        won: entry.won,
        drawn: entry.draw,
        lost: entry.lost,
        goalsFor: entry.goalsFor,
        goalsAgainst: entry.goalsAgainst,
        goalDifference: entry.goalDifference,
        points: entry.points,
        form: entry.form
          ? entry.form
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
        groupName: group,
        isLatest: true,
        computedAt: new Date(),
      };

      // Postgres treats NULLs as distinct, so the (seasonId, roundId, teamId)
      // unique index does not constrain rows with a null roundId — and Prisma
      // will not accept null in a compound unique lookup either. Find-then-write
      // keeps the job idempotent in both cases (§11.3).
      const existing = await prisma.standingRow.findFirst({
        where: { seasonId: season.id, roundId: round?.id ?? null, teamId },
        select: { id: true },
      });

      if (existing) {
        await prisma.standingRow.update({ where: { id: existing.id }, data });
      } else {
        await prisma.standingRow.create({
          data: { seasonId: season.id, roundId: round?.id ?? null, teamId, ...data },
        });
      }
      written++;
    }

    return { read: rows.length, written };
  });
}

async function resolveCompetitionId(code: string): Promise<string | null> {
  const byCode: Record<string, number> = {
    PL: 2021,
    PD: 2014,
    SA: 2019,
    BL1: 2002,
    FL1: 2015,
    CL: 2001,
  };
  const externalId = byCode[code];
  if (!externalId) return null;
  return resolveInternalId(ExternalEntity.COMPETITION, externalId);
}
