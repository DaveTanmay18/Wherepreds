import type { RequestHandler } from 'express';

/**
 * HTTP caching (task P1-22, §12.3).
 *
 * Football data is public and changes slowly, so it gets a short max-age with
 * a long stale-while-revalidate: a CDN can keep serving while it refreshes.
 * Anything user-scoped is `no-store` — a shared cache holding one member's
 * predictions would leak them to the whole league.
 */
export const publicCache =
  (maxAge = 60, swr = 300): RequestHandler =>
  (_req, res, next) => {
    res.set('Cache-Control', `public, max-age=${maxAge}, stale-while-revalidate=${swr}`);
    next();
  };

export const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
};

/** Cursor pagination (task P1-23). Offset pagination is never used: it skips
 *  or repeats rows whenever the underlying set changes between pages. */
export type Page<T> = { items: T[]; nextCursor: string | null };

export function paginate<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null };
}

/** Prisma `cursor`/`skip`/`take` args for a cursor-paginated query. */
export function cursorArgs(cursor: string | undefined, limit: number) {
  return {
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  };
}
