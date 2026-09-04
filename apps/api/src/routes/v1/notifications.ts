import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@wp/db';
import { loadUser, requireUser } from '../../middleware/auth.js';
import { noStore } from '../../middleware/cache.js';
import { validate } from '../../middleware/validate.js';

/** Notifications (task P5-09). Always user-scoped, never cached. */
export const notificationRouter: Router = Router();
/**
 * ⚠️ PATH-SCOPED DELIBERATELY. This router is mounted at '/' alongside the
 * others, and a router-level `.use` with NO path runs for every request that
 * reaches the router — not just the ones it handles. Unscoped, `requireUser`
 * here answered 401 to anonymous requests for the PUBLIC football endpoints
 * and turned every unknown route into a 401 instead of a 404.
 */
notificationRouter.use('/notifications', noStore, loadUser, requireUser);

notificationRouter.get(
  '/notifications',
  validate({
    query: z.object({
      unreadOnly: z.enum(['true', 'false']).optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }),
  }),
  async (req, res) => {
    const q = req.query as unknown as { unreadOnly?: string; limit: number };

    const [items, unread] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: req.user!.id, ...(q.unreadOnly === 'true' ? { readAt: null } : {}) },
        orderBy: { createdAt: 'desc' },
        take: q.limit,
      }),
      prisma.notification.count({ where: { userId: req.user!.id, readAt: null } }),
    ]);

    res.json({
      unread,
      notifications: items.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        linkPath: n.linkPath,
        readAt: n.readAt,
        createdAt: n.createdAt,
      })),
    });
  },
);

notificationRouter.post(
  '/notifications/read',
  validate({ body: z.object({ ids: z.array(z.string()).max(50).optional() }) }),
  async (req, res) => {
    const ids = (req.body as { ids?: string[] }).ids;

    const result = await prisma.notification.updateMany({
      // Scoped to the caller: an id from someone else's list must do nothing,
      // not mark their notification read.
      where: { userId: req.user!.id, readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },
      data: { readAt: new Date() },
    });

    res.json({ marked: result.count });
  },
);
