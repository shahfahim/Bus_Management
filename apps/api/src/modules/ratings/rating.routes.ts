import { Role } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute } from '../../lib/async-route.js';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';
import { createRatingSchema, ratingQuerySchema, updateRatingSchema } from './rating.schemas.js';
import {
  createRating,
  deleteOwnRating,
  getDriverRatingSummary,
  listRatings,
  updateOwnRating,
} from './rating.service.js';

export const ratingRouter = Router();

ratingRouter.use(requireAuth);
ratingRouter.get(
  '/mine',
  requireRole(Role.STUDENT, Role.TEACHER),
  asyncRoute(async (request, response) => {
    response.json(await listRatings(ratingQuerySchema.parse(request.query), { studentId: request.auth!.userId }));
  }),
);
ratingRouter.get(
  '/drivers/:driverId',
  asyncRoute(async (request, response) => {
    const driverId = z.string().uuid().parse(request.params.driverId);
    const query = ratingQuerySchema.parse({ ...request.query, driverId });
    response.json(await listRatings(query, { publicOnly: true }));
  }),
);
ratingRouter.get(
  '/drivers/:driverId/summary',
  asyncRoute(async (request, response) => {
    response.json(await getDriverRatingSummary(z.string().uuid().parse(request.params.driverId)));
  }),
);
ratingRouter.post(
  '/',
  requireRole(Role.STUDENT, Role.TEACHER),
  asyncRoute(async (request, response) => {
    response.status(201).json(await createRating(request.auth!.userId, createRatingSchema.parse(request.body)));
  }),
);
ratingRouter.patch(
  '/:id',
  requireRole(Role.STUDENT, Role.TEACHER),
  asyncRoute(async (request, response) => {
    response.json(
      await updateOwnRating(
        z.string().uuid().parse(request.params.id),
        request.auth!.userId,
        updateRatingSchema.parse(request.body),
      ),
    );
  }),
);
ratingRouter.delete(
  '/:id',
  requireRole(Role.STUDENT, Role.TEACHER),
  asyncRoute(async (request, response) => {
    await deleteOwnRating(z.string().uuid().parse(request.params.id), request.auth!.userId);
    response.status(204).end();
  }),
);
