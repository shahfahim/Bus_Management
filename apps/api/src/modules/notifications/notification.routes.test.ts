import { Role } from '@prisma/client';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../../lib/errors.js';

const mocks = vi.hoisted(() => ({
  findSubscription: vi.fn(),
  upsertSubscription: vi.fn(),
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    pushSubscription: {
      findUnique: mocks.findSubscription,
      upsert: mocks.upsertSubscription,
    },
  },
}));

vi.mock('../auth/auth.middleware.js', () => ({
  requireAuth: (request: express.Request, _response: express.Response, next: express.NextFunction) => {
    request.auth = { userId: 'current-user', role: Role.STUDENT, sessionId: 'session-1' };
    next();
  },
}));

vi.mock('../../realtime/hub.js', () => ({ emitToUser: vi.fn() }));

import { notificationRouter } from './notification.routes.js';

const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/notifications', notificationRouter);
  app.use(errorHandler);
  return app;
};

describe('push subscription ownership', () => {
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
});
