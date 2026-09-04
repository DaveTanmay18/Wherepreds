import { z } from 'zod';

/**
 * Auth DTOs. Shared so the web app builds requests against the exact schema
 * the API enforces (§3, §12.3).
 */

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Username must be at least 3 characters')
  .max(24, 'Username must be at most 24 characters')
  .regex(/^[a-zA-Z0-9_]+$/, 'Letters, numbers and underscores only');

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address');

/**
 * Length is the property that actually matters; composition rules mostly push
 * people towards `Password1!` and a sticky note. NIST guidance agrees.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200, 'That password is too long');

export const registerSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(50).optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password'),
});

export const sessionUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  isAdmin: z.boolean(),
  timezone: z.string(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type SessionUserDto = z.infer<typeof sessionUserSchema>;
