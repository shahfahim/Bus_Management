import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { asyncRoute } from '../../lib/async-route.js';
import { paginated, toPagination } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import { emitToUser } from '../../realtime/hub.js';
import { requireAuth } from '../auth/auth.middleware.js';

export const notificationRouter = Router();
notificationRouter.use(requireAuth);

notificationRouter.get(
  '/',
  asyncRoute(async (request, response) => {
    const query = z
      .object({
        page: z.coerce.number().int().positive().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
        unreadOnly: z.enum(['true', 'false']).transform((value) => value === 'true').default('false'),
        read: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
      })
      .parse(request.query);
    const where = {
      userId: request.auth!.userId,
      ...(query.read === true ? { readAt: { not: null } } : query.read === false || query.unreadOnly ? { readAt: null } : {}),
    };
    const [items, total, unread] = await prisma.$transaction([
      prisma.notification.findMany({ where, ...toPagination(query), orderBy: { createdAt: 'desc' } }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId: request.auth!.userId, readAt: null } }),
    ]);
    response.json({
      ...paginated(
        items.map((item) => ({ ...item, message: item.body })),
        total,
        query.page,
        query.pageSize,
      ),
      unread,
    });
  }),
);

notificationRouter.get(
  '/unread-count',
  asyncRoute(async (request, response) => {
    response.json({ unread: await prisma.notification.count({ where: { userId: request.auth!.userId, readAt: null } }) });
  }),
);

notificationRouter.patch(
  '/:id/read',
  asyncRoute(async (request, response) => {
    const id = z.string().uuid().parse(request.params.id);
    const notification = await prisma.notification.findFirst({
      where: { id, userId: request.auth!.userId },
    });
    if (!notification) {
      response.status(404).json({ error: { code: 'NOTIFICATION_NOT_FOUND', message: 'Notification not found' } });
      return;
    }
    const updated = notification.readAt
      ? notification
      : await prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
    response.json({ ...updated, message: updated.body });
  }),
);

notificationRouter.post(
  '/read-all',
  asyncRoute(async (request, response) => {
    const result = await prisma.notification.updateMany({
      where: { userId: request.auth!.userId, readAt: null },
      data: { readAt: new Date() },
    });
    emitToUser(request.auth!.userId, 'notifications:read', { all: true, updated: result.count });
    response.json({ updated: result.count });
  }),
);

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(4_096),
  keys: z.object({ p256dh: z.string().min(20).max(1_024), auth: z.string().min(10).max(512) }),
  deviceName: z.string().trim().max(128).optional(),
});

notificationRouter.get('/push/public-key', (_request, response) => response.json({ publicKey: envPublicKey() }));
notificationRouter.get('/push-config', (_request, response) => response.json({ vapidPublicKey: envPublicKey() }));

const savePushSubscription = asyncRoute(async (request, response) => {
    const input = subscriptionSchema.parse(request.body);
    const subscription = await prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: {
        userId: request.auth!.userId,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        deviceName: input.deviceName,
        userAgent: request.get('user-agent'),
      },
      update: {
        userId: request.auth!.userId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        deviceName: input.deviceName,
        userAgent: request.get('user-agent'),
        revokedAt: null,
      },
    });
    response.status(201).json({ id: subscription.id });
  });

notificationRouter.post('/push/subscriptions', savePushSubscription);
notificationRouter.post('/push-subscriptions', savePushSubscription);

notificationRouter.delete(
  '/push/subscriptions',
  asyncRoute(async (request, response) => {
    const { endpoint } = z.object({ endpoint: z.string().url() }).parse(request.body);
    await prisma.pushSubscription.updateMany({
      where: { endpoint, userId: request.auth!.userId },
      data: { revokedAt: new Date() },
    });
    response.status(204).send();
  }),
);

const envPublicKey = () => env.VAPID_PUBLIC_KEY ?? null;
