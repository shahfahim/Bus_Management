import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute } from '../../lib/async-route.js';
import { prisma } from '../../lib/prisma.js';
import { normalizeRequestId } from '../../lib/request-context.js';
import { requireAuth } from '../auth/auth.middleware.js';
import { getCurrentUser } from '../auth/auth.service.js';

export const userRouter = Router();
userRouter.use(requireAuth);

const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  phone: z.union([z.string().trim().min(7).max(32), z.literal(''), z.null()]).optional(),
  department: z.string().trim().min(2).max(160).optional(),
});

userRouter.patch(
  '/me',
  asyncRoute(async (request, response) => {
    const input = updateProfileSchema.parse(request.body);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: request.auth!.userId },
        data: { name: input.name, phone: input.phone || null },
      });
      if (request.auth!.role === 'STUDENT' && input.department) {
        await tx.studentProfile.update({ where: { userId: request.auth!.userId }, data: { department: input.department } });
      }
      await tx.auditLog.create({
        data: {
          actorId: request.auth!.userId,
          action: 'profile.update',
          entityType: 'User',
          entityId: request.auth!.userId,
          requestId: normalizeRequestId(request.id),
          ipAddress: request.ip,
          userAgent: request.get('user-agent'),
          after: input,
        },
      });
    });
    response.json(await getCurrentUser(request.auth!.userId));
  }),
);
