import { Role } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute } from '../../lib/async-route.js';
import { auditContext } from '../admin/audit.service.js';
import { optionalAuth, requireAuth, requireRole } from '../auth/auth.middleware.js';
import { createRoadAlertSchema, roadAlertQuerySchema, updateRoadAlertSchema } from './road-alert.schemas.js';
import { createRoadAlert, deleteRoadAlert, getRoadAlert, listRoadAlerts, updateRoadAlert } from './road-alert.service.js';

export const roadAlertRouter = Router();
roadAlertRouter.use(optionalAuth);

roadAlertRouter.get(
  '/',
  asyncRoute(async (request, response) => {
    response.json(await listRoadAlerts(roadAlertQuerySchema.parse(request.query), request.auth?.role === Role.ADMIN));
  }),
);
roadAlertRouter.get(
  '/:id',
  asyncRoute(async (request, response) => {
    response.json(await getRoadAlert(z.string().uuid().parse(request.params.id), request.auth?.role === Role.ADMIN));
  }),
);
roadAlertRouter.post(
  '/',
  requireAuth,
  requireRole(Role.ADMIN),
  asyncRoute(async (request, response) => {
    response.status(201).json(await createRoadAlert(createRoadAlertSchema.parse(request.body), auditContext(request)));
  }),
);
roadAlertRouter.patch(
  '/:id',
  requireAuth,
  requireRole(Role.ADMIN),
  asyncRoute(async (request, response) => {
    response.json(
      await updateRoadAlert(
        z.string().uuid().parse(request.params.id),
        updateRoadAlertSchema.parse(request.body),
        auditContext(request),
      ),
    );
  }),
);
roadAlertRouter.put(
  '/:id',
  requireAuth,
  requireRole(Role.ADMIN),
  asyncRoute(async (request, response) => {
    response.json(
      await updateRoadAlert(
        z.string().uuid().parse(request.params.id),
        updateRoadAlertSchema.parse(request.body),
        auditContext(request),
      ),
    );
  }),
);
roadAlertRouter.delete(
  '/:id',
  requireAuth,
  requireRole(Role.ADMIN),
  asyncRoute(async (request, response) => {
    await deleteRoadAlert(z.string().uuid().parse(request.params.id), auditContext(request));
    response.status(204).end();
  }),
);
