import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@wp/db';
import { notFound } from '../../errors.js';
import { loadUser, requireUser } from '../../middleware/auth.js';
import { noStore } from '../../middleware/cache.js';
import { loadLeague, requireLeagueAdmin, requireMember } from '../../middleware/league.js';
import { validate } from '../../middleware/validate.js';
import { capabilitiesFromEnv, footballEnvSchema, marketAvailability, MARKETS } from '@wp/shared';
import {
  createRuleSetVersion,
  DEFAULT_CASES,
  simulate,
  toValidationError,
  validateConfig,
  type SimulationCase,
} from '../../services/rules.service.js';

export const rulesRouter: Router = Router();
rulesRouter.use(noStore, loadUser);

const configBody = z.object({
  config: z.unknown(),
  name: z.string().trim().max(60).optional(),
  deadlineStrategy: z
    .enum(['PER_FIXTURE_KICKOFF', 'ROUND_FIRST_KICKOFF', 'FIXED_DATETIME', 'CUSTOM_PER_ROUND'])
    .optional(),
  deadlineOffsetMin: z.number().int().min(-180).max(10080).optional(),
  allowEdits: z.boolean().optional(),
  revealPicksBeforeDeadline: z.boolean().optional(),
  missedPredictionPoints: z.number().int().min(-50).max(0).optional(),
  fixturesPerRound: z.number().int().min(1).max(20).nullable().optional(),
  knockoutScoreBasis: z
    .enum(['NINETY_MINUTES', 'AFTER_EXTRA_TIME', 'INCLUDING_PENALTIES'])
    .optional(),
  voidPostponedFixtures: z.boolean().optional(),
});

/** Is this league on a competition with knockout rounds? Drives the
 *  positional-fact warning (task P4b-07). */
async function isKnockoutCompetition(leagueId: string): Promise<boolean> {
  const league = await prisma.predictionLeague.findUnique({
    where: { id: leagueId },
    select: { season: { select: { competition: { select: { type: true } } } } },
  });
  return league?.season.competition.type === 'CONTINENTAL';
}

// ── Read ──────────────────────────────────────────────────────────────────

rulesRouter.get('/leagues/:slug/rules', loadLeague, requireMember, async (req, res) => {
  const ruleSet = await prisma.ruleSet.findFirst({
    where: { leagueId: req.league!.leagueId, isActive: true },
    orderBy: { version: 'desc' },
  });
  if (!ruleSet) throw notFound('This league has no rules yet.');

  res.json({
    rules: {
      version: ruleSet.version,
      name: ruleSet.name,
      isFrozen: ruleSet.isFrozen,
      config: ruleSet.config,
      deadlineStrategy: ruleSet.deadlineStrategy,
      deadlineOffsetMin: ruleSet.deadlineOffsetMin,
      allowEdits: ruleSet.allowEdits,
      revealPicksBeforeDeadline: ruleSet.revealPicksBeforeDeadline,
      missedPredictionPoints: ruleSet.missedPredictionPoints,
      fixturesPerRound: ruleSet.fixturesPerRound,
      knockoutScoreBasis: ruleSet.knockoutScoreBasis,
      voidPostponedFixtures: ruleSet.voidPostponedFixtures,
      canEditInPlace: !ruleSet.isFrozen,
    },
    // What the editor may offer. A market the plan cannot score is listed with
    // the reason rather than hidden, so an admin understands WHY it is off and
    // what would turn it on (§11.5).
    availableMarkets: (() => {
      const caps = capabilitiesFromEnv(footballEnvSchema.parse(process.env));
      return MARKETS.map((m) => {
        const a = marketAvailability(m, caps);
        return {
          market: m,
          available: a.available,
          reason: a.available ? null : a.reason,
        };
      });
    })(),
    factOptions: FACT_OPTIONS,
  });
});

/**
 * Facts a condition may read, grouped by the market that makes them
 * meaningful. The editor shows only the facts the selected markets expose —
 * surfacing all of ScoringFacts at once is the clutter risk §14.1 warns about.
 */
