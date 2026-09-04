import { Router } from 'express';
import { z } from 'zod';
import { prisma, RoundType } from '@wp/db';
import { notFound } from '../../errors.js';
import { cursorArgs, paginate, publicCache } from '../../middleware/cache.js';
import { validate } from '../../middleware/validate.js';

/**
 * Public football endpoints (§12.1, tasks P1-17 to P1-21).
 *
 * Everything here reads our own database — never the provider. The ingestion
 * worker is the only writer of the football context (§2.1), which is what lets
 * these responses be cached hard and served fast.
 */
export const footballRouter: Router = Router();

// Scoped to the paths this router actually serves: unscoped, a mistyped URL
// would 404 carrying `Cache-Control: public` (see notifications.ts).
footballRouter.use(
  ['/competitions', '/seasons', '/rounds', '/fixtures', '/teams', '/players'],
  publicCache(60, 300),
);

const teamSelect = {
  id: true,
  slug: true,
  name: true,
  shortName: true,
  tla: true,
  crestUrl: true,
} as const;

// ── Competitions ──────────────────────────────────────────────────────────

footballRouter.get('/competitions', async (_req, res) => {
  const competitions = await prisma.competition.findMany({
    where: { isSupported: true },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
    include: {
      country: { select: { name: true, isoCode: true, flagUrl: true } },
      seasons: {
        where: { isCurrent: true },
        select: { id: true, label: true, startYear: true },
        take: 1,
      },
    },
  });

  res.json({
    competitions: competitions.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      shortName: c.shortName,
      type: c.type,
      logoUrl: c.logoUrl,
      // Null for the UCL — every flag surface needs this fallback (§5.2).
      country: c.country,
      confederation: c.confederation,
      currentSeason: c.seasons[0] ?? null,
    })),
  });
});

footballRouter.get(
  '/competitions/:slug',
  validate({ params: z.object({ slug: z.string() }) }),
  async (req, res) => {
    const competition = await prisma.competition.findUnique({
      where: { slug: req.params.slug as string },
      include: {
        country: { select: { name: true, isoCode: true, flagUrl: true } },
        seasons: { orderBy: { startYear: 'desc' } },
      },
    });
    if (!competition) throw notFound('No such competition.');
    res.json({ competition });
  },
);

// ── Seasons ───────────────────────────────────────────────────────────────

footballRouter.get(
  '/seasons/:id/rounds',
  validate({ params: z.object({ id: z.string() }) }),
  async (req, res) => {
    const rounds = await prisma.round.findMany({
      where: { seasonId: req.params.id as string },
      orderBy: { number: 'asc' },
      include: { _count: { select: { fixtures: true } } },
    });

    res.json({
      rounds: rounds.map((r) => ({
        id: r.id,
        number: r.number,
        name: r.name,
        // Anything sorting or labelling rounds must read `type`: number is a
        // matchday in a league and a stage ordinal in a cup (§5.2).
        type: r.type,
        groupName: r.groupName,
        isTwoLegged: r.isTwoLegged,
        isScheduleFinal: r.isScheduleFinal,
        fixtureCount: r._count.fixtures,
      })),
    });
  },
);

footballRouter.get(
  '/seasons/:id/standings',
  validate({ params: z.object({ id: z.string() }) }),
  async (req, res) => {
    const rows = await prisma.standingRow.findMany({
      where: { seasonId: req.params.id as string, isLatest: true },
      orderBy: [{ groupName: 'asc' }, { position: 'asc' }],
      include: { team: { select: teamSelect } },
    });
    res.json({ standings: rows });
  },
);

footballRouter.get(
  '/seasons/:id/teams',
  validate({ params: z.object({ id: z.string() }) }),
  async (req, res) => {
    const teamSeasons = await prisma.teamSeason.findMany({
      where: { seasonId: req.params.id as string },
      include: { team: { select: teamSelect }, stat: true },
      orderBy: { team: { name: 'asc' } },
    });
    res.json({ teams: teamSeasons.map((ts) => ({ ...ts.team, seasonStats: ts.stat })) });
  },
);

// ── Rounds and fixtures ───────────────────────────────────────────────────

