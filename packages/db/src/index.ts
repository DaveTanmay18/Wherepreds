import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

/**
 * Neon is serverless Postgres, so the app talks to it through pgBouncer
 * (`DATABASE_URL`) while migrations use the direct connection (`DIRECT_URL`).
 * See architecture.md §7.4.
 *
 * The global cache keeps `tsx --watch` and Vite HMR from opening a new pool on
 * every reload, which otherwise exhausts connections within a few minutes of
 * development.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaRead: PrismaClient | undefined;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/**
 * Read replica for long analytical reads — season stats, historical tables.
 * Falls back to the primary when `READ_REPLICA_URL` is unset, so nothing
 * breaks before Phase 7 (task P7-01).
 *
 * Never use this for anything a user is about to write to: replica lag means a
 * member could submit a prediction and not see it on the next read.
 */
export const prismaRead: PrismaClient = process.env.READ_REPLICA_URL
  ? (globalForPrisma.prismaRead ??
    new PrismaClient({
      datasources: { db: { url: process.env.READ_REPLICA_URL } },
      log: ['warn', 'error'],
    }))
  : prisma;

if (process.env.NODE_ENV !== 'production' && process.env.READ_REPLICA_URL) {
  globalForPrisma.prismaRead = prismaRead;
}
