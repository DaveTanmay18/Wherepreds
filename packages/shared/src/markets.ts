import type { ProviderCapabilities } from './env.js';

/**
 * Market availability gating (architecture.md §11.5, task P4-01a).
 *
 * Kept here rather than in @wp/scoring so both the API (rule validation) and
 * the web app (which markets to offer in the editor) can read it without the
 * web app depending on the scoring engine.
 */

export const MARKETS = [
  'EXACT_SCORE',
  'MATCH_OUTCOME',
  'DOUBLE_CHANCE',
  'BOTH_TEAMS_TO_SCORE',
  'TOTAL_GOALS_OVER_UNDER',
  'CORRECT_MARGIN',
  'HALF_TIME_OUTCOME',
  'FIRST_GOALSCORER',
  'ANYTIME_GOALSCORER',
  'CLEAN_SHEET',
  'RED_CARD_SHOWN',
  'TOTAL_CORNERS_OVER_UNDER',
  'TO_QUALIFY',
] as const;

export type Market = (typeof MARKETS)[number];

type Requirement = keyof ProviderCapabilities | null;

/** What each market needs from the provider. null = works on any plan. */
const MARKET_REQUIREMENTS: Record<Market, Requirement> = {
  EXACT_SCORE: null,
  MATCH_OUTCOME: null,
  DOUBLE_CHANCE: null,
  BOTH_TEAMS_TO_SCORE: null,
  TOTAL_GOALS_OVER_UNDER: null,
  CORRECT_MARGIN: null,
  HALF_TIME_OUTCOME: null,
  CLEAN_SHEET: null,
  // Knockout qualifier is derived from stored leg scores, which every plan
  // supplies — score.regularTime / extraTime / penalties (§8.8).
  TO_QUALIFY: null,

  FIRST_GOALSCORER: 'goalEvents',
  ANYTIME_GOALSCORER: 'goalEvents',
  RED_CARD_SHOWN: 'cardEvents',
  TOTAL_CORNERS_OVER_UNDER: 'teamStatistics',
};

const REMEDY: Record<string, string> = {
  goalEvents: 'the Deep Data plan (EUR 29/mo), which supplies the goals[] array',
  cardEvents: 'the Deep Data plan (EUR 29/mo), which supplies the bookings[] array',
  teamStatistics: 'the Statistic add-on (EUR 15/mo), which supplies corner counts',
};

export type MarketAvailability =
  | { market: Market; available: true }
  | { market: Market; available: false; requires: string; reason: string };

export function marketAvailability(market: Market, caps: ProviderCapabilities): MarketAvailability {
  const requirement = MARKET_REQUIREMENTS[market];
  if (requirement === null || caps[requirement]) return { market, available: true };

  return {
    market,
    available: false,
    requires: requirement,
    reason: `"${market}" cannot be scored on the current data plan. It needs ${REMEDY[requirement] ?? requirement}.`,
  };
}

export function availableMarkets(caps: ProviderCapabilities): Market[] {
  return MARKETS.filter((m) => marketAvailability(m, caps).available);
}

/**
 * Used by POST /rules/validate. Returns one entry per unusable market so the
 * admin sees every problem at once, with the reason and the fix named.
 */
export function rejectUnavailableMarkets(
  markets: readonly Market[],
  caps: ProviderCapabilities,
): Extract<MarketAvailability, { available: false }>[] {
  return markets
    .map((m) => marketAvailability(m, caps))
    .filter((r): r is Extract<MarketAvailability, { available: false }> => !r.available);
}