footballRouter.get(
  '/rounds/:id/fixtures',
  validate({ params: z.object({ id: z.string() }) }),
  async (req, res) => {
    const fixtures = await prisma.fixture.findMany({
      where: { roundId: req.params.id as string },
      orderBy: { kickoffAt: 'asc' },
      include: {
        homeTeam: { select: teamSelect },
        awayTeam: { select: teamSelect },
        tie: { select: { id: true, aggregateA: true, aggregateB: true, winnerTeamId: true } },
      },
    });
    res.json({ fixtures: fixtures.map(toFixtureDto) });
  },
);

footballRouter.get(
  '/fixtures',
  validate({
    query: z.object({
      seasonId: z.string().optional(),
      teamId: z.string().optional(),
      status: z.string().optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(25),
    }),
  }),
  async (req, res) => {
    const q = req.query as unknown as {
      seasonId?: string;
      teamId?: string;
      from?: Date;
      to?: Date;
      cursor?: string;
      limit: number;
    };

    const rows = await prisma.fixture.findMany({
      where: {
        ...(q.seasonId ? { seasonId: q.seasonId } : {}),
        ...(q.teamId ? { OR: [{ homeTeamId: q.teamId }, { awayTeamId: q.teamId }] } : {}),
        ...(q.from || q.to
          ? { kickoffAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } }
          : {}),
      },
      orderBy: [{ kickoffAt: 'asc' }, { id: 'asc' }],
      include: { homeTeam: { select: teamSelect }, awayTeam: { select: teamSelect } },
      ...cursorArgs(q.cursor, q.limit),
    });

    const page = paginate(rows, q.limit);
    res.json({ fixtures: page.items.map(toFixtureDto), nextCursor: page.nextCursor });
  },
);

footballRouter.get(
  '/fixtures/:id',
  validate({ params: z.object({ id: z.string() }) }),
  async (req, res) => {
    const fixture = await prisma.fixture.findUnique({
      where: { id: req.params.id as string },
      include: {
        homeTeam: { select: teamSelect },
        awayTeam: { select: teamSelect },
        round: { select: { id: true, name: true, type: true, number: true } },
        venue: true,
        tie: true,
        events: {
          orderBy: { sequence: 'asc' },
          include: {
            player: { select: { id: true, slug: true, displayName: true } },
            team: { select: { id: true, tla: true } },
          },
        },
        teamStats: true,
      },
    });
    if (!fixture) throw notFound('No such fixture.');
    res.json({
      fixture: { ...toFixtureDto(fixture), events: fixture.events, teamStats: fixture.teamStats },
    });
  },
);

// ── Teams and players ─────────────────────────────────────────────────────

footballRouter.get(
  '/teams/:slug',
  validate({ params: z.object({ slug: z.string() }) }),
  async (req, res) => {
    const team = await prisma.team.findUnique({
      where: { slug: req.params.slug as string },
      include: {
        country: { select: { name: true, isoCode: true } },
        venue: true,
        teamSeasons: {
          include: {
            stat: true,
            season: { include: { competition: { select: { slug: true, name: true } } } },
          },
          orderBy: { season: { startYear: 'desc' } },
          take: 5,
        },
      },
    });
    if (!team) throw notFound('No such team.');
    res.json({ team });
  },
);

footballRouter.get(
  '/teams/:slug/squad',
  validate({
    params: z.object({ slug: z.string() }),
    query: z.object({ seasonId: z.string().optional() }),
  }),
  async (req, res) => {
    const team = await prisma.team.findUnique({
      where: { slug: req.params.slug as string },
      select: { id: true },
    });
    if (!team) throw notFound('No such team.');

    const registrations = await prisma.playerRegistration.findMany({
      where: {
        teamSeason: {
          teamId: team.id,
          ...((req.query as { seasonId?: string }).seasonId
            ? { seasonId: (req.query as { seasonId?: string }).seasonId }
            : {}),
        },
      },
      include: { player: true },
      orderBy: { shirtNumber: 'asc' },
    });

    res.json({
      squad: registrations.map((r) => ({
        ...r.player,
        shirtNumber: r.shirtNumber,
        onLoan: r.onLoan,
      })),
      // Squads need the Deep Data plan (§11.5). An empty list on the free tier
      // is a plan limitation, not a bug — say so rather than looking broken.
      note:
        registrations.length === 0
          ? 'Squad data requires the Deep Data plan (task D-01c).'
          : undefined,
    });
  },
);

