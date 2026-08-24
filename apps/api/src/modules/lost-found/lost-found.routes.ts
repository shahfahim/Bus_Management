import { Role } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute } from '../../lib/async-route.js';
import { auditContext } from '../admin/audit.service.js';
import { optionalAuth, requireAuth, requireRole } from '../auth/auth.middleware.js';
import {
  createClaimSchema,
  createLostFoundSchema,
  lostFoundQuerySchema,
  reviewClaimSchema,
  reviewMatchSchema,
  updateLostFoundSchema,
} from './lost-found.schemas.js';
import {
  createLostFound,
  createLostFoundClaim,
  deleteLostFound,
  getLostFound,
  listLostFound,
  listMyLostFound,
  reviewLostFoundClaim,
  reviewLostFoundMatch,
  updateLostFound,
} from './lost-found.service.js';
import {
  lostFoundUpload,
  persistLostFoundUploads,
  removeLostFoundUploads,
  sendLostFoundImage,
} from './lost-found.upload.js';

export const lostFoundRouter = Router();

lostFoundRouter.get('/images/:filename', sendLostFoundImage);
lostFoundRouter.get(
  '/mine',
  requireAuth,
  asyncRoute(async (request, response) => {
    response.json(await listMyLostFound(request.auth!.userId, lostFoundQuerySchema.parse(request.query)));
  }),
);
lostFoundRouter.get(
  '/',
  optionalAuth,
  asyncRoute(async (request, response) => {
    response.json(await listLostFound(lostFoundQuerySchema.parse(request.query), request.auth));
  }),
);
lostFoundRouter.get(
  '/:id',
  optionalAuth,
  asyncRoute(async (request, response) => {
    response.json(await getLostFound(z.string().uuid().parse(request.params.id), request.auth));
  }),
);
lostFoundRouter.post(
  '/',
  requireAuth,
  requireRole(Role.STUDENT, Role.ADMIN),
  lostFoundUpload,
  asyncRoute(async (request, response) => {
    const images = await persistLostFoundUploads(request);
    try {
      const input = createLostFoundSchema.parse(request.body);
      const context = request.auth!.role === Role.ADMIN ? auditContext(request) : undefined;
      response.status(201).json(await createLostFound(input, request.auth!, images, context));
    } catch (error: unknown) {
      await removeLostFoundUploads(images);
      throw error;
    }
  }),
);
lostFoundRouter.patch(
  '/:id',
  requireAuth,
  asyncRoute(async (request, response) => {
    const id = z.string().uuid().parse(request.params.id);
    response.json(
      await updateLostFound(
        id,
        updateLostFoundSchema.parse(request.body),
        request.auth!,
        request.auth!.role === Role.ADMIN ? auditContext(request) : undefined,
      ),
    );
  }),
);
lostFoundRouter.delete(
  '/:id',
  requireAuth,
  asyncRoute(async (request, response) => {
    await deleteLostFound(
      z.string().uuid().parse(request.params.id),
      request.auth!,
      request.auth!.role === Role.ADMIN ? auditContext(request) : undefined,
    );
    response.status(204).end();
  }),
);
lostFoundRouter.post(
  '/:id/claims',
  requireAuth,
  requireRole(Role.STUDENT),
  asyncRoute(async (request, response) => {
    response.status(201).json(
      await createLostFoundClaim(
        z.string().uuid().parse(request.params.id),
        request.auth!.userId,
        createClaimSchema.parse(request.body),
      ),
    );
  }),
);
lostFoundRouter.patch(
  '/claims/:claimId',
  requireAuth,
  requireRole(Role.ADMIN),
  asyncRoute(async (request, response) => {
    response.json(
      await reviewLostFoundClaim(
        z.string().uuid().parse(request.params.claimId),
        reviewClaimSchema.parse(request.body),
        auditContext(request),
      ),
    );
  }),
);
lostFoundRouter.patch(
  '/matches/:matchId',
  requireAuth,
  requireRole(Role.ADMIN),
  asyncRoute(async (request, response) => {
    response.json(
      await reviewLostFoundMatch(
        z.string().uuid().parse(request.params.matchId),
        reviewMatchSchema.parse(request.body),
        auditContext(request),
      ),
    );
  }),
);
