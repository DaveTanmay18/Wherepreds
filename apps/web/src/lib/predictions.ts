import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api.js';

export type TeamRef = {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  tla: string | null;
  crestUrl: string | null;
};

export type Selection = {
  market: string;
  homeGoals: number | null;
  awayGoals: number | null;
  outcome: string | null;
};

export type BreakdownEntry = {
  kind: 'award' | 'multiplier';
  ruleId: string;
  label: string;
  points?: number;
  factor?: number;
};

export type RoundFixture = {
  leagueFixtureId: string;
  /** The football fixture, for linking to the match centre. */
  fixtureId: string;
  position: number;
  isVoided: boolean;
  deadlineAt: string;
  kickoffAt: string;
  status: string;
  homeTeam: TeamRef;
  awayTeam: TeamRef;
  legNumber: number | null;
  /** TO_QUALIFY is only asked here — leg 2, or a one-off final (§8.8). */
  isDecidingLeg: boolean;
  result: { home: number; away: number } | null;
  prediction: {
    status: string;
    note: string | null;
    selections: Selection[];
    points: string | null;
    breakdown: BreakdownEntry[] | null;
  } | null;
};

export type RoundDetail = {
  id: string;
  sequence: number;
  status: string;
  deadlineAt: string;
  isProvisional: boolean;
  /** Server clock, so countdowns never trust the device (§13.3). */
  serverTime: string;
  round: { name: string; type: string; number: number };
  markets: string[];
  allowEdits: boolean;
  fixtures: RoundFixture[];
};

export type RoundSummary = {
  sequence: number;
  status: string;
  deadlineAt: string;
  isProvisional: boolean;
  name: string;
  type: string;
  fixtureCount: number;
};

export type StandingRow = {
  position: number;
  movement: number | null;
  user: { id: string; username: string; displayName: string };
  isViewer: boolean;
  roundPoints: number;
  totalPoints: number;
  exactScores: number;
  correctOutcomes: number;
};

export const useRounds = (slug: string | undefined) =>
  useQuery({
    queryKey: ['league', slug, 'rounds'],
    queryFn: () => api.get<{ rounds: RoundSummary[] }>(`/leagues/${slug}/rounds`),
    enabled: !!slug,
  });

export const useRound = (slug: string | undefined, sequence: number | undefined) =>
  useQuery({
    queryKey: ['league', slug, 'round', sequence],
    queryFn: () => api.get<{ round: RoundDetail }>(`/leagues/${slug}/rounds/${sequence}`),
    enabled: !!slug && !!sequence,
  });

export const useStandings = (slug: string | undefined) =>
  useQuery({
    queryKey: ['league', slug, 'standings'],
    queryFn: () =>
      api.get<{ standings: StandingRow[]; throughRound: number | null; isProvisional: boolean }>(
        `/leagues/${slug}/standings`,
      ),
    enabled: !!slug,
  });

export type PickPayload = {
  leagueFixtureId: string;
  selections: { market: string; homeGoals?: number; awayGoals?: number; teamId?: string }[];
};

export type SaveResult = {
  saved: string[];
  rejected: { leagueFixtureId: string; code: string; detail: string }[];
};

export function useSavePredictions(slug: string | undefined, sequence: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { predictions: PickPayload[]; submit: boolean }) =>
      api.put<SaveResult>(`/leagues/${slug}/rounds/${sequence}/predictions`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['league', slug, 'round', sequence] });
    },
  });
}

/**
 * Offline-tolerant draft store (task P3-25).
 *
 * Picks mirror to localStorage on every change, so closing the tab — or losing
 * signal on a train — never loses them. The server copy is authoritative once
 * saved; this is the safety net for the gap between tapping and saving.
 */
const draftKey = (slug: string, sequence: number) => `wp:draft:${slug}:${sequence}`;

export type DraftMap = Record<string, { home: number; away: number; qualifier?: string }>;

export function loadDraft(slug: string, sequence: number): DraftMap {
  try {
    return JSON.parse(localStorage.getItem(draftKey(slug, sequence)) ?? '{}') as DraftMap;
  } catch {
    return {};
  }
}

export function saveDraft(slug: string, sequence: number, draft: DraftMap): void {
  try {
    localStorage.setItem(draftKey(slug, sequence), JSON.stringify(draft));
  } catch {
    /* private browsing or quota — the server copy still applies */
  }
}

export function clearDraft(slug: string, sequence: number): void {
  try {
    localStorage.removeItem(draftKey(slug, sequence));
  } catch {
    /* ignore */
  }
}
