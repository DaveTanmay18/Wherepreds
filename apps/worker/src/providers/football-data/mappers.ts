import type { MatchOutcome } from '@wp/db';
import type { RawMatch, RawScore, RawTeam } from '../types.js';
import { assertKnownDuration, mapOutcome, mapStatus } from './enums.js';

/**
 * Raw provider shapes → our domain. Nothing outside providers/ sees a
 * provider field name (§11.1).
 */

/** Stable, URL-safe slug. Collisions are resolved by the caller with the id. */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export type MappedScore = {
  homeGoals: number | null;
  awayGoals: number | null;
  homeGoalsHt: number | null;
  awayGoalsHt: number | null;
  homeGoalsEt: number | null;
  awayGoalsEt: number | null;
  homePenalties: number | null;
  awayPenalties: number | null;
  outcome: MatchOutcome | null;
};

/**
 * ⚠️⚠️ THE most dangerous fact about this API (§11.1, task P1-04b).
 *
 * `score.fullTime` = regularTime + extraTime + penalties. Verified live across
 * every non-regular 2024/25 UCL match:
 *
 *   Liverpool v PSG   reg 0-1  et 0-0  pens 1-4  →  fullTime 1-5
 *   Atlético v Real   reg 1-0  et 0-0  pens 2-4  →  fullTime 3-4
 *   Inter v Barcelona reg 3-3  et 1-0            →  fullTime 4-3
 *
 * Liverpool never lost 1-5 and Atlético never lost 3-4 — those scorelines
 * never happened. Reading fullTime would score exact-score predictions against
 * fiction, on the biggest nights of the season, and nothing would throw.
 *
 * So homeGoals/awayGoals come from `regularTime`, always. This function is the
 * only place in the codebase permitted to touch `fullTime`, and it only does
 * so as a fallback for league matches, where no extra time exists and the two
 * are by definition identical.
 */
export function mapScore(score: RawScore): MappedScore {
  assertKnownDuration(score.duration);

  const isRegularDuration = !score.duration || score.duration === 'REGULAR';

  // regularTime is absent on ordinary league matches, where fullTime IS the
  // 90-minute score. It is present exactly when it could differ.
  const regular = score.regularTime ?? (isRegularDuration ? score.fullTime : null);

  return {
    homeGoals: regular?.home ?? null,
    awayGoals: regular?.away ?? null,
    homeGoalsHt: score.halfTime?.home ?? null,
    awayGoalsHt: score.halfTime?.away ?? null,
    homeGoalsEt: score.extraTime?.home ?? null,
    awayGoalsEt: score.extraTime?.away ?? null,
    homePenalties: score.penalties?.home ?? null,
    awayPenalties: score.penalties?.away ?? null,
    outcome: mapOutcome(score.winner),
  };
}

export function mapTeam(raw: RawTeam) {
  return {
    name: raw.name,
    shortName: raw.shortName ?? null,
    tla: raw.tla?.slice(0, 4) ?? null,
    crestUrl: raw.crest ?? null,
    foundedYear: raw.founded ?? null,
    primaryColor: null,
  };
}

export function mapMatchCore(raw: RawMatch) {
  return {
    kickoffAt: new Date(raw.utcDate),
    status: mapStatus(raw.status, raw.score?.duration),
    minute: raw.minute ?? null,
    injuryTime: raw.injuryTime ?? null,
    ...mapScore(raw.score),
  };
}

/**
 * A club's first-leg home fixture defines "team A" for a tie, so the pairing
 * is stable no matter which leg we ingest first. Sorting the two ids gives a
 * deterministic key for matching the second leg back to the first.
 */
export function tieKey(teamOne: string, teamTwo: string): string {
  return [teamOne, teamTwo].sort().join('::');
}
