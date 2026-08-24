import { Router } from 'express';
import { Role, SubscriptionStatus } from '@prisma/client';
import { z } from 'zod';
import { asyncRoute } from '../../lib/async-route.js';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';
import { listStudentSubscriptions } from './subscription.service.js';

export const subscriptionRouter = Router();
subscriptionRouter.use(requireAuth, requireRole(Role.STUDENT));

subscriptionRouter.get(
  '/',
  asyncRoute(async (request, response) => {
    const query = z.object({
      status: z.nativeEnum(SubscriptionStatus).optional(),
      routeId: z.string().uuid().optional(),
    }).parse(request.query);
    response.json(await listStudentSubscriptions(request.auth!.userId, query));
  }),
);
