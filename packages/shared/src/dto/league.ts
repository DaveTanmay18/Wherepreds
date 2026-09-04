import { z } from 'zod';

/** League DTOs (§12.1). Shared so web and api validate identically. */

export const PRESET_IDS = [
  'classic',
  'exact_score_heavy',
  'underdog',
  'survival',
  'goalscorer',
] as const;

export const leagueVisibilitySchema = z.enum(['PUBLIC', 'UNLISTED', 'PRIVATE']);
export const memberRoleSchema = z.enum(['OWNER', 'ADMIN', 'MEMBER']);

export const createLeagueSchema = z.object({
  name: z.string().trim().min(3, 'Give your league a name').max(60),
  description: z.string().trim().max(280).optional(),
  seasonId: z.string().min(1, 'Pick a competition'),
  presetId: z.enum(PRESET_IDS).default('classic'),
  visibility: leagueVisibilitySchema.default('UNLISTED'),
  maxMembers: z.number().int().min(2).max(500).optional(),
});

export const updateLeagueSchema = z.object({
  name: z.string().trim().min(3).max(60).optional(),
  description: z.string().trim().max(280).nullable().optional(),
  visibility: leagueVisibilitySchema.optional(),
  maxMembers: z.number().int().min(2).max(500).nullable().optional(),
  joinCutoffRound: z.number().int().min(1).max(38).nullable().optional(),
  lateJoinPolicy: z.enum(['ZERO', 'AVERAGE', 'LOWEST']).optional(),
});

export const joinLeagueSchema = z
  .object({
    joinCode: z.string().trim().toUpperCase().length(6).optional(),
    inviteToken: z.string().trim().min(10).optional(),
  })
  .refine((v) => v.joinCode || v.inviteToken, {
    message: 'Provide a join code or an invite link',
  });

export const updateMemberSchema = z.object({
  role: z.enum(['ADMIN', 'MEMBER']).optional(),
  status: z.enum(['ACTIVE', 'REMOVED', 'BANNED']).optional(),
  nickname: z.string().trim().max(30).nullable().optional(),
});

export const createInviteSchema = z.object({
  email: z.string().email().optional(),
  maxUses: z.number().int().min(1).max(100).default(1),
  expiresInDays: z.number().int().min(1).max(90).default(14),
});

export type CreateLeagueInput = z.infer<typeof createLeagueSchema>;
export type UpdateLeagueInput = z.infer<typeof updateLeagueSchema>;
export type JoinLeagueInput = z.infer<typeof joinLeagueSchema>;
export type PresetId = (typeof PRESET_IDS)[number];