const FACT_OPTIONS = [
  {
    fact: 'derived.exactScore',
    label: 'the exact score is right',
    type: 'boolean',
    markets: ['EXACT_SCORE'],
  },
  {
    fact: 'derived.outcomeCorrect',
    label: 'the result is right',
    type: 'boolean',
    markets: ['MATCH_OUTCOME', 'EXACT_SCORE'],
  },
  {
    fact: 'derived.goalDifferenceCorrect',
    label: 'the goal difference is right',
    type: 'boolean',
    markets: ['EXACT_SCORE'],
  },
  {
    fact: 'derived.bttsCorrect',
    label: 'both-teams-to-score is right',
    type: 'boolean',
    markets: ['BOTH_TEAMS_TO_SCORE'],
  },
  {
    fact: 'derived.absoluteGoalError',
    label: 'how far off the scoreline was',
    type: 'number',
    markets: ['EXACT_SCORE'],
  },
  {
    fact: 'derived.anytimeScorerHits',
    label: 'goalscorers correctly named',
    type: 'number',
    markets: ['ANYTIME_GOALSCORER'],
  },
  {
    fact: 'derived.firstScorerCorrect',
    label: 'the first goalscorer is right',
    type: 'boolean',
    markets: ['FIRST_GOALSCORER'],
  },
  {
    fact: 'derived.qualifierCorrect',
    label: 'the side that went through is right',
    type: 'boolean',
    markets: ['TO_QUALIFY'],
  },
  { fact: 'actual.totalGoals', label: 'total goals in the match', type: 'number', markets: [] },
  {
    fact: 'actual.redCardShown',
    label: 'a red card was shown',
    type: 'boolean',
    markets: ['RED_CARD_SHOWN'],
  },
  {
    fact: 'context.consensusShare',
    label: 'share of the league who agreed',
    type: 'number',
    markets: [],
  },
  { fact: 'context.upsetGap', label: 'how big an upset it was', type: 'number', markets: [] },
  { fact: 'context.isFinalRound', label: 'it is the final round', type: 'boolean', markets: [] },
] as const;

rulesRouter.get('/leagues/:slug/rules/versions', loadLeague, requireMember, async (req, res) => {
  const versions = await prisma.ruleSet.findMany({
    where: { leagueId: req.league!.leagueId },
    orderBy: { version: 'desc' },
    select: {
      version: true,
      name: true,
      isActive: true,
      isFrozen: true,
      createdAt: true,
      config: true,
      leagueRounds: { select: { sequence: true }, orderBy: { sequence: 'asc' }, take: 1 },
    },
  });

  res.json({
    versions: versions.map((v) => ({
      version: v.version,
      name: v.name,
      isActive: v.isActive,
      isFrozen: v.isFrozen,
      createdAt: v.createdAt,
      // Which round this version first governed — the answer to "when did the
      // rules change?" (§8.7).
      appliesFromRound: v.leagueRounds[0]?.sequence ?? null,
      config: v.config,
    })),
  });
});

// ── Validate (task P4-01, P4-01a) ─────────────────────────────────────────

rulesRouter.post(
  '/leagues/:slug/rules/validate',
  requireUser,
  loadLeague,
  requireLeagueAdmin,
  validate({ body: z.object({ config: z.unknown() }) }),
  async (req, res) => {
    const result = validateConfig((req.body as { config: unknown }).config, {
      isKnockoutCompetition: await isKnockoutCompetition(req.league!.leagueId),
    });

    // Always 200: this is a dry run, and the caller wants the issue list
    // whether or not it passed.
    res.json({
      valid: result.valid,
      errors: result.issues.filter((i) => i.severity === 'error'),
      warnings: result.issues.filter((i) => i.severity === 'warning'),
    });
  },
);

// ── Simulate (task P4-02) ─────────────────────────────────────────────────

rulesRouter.post(
  '/leagues/:slug/rules/simulate',
  requireUser,
  loadLeague,
  requireLeagueAdmin,
  validate({
    body: z.object({
      config: z.unknown(),
      cases: z
        .array(
          z.object({
            label: z.string().max(60),
            predicted: z.tuple([z.number().int().min(0).max(20), z.number().int().min(0).max(20)]),
            actual: z.tuple([z.number().int().min(0).max(20), z.number().int().min(0).max(20)]),
            consensusShare: z.number().min(0).max(1).optional(),
          }),
        )
        .max(20)
        .optional(),
    }),
  }),
  async (req, res) => {
    const body = req.body as { config: unknown; cases?: SimulationCase[] };
    const result = validateConfig(body.config, {
      isKnockoutCompetition: await isKnockoutCompetition(req.league!.leagueId),
    });

    if (!result.config) {
      return res.json({
        valid: false,
        errors: result.issues.filter((i) => i.severity === 'error'),
        results: [],
      });
    }

    res.json({
      valid: true,
      warnings: result.issues.filter((i) => i.severity === 'warning'),
      results: simulate(result.config, body.cases ?? DEFAULT_CASES),
    });
  },
);

// ── Save (tasks P4-03 to P4-07) ───────────────────────────────────────────

rulesRouter.post(
  '/leagues/:slug/rules',
  requireUser,
  loadLeague,
  requireLeagueAdmin,
  validate({ body: configBody }),
  async (req, res) => {
    const body = req.body as z.infer<typeof configBody>;

    const result = validateConfig(body.config, {
      isKnockoutCompetition: await isKnockoutCompetition(req.league!.leagueId),
    });
    if (!result.config) throw toValidationError(result.issues);

    const saved = await createRuleSetVersion(
      req.league!.leagueId,
      req.user!.id,
      result.config,
      body,
    );

    res.status(saved.newVersion ? 201 : 200).json({
      version: saved.ruleSet.version,
      // A new version means past rounds are untouched — say so explicitly,
      // because that is the guarantee an admin is relying on (§8.7).
      newVersion: saved.newVersion,
      appliesFromRound: saved.appliesFromRound,
      warnings: result.issues.filter((i) => i.severity === 'warning'),
    });
  },
);
