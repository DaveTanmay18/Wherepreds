import { ExternalEntity, prisma, RoundType, type Prisma } from '@wp/db';
import type { JobContext } from './types.js';
import { runIngest, type IngestResult } from './ingest-run.js';
import { link, resolveInternalId, resolveMany } from '../providers/external-ref.js';
import { isTwoLegged, mapStage, STAGE_ORDER } from '../providers/football-data/enums.js';
import { mapMatchCore, mapTeam, slugify } from '../providers/football-data/mappers.js';
import type { RawMatch } from '../providers/types.js';

/**
 * ingest.competitions (P1-07) — refreshes the six supported competitions and
 * their current season. Weekly; these barely change.
 */
export async function ingestCompetitions(ctx: JobContext): Promise<IngestResult> {
  return runIngest('ingest.competitions', null, ctx.log, async ({ log }) => {
    let read = 0;
    let written = 0;

    for (const code of ctx.env.FOOTBALL_COMPETITIONS) {
      const raw = await ctx.provider.getCompetition(code);
      read++;

      const competitionId = await resolveInternalId(ExternalEntity.COMPETITION, raw.id);
      if (!competitionId) {
        // The seed creates all six; a missing one means the code list and the
        // seed have drifted apart, which is a bug rather than a data gap.
        log.error({ code, externalId: raw.id }, 'competition not seeded — skipping');
        continue;
      }

      await prisma.competition.update({
        where: { id: competitionId },
        data: { name: raw.name, logoUrl: raw.emblem ?? null },
      });

      if (raw.currentSeason) {
        const startYear = Number(raw.currentSeason.startDate.slice(0, 4));
        const season = await upsertSeason(competitionId, raw.currentSeason, startYear);
        await link(ExternalEntity.SEASON, raw.currentSeason.id, season.id);
        written++;
      }
      written++;
    }

    return { read, written };
  });
}

async function upsertSeason(
  competitionId: string,
  raw: { id: number; startDate: string; endDate: string; currentMatchday: number | null },
  startYear: number,
) {
  const label = `${startYear}/${String(startYear + 1).slice(2)}`;

  // Only one season per competition may be current (partial unique index), so
  // clear the old one before promoting this one.
  await prisma.season.updateMany({
    where: { competitionId, isCurrent: true, startYear: { not: startYear } },
    data: { isCurrent: false },
  });

  return prisma.season.upsert({
    where: { competitionId_startYear: { competitionId, startYear } },
    update: {
      startDate: new Date(raw.startDate),
      endDate: new Date(raw.endDate),
      isCurrent: true,
    },
    create: {
      competitionId,
      label,
      startYear,
      startDate: new Date(raw.startDate),
      endDate: new Date(raw.endDate),
      isCurrent: true,
    },
  });
}

/**
 * ingest.season-structure (P1-08) — teams, TeamSeason, rounds and the full
 * fixture list for one competition season. Daily at 03:00 UTC.
 */
export async function ingestSeasonStructure(
  ctx: JobContext,
  args: { code: string; season?: number },
): Promise<IngestResult> {
  return runIngest(
    'ingest.season-structure',
    `competition:${args.code}`,
    ctx.log,
    async ({ log }) => {
      let read = 0;
      let written = 0;

      const competition = await ctx.provider.getCompetition(args.code);
      read++;

      const competitionId = await resolveInternalId(ExternalEntity.COMPETITION, competition.id);
      if (!competitionId) throw new Error(`Competition ${args.code} is not seeded`);

      const startYear =
        args.season ??
        Number(competition.currentSeason?.startDate.slice(0, 4) ?? new Date().getFullYear());

      const seasonRow = competition.currentSeason
        ? await upsertSeason(competitionId, competition.currentSeason, startYear)
        : await prisma.season.findUniqueOrThrow({
            where: { competitionId_startYear: { competitionId, startYear } },
          });

      if (competition.currentSeason) {
        await link(ExternalEntity.SEASON, competition.currentSeason.id, seasonRow.id);
      }

      // ── Teams ────────────────────────────────────────────────────────────
      const teams = await ctx.provider.listTeams(args.code, startYear);
      read += teams.length;

      for (const raw of teams) {
        const existingId = await resolveInternalId(ExternalEntity.TEAM, raw.id);
        const data = mapTeam(raw);

        const team = existingId
          ? await prisma.team.update({ where: { id: existingId }, data })
          : await prisma.team.create({
              // Slug collisions are real (two "Athletic" clubs), so fall back to
              // the provider id, which is unique by construction.
              data: { ...data, slug: `${slugify(raw.name)}-${raw.id}` },
            });

        if (!existingId) await link(ExternalEntity.TEAM, raw.id, team.id);

        await prisma.teamSeason.upsert({
          where: { teamId_seasonId: { teamId: team.id, seasonId: seasonRow.id } },
          update: {},
          create: { teamId: team.id, seasonId: seasonRow.id },
        });
        written++;
      }

      // ── Fixtures (one call for the whole season) ─────────────────────────
      const matches = await ctx.provider.listMatches({
        competitions: [args.code],
        season: startYear,
      });
      read += matches.length;
      log.info({ matches: matches.length, teams: teams.length }, 'season structure fetched');

      written += await upsertMatches(matches, seasonRow.id, log);

      return { read, written };
    },
  );
}

