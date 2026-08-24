import { Role } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute } from '../../lib/async-route.js';
import { optionalAuth, requireAuth, requireRole } from '../auth/auth.middleware.js';
import { auditContext } from '../admin/audit.service.js';
import { createMaintenanceSchema, maintenanceQuerySchema, updateMaintenanceSchema } from './maintenance.schemas.js';
import {
  createMaintenance,
  deleteMaintenance,
  getMaintenance,
  listMaintenance,
  updateMaintenance,
} from './maintenance.service.js';

export const maintenanceRouter = Router();
maintenanceRouter.use(optionalAuth);

maintenanceRouter.get(
  '/',
  asyncRoute(async (request, response) => {
    const query = maintenanceQuerySchema.parse(request.query);
    response.json(await listMaintenance(query, request.auth?.role === Role.ADMIN));
  }),
);
maintenanceRouter.get(
  '/:id',
  asyncRoute(async (request, response) => response.json(await getMaintenance(z.string().uuid().parse(request.params.id)))),
);
maintenanceRouter.post(
  '/',
  requireAuth,
  requireRole(Role.ADMIN),
  asyncRoute(async (request, response) => {
    response.status(201).json(await createMaintenance(createMaintenanceSchema.parse(request.body), auditContext(request)));
  }),
);
maintenanceRouter.patch(
  '/:id',
  requireAuth,
  requireRole(Role.ADMIN),
  asyncRoute(async (request, response) => {
    response.json(
      await updateMaintenance(
        z.string().uuid().parse(request.params.id),
        updateMaintenanceSchema.parse(request.body),
        auditContext(request),
      ),
    );
  }),
);
maintenanceRouter.put(
  '/:id',
  requireAuth,
  requireRole(Role.ADMIN),
  asyncRoute(async (request, response) => {
    response.json(
      await updateMaintenance(
        z.string().uuid().parse(request.params.id),
        updateMaintenanceSchema.parse(request.body),
        auditContext(request),
      ),
    );
  }),
);
maintenanceRouter.delete(
  '/:id',
  requireAuth,
  requireRole(Role.ADMIN),
  asyncRoute(async (request, response) => {
    await deleteMaintenance(z.string().uuid().parse(request.params.id), auditContext(request));
    response.status(204).end();
  }),
);
