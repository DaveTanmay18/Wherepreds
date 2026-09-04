import { KnockoutScoreBasis } from '@wp/db';

/**
 * Knockout score resolution (task P4b-02).
 *
 * ⚠️ Resolved BEFORE any rule runs, so rules never branch on the basis — the
 * fact builder simply receives whatever "the score" means for this league
 * (§8.8).
 *
 * The stored columns already carry the pieces separately:
 *   homeGoals / awayGoals      the 90-minute score (score.regularTime)
 *   homeGoalsEt / awayGoalsEt  extra-time goals only, not cumulative
 *   homePenalties / awayPens   the shootout
 *
 * The provider's `score.fullTime` is these three SUMMED — a scoreline that
 * never happened — and is deliberately never stored (§11.1).
 */

export type LegScore = {
  homeGoals: number;
  awayGoals: number;
  homeGoalsEt: number | null;
  awayGoalsEt: number | null;
  homePenalties: number | null;
  awayPenalties: number | null;
};

export type ResolvedScore = {
  homeGoals: number;
  awayGoals: number;
  wentToExtraTime: boolean;
  wentToPenalties: boolean;
};

export function resolveKnockoutScore(fixture: LegScore, basis: KnockoutScoreBasis): ResolvedScore {
  const wentToExtraTime = (fixture.homeGoalsEt ?? 0) > 0 || (fixture.awayGoalsEt ?? 0) > 0;
  const wentToPenalties = fixture.homePenalties !== null && fixture.awayPenalties !== null;

  switch (basis) {
    case KnockoutScoreBasis.AFTER_EXTRA_TIME:
      return {
        homeGoals: fixture.homeGoals + (fixture.homeGoalsEt ?? 0),
        awayGoals: fixture.awayGoals + (fixture.awayGoalsEt ?? 0),
        wentToExtraTime,
        wentToPenalties,
      };

    case KnockoutScoreBasis.INCLUDING_PENALTIES:
      /**
       * ⚠️ The subtle one. Under this basis the SHOOTOUT decides the outcome
       * market, but the exact score stays the 90-minute score — nobody
       * predicts "5-4 on penalties" as a scoreline. So the goals returned here
       * are nudged only enough to make `outcome` reflect who won, leaving the
       * scoreline itself honest. See the P4b-11 tests, which pin this down.
       */
      if (wentToPenalties && fixture.homePenalties !== fixture.awayPenalties) {
        const homeWon = (fixture.homePenalties ?? 0) > (fixture.awayPenalties ?? 0);
        const level = fixture.homeGoals === fixture.awayGoals;
        if (level) {
          return {
            homeGoals: fixture.homeGoals + (homeWon ? 1 : 0),
            awayGoals: fixture.awayGoals + (homeWon ? 0 : 1),
            wentToExtraTime,
            wentToPenalties,
          };
        }
      }
      return {
        homeGoals: fixture.homeGoals,
        awayGoals: fixture.awayGoals,
        wentToExtraTime,
        wentToPenalties,
      };

    case KnockoutScoreBasis.NINETY_MINUTES:
    default:
      // The default, and what nearly every house rule means by "the score".
      return {
        homeGoals: fixture.homeGoals,
        awayGoals: fixture.awayGoals,
        wentToExtraTime,
        wentToPenalties,
      };
  }
}

/**
 * TO_QUALIFY is asked on the DECIDING leg only — leg 2, or a one-off final
 * (task P4b-06). Asking on leg 1 would hold a prediction unscored across two
 * weeks for no gain (§8.8).
 */
export function isDecidingLeg(legNumber: number | null, isTwoLegged: boolean): boolean {
  if (!isTwoLegged) return true;
  return legNumber === 2;
}
