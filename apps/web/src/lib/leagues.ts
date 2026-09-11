import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api.js';

export type Preset = {
  id: string;
  name: string;
  summary: string;
  highlights: string[];
  markets: string[];
};

export type MyLeague = {
  slug: string;
  name: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  memberCount: number;
  competition: { name: string; slug: string; logoUrl: string | null };
  seasonLabel: string;
};

export type LeagueDetail = {
  slug: string;
  name: string;
  description: string | null;
  visibility: string;
  joinCode: string | null;
  owner: { id: string; username: string; displayName: string };
  competition: { name: string; slug: string; logoUrl: string | null };
  seasonLabel: string;
  memberCount: number;
  roundCount: number;
  rules: { version: number; name: string; isFrozen: boolean; config: RuleConfig } | null;
  viewer: { role: string | null; isMember: boolean };
  nextRound: {
    id: string;
    sequence: number;
    deadlineAt: string;
    isProvisional: boolean;
    round: { name: string; type: string; number: number };
    _count: { fixtures: number };
  } | null;
};

export type RuleConfig = {
  markets: string[];
  awards: { id: string; label: string; points: number; group: string | null }[];
  multipliers: { id: string; label: string; factor: number }[];
  tiebreakers: string[];
  boosters: {
    type: string;
    value: number;
    usesPerSeason: number;
    /** Points lost when a boosted prediction scores nothing. 0 = risk-free. */
    penaltyIfWrong?: number;
  }[];
};

export type Member = {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  joinedAt: string;
};

export const usePresets = () =>
  useQuery({
    queryKey: ['presets'],
    queryFn: () => api.get<{ presets: Preset[] }>('/rules/presets'),
    staleTime: Infinity, // presets are code, not data
  });

export const useMyLeagues = () =>
  useQuery({
    queryKey: ['leagues', 'mine'],
    queryFn: () => api.get<{ leagues: MyLeague[] }>('/leagues/mine'),
  });

export const useLeague = (slug: string | undefined) =>
  useQuery({
    queryKey: ['league', slug],
    queryFn: () => api.get<{ league: LeagueDetail }>(`/leagues/${slug}`),
    enabled: !!slug,
  });

export const useMembers = (slug: string | undefined) =>
  useQuery({
    queryKey: ['league', slug, 'members'],
    queryFn: () => api.get<{ members: Member[] }>(`/leagues/${slug}/members`),
    enabled: !!slug,
  });

export function useCreateLeague() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string;
      seasonId: string;
      presetId: string;
      visibility: string;
      description?: string;
    }) =>
      api.post<{ league: { slug: string; name: string; joinCode: string }; rounds: number }>(
        '/leagues',
        input,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leagues', 'mine'] }),
  });
}

export function useJoinLeague() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { joinCode?: string; inviteToken?: string }) =>
      api.post<{ leagueSlug: string; alreadyMember: boolean }>('/leagues/join', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leagues', 'mine'] }),
  });
}