/**
 * Shared fixture upsert. Every write is idempotent (§11.3), so replaying any
 * window is safe by construction — which is what lets us recover from a bad
 * provider response by simply running the job again.
 */
export async function upsertMatches(
  matches: RawMatch[],
  seasonId: string,
  log: { warn: (o: object, m: string) => void; info?: (o: object, m: string) => void },
): Promise<number> {
  if (matches.length === 0) return 0;

  const teamIds = await resolveMany(
    ExternalEntity.TEAM,
    matches.flatMap((m) => [m.homeTeam.id, m.awayTeam.id]),
  );
  const fixtureIds = await resolveMany(
    ExternalEntity.FIXTURE,
    matches.map((m) => m.id),
  );

  // ── Rounds: upsert each DISTINCT round once ──────────────────────────
  // Doing this per fixture cost one round-trip per match. Against a remote
  // Neon instance that alone was ~380 sequential queries for one league
  // season, which is what made the first run time out.
  const roundCache = new Map<string, string>();
  for (const raw of matches) {
    const type = mapStage(raw.stage);
    const key = roundKey(type, raw.matchday, raw.group ?? null);
    if (roundCache.has(key)) continue;
    const round = await upsertRound(seasonId, type, raw.matchday, raw.group ?? null);
    roundCache.set(key, round.id);
  }

  // ── Partition into creates and updates ───────────────────────────────
  const toCreate: { raw: RawMatch; data: Prisma.FixtureUncheckedCreateInput }[] = [];
  const toUpdate: { id: string; data: Prisma.FixtureUncheckedCreateInput }[] = [];

  for (const raw of matches) {
    const homeTeamId = teamIds.get(String(raw.homeTeam.id));
    const awayTeamId = teamIds.get(String(raw.awayTeam.id));
    if (!homeTeamId || !awayTeamId) {
      log.warn(
        { match: raw.id },
        'skipping fixture with unknown team — run season-structure first',
      );
      continue;
    }

    const type = mapStage(raw.stage);
    const roundId = roundCache.get(roundKey(type, raw.matchday, raw.group ?? null));

    const data: Prisma.FixtureUncheckedCreateInput = {
      seasonId,
      roundId,
      homeTeamId,
      awayTeamId,
      ...mapMatchCore(raw),
    };

    const existingId = fixtureIds.get(String(raw.id));
    if (existingId) toUpdate.push({ id: existingId, data });
    else toCreate.push({ raw, data });
  }

  // ── Creates: one statement, then one for the id mappings ─────────────
  if (toCreate.length) {
    const created = await prisma.fixture.createManyAndReturn({
      data: toCreate.map((t) => t.data),
      select: { id: true },
    });

    if (created.length !== toCreate.length) {
      throw new Error(
        `createManyAndReturn returned ${created.length} rows for ${toCreate.length} inputs — cannot map provider ids safely`,
      );
    }

    await prisma.externalRef.createMany({
      data: created.map((row, i) => ({
        provider: 'football-data-org',
        entity: ExternalEntity.FIXTURE,
        externalId: String(toCreate[i]!.raw.id),
        internalId: row.id,
      })),
      skipDuplicates: true,
    });
  }

  // ── Updates: chunked so each chunk is a single round-trip ────────────
  const CHUNK = 50;
  for (let i = 0; i < toUpdate.length; i += CHUNK) {
    const chunk = toUpdate.slice(i, i + CHUNK);
    await prisma.$transaction(
      chunk.map((u) => prisma.fixture.update({ where: { id: u.id }, data: u.data })),
    );
  }

  log.info?.(
    { created: toCreate.length, updated: toUpdate.length, rounds: roundCache.size },
    'fixtures written',
  );

  return toCreate.length + toUpdate.length;
}

const roundKey = (type: RoundType, matchday: number | null, group: string | null) =>
  `${type}:${matchday ?? 0}:${group ?? ''}`;

/**
 * Rounds are matchdays in a league and stages in a cup (§5.2). `number` is the
 * matchday for league rounds and a large stage-ordinal for knockouts, so the
 * two sort correctly in one list without special-casing every query.
 */
export async function upsertRound(
  seasonId: string,
  type: RoundType,
  matchday: number | null,
  groupName: string | null,
) {
  const isLeaguePhase =
    type === RoundType.REGULAR_SEASON ||
    type === RoundType.GROUP_STAGE ||
    type === RoundType.LEAGUE_PHASE;

  const number = isLeaguePhase ? (matchday ?? 1) : STAGE_ORDER[type];
  const name = isLeaguePhase ? `Matchday ${number}` : STAGE_LABEL[type];

  return prisma.round.upsert({
    where: { seasonId_number: { seasonId, number } },
    update: { type, groupName, isTwoLegged: isTwoLegged(type) },
    create: { seasonId, number, name, type, groupName, isTwoLegged: isTwoLegged(type) },
  });
}

const STAGE_LABEL: Record<RoundType, string> = {
  [RoundType.REGULAR_SEASON]: 'Regular season',
  [RoundType.GROUP_STAGE]: 'Group stage',
  [RoundType.LEAGUE_PHASE]: 'League phase',
  [RoundType.KNOCKOUT_PLAYOFF]: 'Knockout play-off',
  [RoundType.ROUND_OF_16]: 'Round of 16',
  [RoundType.QUARTER_FINAL]: 'Quarter-final',
  [RoundType.SEMI_FINAL]: 'Semi-final',
  [RoundType.FINAL]: 'Final',
};
