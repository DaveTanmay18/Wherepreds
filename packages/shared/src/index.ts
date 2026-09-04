/**
 * @wp/shared — Zod DTOs and types shared between web, api and worker.
 *
 * This is a LEAF package: everything imports it, it imports nothing from the
 * workspace (enforced in eslint.config.mjs). Keep it free of Prisma types —
 * the API's wire format is deliberately not the database's row shape.
 */

export * from './env.js';
export * from './markets.js';
