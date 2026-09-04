import { prisma, type ExternalEntity, type Prisma } from '@wp/db';

/**
 * The ONLY place a provider identifier is allowed to live (architecture.md
 * §11.1, task P1-04). A provider id leaking into any other table destroys the
 * one-directory blast radius that makes swapping providers tractable.
 */

const PROVIDER = 'football-data-org';

export async function resolveInternalId(
  entity: ExternalEntity,
  externalId: string | number,
): Promise<string | null> {
  const ref = await prisma.externalRef.findUnique({
    where: {
      provider_entity_externalId: {
        provider: PROVIDER,
        entity,
        externalId: String(externalId),
      },
    },
    select: { internalId: true },
  });
  return ref?.internalId ?? null;
}

export async function link(
  entity: ExternalEntity,
  externalId: string | number,
  internalId: string,
  payload?: Prisma.InputJsonValue,
): Promise<void> {
  await prisma.externalRef.upsert({
    where: {
      provider_entity_externalId: {
        provider: PROVIDER,
        entity,
        externalId: String(externalId),
      },
    },
    update: { internalId, syncedAt: new Date(), ...(payload ? { payload } : {}) },
    create: {
      provider: PROVIDER,
      entity,
      externalId: String(externalId),
      internalId,
      ...(payload ? { payload } : {}),
    },
  });
}

/**
 * Bulk resolve, so a mapper handling 380 fixtures does not issue 760 lookups.
 * Returns a Map keyed by the provider's id as a string.
 */
export async function resolveMany(
  entity: ExternalEntity,
  externalIds: (string | number)[],
): Promise<Map<string, string>> {
  const ids = [...new Set(externalIds.map(String))];
  if (ids.length === 0) return new Map();

  const refs = await prisma.externalRef.findMany({
    where: { provider: PROVIDER, entity, externalId: { in: ids } },
    select: { externalId: true, internalId: true },
  });

  return new Map(refs.map((r) => [r.externalId, r.internalId]));
}
