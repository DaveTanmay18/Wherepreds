/**
 * Seed — reference data only.
 *
 * Creates the countries and the six supported competitions with their current
 * season. Real football data (teams, players, fixtures) arrives through the
 * ingestion worker in Phase 1, never through this file: the ingest path must
 * be the only writer of the football context (§2.1), and a seed that fabricates
 * fixtures would let us build screens against data no provider can reproduce.
 *
 * Idempotent — safe to re-run. Task P0-14.
 */
import { PrismaClient, CompetitionType } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Competition codes and ids verified live against football-data.org v4 on
 * 2026-08-18. All six are on the Free 12-competition tier (§11.5).
 * `externalId` is the provider's numeric id, recorded through ExternalRef so
 * no provider identifier ever becomes a primary key (§11.1).
 */
const COMPETITIONS = [
  {
    code: 'PL',
    externalId: '2021',
    slug: 'premier-league',
    name: 'Premier League',
    shortName: 'PL',
    country: 'England',
    type: CompetitionType.LEAGUE,
  },
  {
    code: 'PD',
    externalId: '2014',
    slug: 'la-liga',
    name: 'Primera Division',
    shortName: 'La Liga',
    country: 'Spain',
    type: CompetitionType.LEAGUE,
  },
  {
    code: 'SA',
    externalId: '2019',
    slug: 'serie-a',
    name: 'Serie A',
    shortName: 'Serie A',
    country: 'Italy',
    type: CompetitionType.LEAGUE,
  },
  {
    code: 'BL1',
    externalId: '2002',
    slug: 'bundesliga',
    name: 'Bundesliga',
    shortName: 'BL',
    country: 'Germany',
    type: CompetitionType.LEAGUE,
  },
  {
    code: 'FL1',
    externalId: '2015',
    slug: 'ligue-1',
    name: 'Ligue 1',
    shortName: 'L1',
    country: 'France',
    type: CompetitionType.LEAGUE,
  },
  {
    code: 'CL',
    externalId: '2001',
    slug: 'champions-league',
    name: 'UEFA Champions League',
    shortName: 'UCL',
    country: null,
    type: CompetitionType.CONTINENTAL,
  },
] as const;

const COUNTRIES = [
  { name: 'England', isoCode: 'ENG' },
  { name: 'Spain', isoCode: 'ESP' },
  { name: 'Italy', isoCode: 'ITA' },
  { name: 'Germany', isoCode: 'DEU' },
  { name: 'France', isoCode: 'FRA' },
] as const;

/** Season the app opens on. Starting year, matching the provider's convention. */
const CURRENT_SEASON_START_YEAR = 2025;

async function main() {
  console.warn('Seeding reference data…');

  const countryIds = new Map<string, string>();
  for (const c of COUNTRIES) {
    const row = await prisma.country.upsert({
      where: { name: c.name },
      update: { isoCode: c.isoCode },
      create: { name: c.name, isoCode: c.isoCode },
    });
    countryIds.set(c.name, row.id);
  }
  console.warn(`  countries: ${countryIds.size}`);

  for (const c of COMPETITIONS) {
    const competition = await prisma.competition.upsert({
      where: { slug: c.slug },
      update: {
        name: c.name,
        shortName: c.shortName,
        type: c.type,
        countryId: c.country ? countryIds.get(c.country) : null,
        confederation: c.country ? null : 'UEFA',
        isSupported: true,
      },
      create: {
        slug: c.slug,
        name: c.name,
        shortName: c.shortName,
        type: c.type,
        tier: 1,
        countryId: c.country ? countryIds.get(c.country) : null,
        confederation: c.country ? null : 'UEFA',
        isSupported: true,
      },
    });

    // Provider id lives here and nowhere else (§11.1).
    await prisma.externalRef.upsert({
      where: {
        provider_entity_externalId: {
          provider: 'football-data-org',
          entity: 'COMPETITION',
          externalId: c.externalId,
        },
      },
      update: { internalId: competition.id },
      create: {
        provider: 'football-data-org',
        entity: 'COMPETITION',
        externalId: c.externalId,
        internalId: competition.id,
      },
    });

    // A placeholder season so leagues can be created before the first ingest
    // run. Dates are refreshed by ingest.season-structure (P1-08).
    const label = `${CURRENT_SEASON_START_YEAR}/${String(CURRENT_SEASON_START_YEAR + 1).slice(2)}`;
    await prisma.season.upsert({
      where: {
        competitionId_startYear: {
          competitionId: competition.id,
          startYear: CURRENT_SEASON_START_YEAR,
        },
      },
      update: { isCurrent: true },
      create: {
        competitionId: competition.id,
        label,
        startYear: CURRENT_SEASON_START_YEAR,
        startDate: new Date(`${CURRENT_SEASON_START_YEAR}-08-01`),
        endDate: new Date(`${CURRENT_SEASON_START_YEAR + 1}-06-30`),
        isCurrent: true,
        totalRounds: c.type === CompetitionType.LEAGUE ? 38 : null,
      },
    });

    console.warn(`  ${c.code.padEnd(3)} ${c.name} — season ${label}`);
  }

  console.warn('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
