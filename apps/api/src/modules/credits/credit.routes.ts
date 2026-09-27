import { Router } from 'express';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { asyncRoute } from '../../lib/async-route.js';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';
import { getStudentCredits } from './credit.service.js';

export const creditRouter = Router();
creditRouter.use(requireAuth, requireRole(Role.STUDENT));

// The student's credit balance and ledger, newest first.
creditRouter.get(
  '/',
  asyncRoute(async (request, response) => {
    const query = z
      .object({
        page: z.coerce.number().int().positive().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
      })
      .parse(request.query);
    response.json(await getStudentCredits(request.auth!.userId, query));
  }),
);
