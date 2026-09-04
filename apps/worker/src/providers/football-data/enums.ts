import { FixtureStatus, MatchOutcome, RoundType } from '@wp/db';

/**
 * Strict provider-enum mapping (task P1-04a).
 *
 * ⚠️ The published v4 docs are wrong on four counts, all verified live on
 * 2026-08-18:
 *   - `winner` is HOME_TEAM/AWAY_TEAM, not HOME/AWAY
 *   - `duration` includes PENALTY_SHOOTOUT, not just REGULAR|PENALTY
 *   - `score` carries regularTime/extraTime/penalties, undocumented
 *   - `stage` has LEAGUE_STAGE, absent from the documented enum, and it is
 *     what the entire UCL league phase uses (144 matches)
 *
 * So every mapping here THROWS on an unrecognised value rather than falling
 * back to a default. A permissive `default:` would have silently mapped the
 * whole Champions League league phase to REGULAR_SEASON and corrupted round
 * ordering with no error anywhere.
 */

export class UnknownProviderValueError extends Error {
  constructor(kind: string, value: string) {
    super(
      `Unrecognised ${kind} value "${value}" from football-data.org. ` +
        `Add it to the mapping in providers/football-data/enums.ts — do NOT add a default branch. ` +
        `See architecture.md §11.1.`,
    );
    this.name = 'UnknownProviderValueError';
  }
}

/** Provider status → our FixtureStatus. Extra time and shootouts are inferred
 *  from score.duration, because the provider has no distinct status for them. */
const STATUS: Record<string, FixtureStatus> = {
  SCHEDULED: FixtureStatus.SCHEDULED,
  TIMED: FixtureStatus.SCHEDULED, // kickoff time confirmed
  IN_PLAY: FixtureStatus.LIVE,
  PAUSED: FixtureStatus.HALF_TIME,
  FINISHED: FixtureStatus.FINISHED,
  SUSPENDED: FixtureStatus.DELAYED,
  POSTPONED: FixtureStatus.POSTPONED,
  CANCELLED: FixtureStatus.CANCELLED,
  AWARDED: FixtureStatus.AWARDED,
};

export function mapStatus(raw: string, duration?: string): FixtureStatus {
  const base = STATUS[raw];
  if (!base) throw new UnknownProviderValueError('status', raw);

  // A live match past 90 minutes reports IN_PLAY regardless of phase.
  if (base === FixtureStatus.LIVE) {
    if (duration === 'PENALTY_SHOOTOUT') return FixtureStatus.PENALTY_SHOOTOUT;
    if (duration === 'EXTRA_TIME') return FixtureStatus.EXTRA_TIME;
  }
  return base;
}

/** Terminal statuses end a match; only FINISHED and AWARDED yield a result. */
export function isTerminal(raw: string): boolean {
  return raw === 'FINISHED' || raw === 'AWARDED';
}

const OUTCOME: Record<string, MatchOutcome> = {
  HOME_TEAM: MatchOutcome.HOME,
  AWAY_TEAM: MatchOutcome.AWAY,
  DRAW: MatchOutcome.DRAW,
};

export function mapOutcome(raw: string | null | undefined): MatchOutcome | null {
  if (raw == null) return null;
  const mapped = OUTCOME[raw];
  if (!mapped) throw new UnknownProviderValueError('score.winner', raw);
  return mapped;
}

const DURATIONS = new Set(['REGULAR', 'EXTRA_TIME', 'PENALTY_SHOOTOUT', 'PENALTY']);

export function assertKnownDuration(raw: string | undefined): void {
  if (raw && !DURATIONS.has(raw)) throw new UnknownProviderValueError('score.duration', raw);
}

/**
 * Provider stage → RoundType. Counts verified against the 2024/25 UCL:
 * LEAGUE_STAGE 144, PLAYOFFS 16, LAST_16 16, QUARTER_FINALS 8,
 * SEMI_FINALS 4, FINAL 1 — every knockout count is exactly ties x 2 legs.
 */
const STAGE: Record<string, RoundType> = {
  REGULAR_SEASON: RoundType.REGULAR_SEASON,
  GROUP_STAGE: RoundType.GROUP_STAGE,
  LEAGUE_STAGE: RoundType.LEAGUE_PHASE, // undocumented; the UCL league phase
  PLAYOFFS: RoundType.KNOCKOUT_PLAYOFF,
  PLAYOFF_ROUND_1: RoundType.KNOCKOUT_PLAYOFF,
  PLAYOFF_ROUND_2: RoundType.KNOCKOUT_PLAYOFF,
  LAST_16: RoundType.ROUND_OF_16,
  QUARTER_FINALS: RoundType.QUARTER_FINAL,
  SEMI_FINALS: RoundType.SEMI_FINAL,
  FINAL: RoundType.FINAL,
};

export function mapStage(raw: string): RoundType {
  const mapped = STAGE[raw];
  if (!mapped) throw new UnknownProviderValueError('stage', raw);
  return mapped;
}

/** Two-legged stages. The final is a single match; the rest are home and away. */
const TWO_LEGGED = new Set<RoundType>([
  RoundType.KNOCKOUT_PLAYOFF,
  RoundType.ROUND_OF_16,
  RoundType.QUARTER_FINAL,
  RoundType.SEMI_FINAL,
]);

export const isTwoLegged = (type: RoundType): boolean => TWO_LEGGED.has(type);

export const isKnockout = (type: RoundType): boolean =>
  TWO_LEGGED.has(type) || type === RoundType.FINAL;

/**
 * Stage ordering for Round.number in a cup, so "next round" sorts correctly.
 * League matchdays use their own matchday number instead.
 */
export const STAGE_ORDER: Record<RoundType, number> = {
  [RoundType.REGULAR_SEASON]: 0,
  [RoundType.GROUP_STAGE]: 0,
  [RoundType.LEAGUE_PHASE]: 0,
  [RoundType.KNOCKOUT_PLAYOFF]: 100,
  [RoundType.ROUND_OF_16]: 200,
  [RoundType.QUARTER_FINAL]: 300,
  [RoundType.SEMI_FINAL]: 400,
  [RoundType.FINAL]: 500,
};

const POSITION: Record<string, 'GOALKEEPER' | 'DEFENDER' | 'MIDFIELDER' | 'FORWARD'> = {
  Goalkeeper: 'GOALKEEPER',
  Defence: 'DEFENDER',
  Defender: 'DEFENDER',
  Midfield: 'MIDFIELDER',
  Midfielder: 'MIDFIELDER',
  Offence: 'FORWARD',
  Forward: 'FORWARD',
  Attacker: 'FORWARD',
};

/**
 * Position is cosmetic, so an unknown value degrades to null rather than
 * throwing — unlike stage or status, a wrong position label cannot corrupt
 * scoring or round ordering.
 */
export function mapPosition(raw: string | null | undefined) {
  if (!raw) return null;
  return POSITION[raw] ?? null;
}
