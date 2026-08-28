import { Role } from '@prisma/client';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../../lib/errors.js';

const mocks = vi.hoisted(() => ({
  findSubscription: vi.fn(),
  upsertSubscription: vi.fn(),
  findNotification: vi.fn(),
  updateNotification: vi.fn(),
  emitToUser: vi.fn(),
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    pushSubscription: {
      findUnique: mocks.findSubscription,
      upsert: mocks.upsertSubscription,
    },
    notification: {
      findFirst: mocks.findNotification,
      update: mocks.updateNotification,
    },
  },
}));

vi.mock('../auth/auth.middleware.js', () => ({
  requireAuth: (request: express.Request, _response: express.Response, next: express.NextFunction) => {
    request.auth = { userId: 'current-user', role: Role.STUDENT, sessionId: 'session-1' };
    next();
  },
}));

vi.mock('../../realtime/hub.js', () => ({ emitToUser: mocks.emitToUser }));

import { notificationRouter } from './notification.routes.js';

const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/notifications', notificationRouter);
  app.use(errorHandler);
  return app;
};

describe('notification routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses to reassign another account\'s push endpoint', async () => {
    mocks.findSubscription.mockResolvedValue({ userId: 'different-user' });

    const response = await request(createTestApp())
      .post('/notifications/push/subscriptions')
      .send({
        endpoint: 'https://push.example/subscription/unguessable-token',
        keys: { p256dh: 'p'.repeat(32), auth: 'a'.repeat(16) },
      })
      .expect(409);

    const body = response.body as unknown as { error: { code: string } };
    expect(body.error.code).toBe('PUSH_SUBSCRIPTION_OWNED');
    expect(mocks.upsertSubscription).not.toHaveBeenCalled();
  });

  it('broadcasts an exact unread-count change when one notification is read', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    const notification = {
      id,
      userId: 'current-user',
      title: 'Trip update',
      body: 'Your bus is boarding.',
      readAt: null,
      createdAt: new Date(),
    };
    mocks.findNotification.mockResolvedValue(notification);
    mocks.updateNotification.mockResolvedValue({ ...notification, readAt: new Date() });

    await request(createTestApp()).patch(`/notifications/${id}/read`).send({}).expect(200);

    expect(mocks.emitToUser).toHaveBeenCalledWith('current-user', 'notifications:read', { all: false, updated: 1 });
  });
});