footballRouter.get(
  '/players/search',
  validate({
    query: z.object({
      q: z.string().min(2, 'Type at least two characters'),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }),
  }),
  async (req, res) => {
    const { q, limit } = req.query as unknown as { q: string; limit: number };

    // Trigram index on display_name (§7.2) keeps this instant while typing,
    // which is what the goalscorer picker needs.
    const players = await prisma.$queryRaw<
      { id: string; slug: string; display_name: string; position: string | null }[]
    >`
      SELECT id, slug, display_name, position::text
      FROM players
      WHERE display_name % ${q} OR display_name ILIKE ${'%' + q + '%'}
      ORDER BY similarity(display_name, ${q}) DESC
      LIMIT ${limit}
    `;

    res.json({
      players: players.map((p) => ({
        id: p.id,
        slug: p.slug,
        displayName: p.display_name,
        position: p.position,
      })),
    });
  },
);

footballRouter.get(
  '/players/:slug',
  validate({ params: z.object({ slug: z.string() }) }),
  async (req, res) => {
    const player = await prisma.player.findUnique({
      where: { slug: req.params.slug as string },
      include: {
        nationality: { select: { name: true, isoCode: true } },
        seasonStats: {
          include: {
            team: { select: teamSelect },
            season: { include: { competition: { select: { slug: true, name: true } } } },
          },
          orderBy: { season: { startYear: 'desc' } },
        },
      },
    });
    if (!player) throw notFound('No such player.');
    res.json({ player });
  },
);

// ── Knockout bracket (Phase 1b surface) ───────────────────────────────────

footballRouter.get(
  '/seasons/:id/bracket',
  validate({ params: z.object({ id: z.string() }) }),
  async (req, res) => {
    const rounds = await prisma.round.findMany({
      where: {
        seasonId: req.params.id as string,
        type: {
          in: [
            RoundType.KNOCKOUT_PLAYOFF,
            RoundType.ROUND_OF_16,
            RoundType.QUARTER_FINAL,
            RoundType.SEMI_FINAL,
            RoundType.FINAL,
          ],
        },
      },
      orderBy: { number: 'asc' },
      include: {
        fixtures: {
          orderBy: { kickoffAt: 'asc' },
          include: { homeTeam: { select: teamSelect }, awayTeam: { select: teamSelect } },
        },
        ties: {
          include: {
            teamA: { select: teamSelect },
            teamB: { select: teamSelect },
            winner: { select: teamSelect },
          },
        },
      },
    });

    res.json({
      bracket: rounds.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        isTwoLegged: r.isTwoLegged,
        ties: r.ties,
        fixtures: r.fixtures.map(toFixtureDto),
      })),
    });
  },
);

// ── DTO ───────────────────────────────────────────────────────────────────

type FixtureRow = {
  id: string;
  kickoffAt: Date;
  status: string;
  minute: number | null;
  homeGoals: number | null;
  awayGoals: number | null;
  homeGoalsHt: number | null;
  awayGoalsHt: number | null;
  homeGoalsEt: number | null;
  awayGoalsEt: number | null;
  homePenalties: number | null;
  awayPenalties: number | null;
  outcome: string | null;
  legNumber: number | null;
  homeTeam: unknown;
  awayTeam: unknown;
  tie?: unknown;
};

/**
 * `homeGoals` is the 90-minute score, sourced from score.regularTime.
 * The provider's `fullTime` is never stored and never served — on a shootout
 * it is a scoreline that never happened (§11.1).
 */
function toFixtureDto(f: FixtureRow) {
  return {
    id: f.id,
    kickoffAt: f.kickoffAt,
    status: f.status,
    minute: f.minute,
    score: {
      home: f.homeGoals,
      away: f.awayGoals,
      halfTime: { home: f.homeGoalsHt, away: f.awayGoalsHt },
      extraTime: { home: f.homeGoalsEt, away: f.awayGoalsEt },
      penalties: { home: f.homePenalties, away: f.awayPenalties },
    },
    outcome: f.outcome,
    legNumber: f.legNumber,
    homeTeam: f.homeTeam,
    awayTeam: f.awayTeam,
    ...(f.tie ? { tie: f.tie } : {}),
  };
}
