import { Role } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute } from '../../lib/async-route.js';
import { AppError } from '../../lib/errors.js';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';
import {
  createLostFoundSchema,
  lostFoundQuerySchema,
  updateLostFoundSchema,
} from '../lost-found/lost-found.schemas.js';
import {
  createLostFound,
  deleteLostFound,
  getLostFound,
  listLostFound,
  updateLostFound,
} from '../lost-found/lost-found.service.js';
import {
  createMaintenanceSchema,
  maintenanceQuerySchema,
  updateMaintenanceSchema,
} from '../maintenance/maintenance.schemas.js';
import {
  createMaintenance,
  deleteMaintenance,
  getMaintenance,
  listMaintenance,
  updateMaintenance,
} from '../maintenance/maintenance.service.js';
import {
  createRoadAlertSchema,
  roadAlertQuerySchema,
  updateRoadAlertSchema,
} from '../road-alerts/road-alert.schemas.js';
import {
  createRoadAlert,
  deleteRoadAlert,
  getRoadAlert,
  listRoadAlerts,
  updateRoadAlert,
} from '../road-alerts/road-alert.service.js';
import {
  adminListQuerySchema,
  assignmentQuerySchema,
  bookingQuerySchema,
  busQuerySchema,
  cancellationSchema,
  checkInQuerySchema,
  createAdminBookingSchema,
  createAssignmentSchema,
  createAdminNotificationSchema,
  createBusSchema,
  createManualCheckInSchema,
  createRouteSchema,
  createStopSchema,
  createTripSchema,
  createUserSchema,
  idSchema,
  incidentQuerySchema,
  moderateAdminRatingSchema,
  notificationQuerySchema,
  overviewRangeSchema,
  paymentQuerySchema,
  ratingQuerySchema,
  refundSchema,
  reportsRangeSchema,
  routeQuerySchema,
  stopQuerySchema,
  tripQuerySchema,
  updateAdminBookingSchema,
  updateAssignmentSchema,
  updateIncidentSchema,
  updateBusSchema,
  updateRouteSchema,
  updateStopSchema,
  updateTripSchema,
  updateUserSchema,
  userQuerySchema,
  scheduleQuerySchema,
  createScheduleSchema,
  updateScheduleSchema,
} from './admin.schemas.js';
import * as Schemas from './admin.schemas.js';
import {
  createAdminAssignment,
  deleteAdminAssignment,
  getAdminAssignment,
  listAdminAssignments,
  updateAdminAssignment,
} from './assignment-admin.service.js';
import { getAdminOverview, getAdminReports } from './analytics.service.js';
import { auditContext } from './audit.service.js';
import {
  createAdminBus,
  createAdminRoute,
  createAdminStop,
  deleteAdminBus,
  deleteAdminRoute,
  deleteAdminStop,
  getAdminBus,
  getAdminRoute,
  getAdminStop,
  listAdminBuses,
  listAdminRoutes,
  listAdminStops,
  updateAdminBus,
  updateAdminRoute,
  updateAdminStop,
} from './catalog-admin.service.js';
import {
  createAdminNotification,
  getAdminNotification,
  getAdminPayment,
  listAdminNotifications,
  listAdminPayments,
  refundAdminPayment,
  resendAdminNotification,
} from './finance-comms-admin.service.js';
import {
  getAdminIncident,
  listAdminIncidents,
  updateAdminIncident,
} from './incident-admin.service.js';
import {
  cancelAdminBooking,
  createAdminBooking,
  createAdminUser,
  createManualAdminCheckIn,
  deleteAdminBooking,
  deleteAdminUser,
  getAdminBooking,
  getAdminCheckIn,
  getAdminUser,
  listAdminBookings,
  listAdminCheckIns,
  listAdminRatings,
  listAdminUsers,
  moderateAdminRating,
  revokeAdminCheckIn,
  updateAdminBooking,
  updateAdminUser,
} from './people-admin.service.js';
import { cancelBooking } from '../bookings/booking.service.js';
import {
  cancelAdminTrip,
  createAdminTrip,
  deleteAdminTrip,
  getAdminTrip,
  listAdminTrips,
  updateAdminTrip,
} from './trip-admin.service.js';
import {
  listSchedules,
  createSchedule,
  getSchedule,
  updateSchedule,
  deleteSchedule,
} from './schedule-admin.service.js';

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole(Role.ADMIN));

const normalizeEnum = (key: string, value: string): string => {
  const normalized = value.toUpperCase();
  if (key === 'result') {
    if (normalized === 'ACCEPTED') return 'valid';
    if (normalized === 'REJECTED_REVOKED') return 'revoked';
    if (normalized.startsWith('REJECTED_')) return 'rejected';
  }
  const aliases: Record<string, string> = {
    UNDER_MAINTENANCE: 'maintenance',
    PENDING_PAYMENT: 'pending',
    PENDING_VERIFICATION: 'pending',
    SUCCEEDED: 'success',
    DRAFT: 'scheduled',
    OPEN: 'verified',
    PREVENTIVE: 'scheduled',
    BREAKDOWN: 'emergency',
    MAJOR: 'severe',
  };
  return aliases[normalized] ?? normalized.toLowerCase();
};

const enumKeys = new Set([
  'status',
  'role',
  'type',
  'category',
  'severity',
  'result',
  'source',
  'trackingStatus',
  'channel',
]);

const adminPayload = (value: unknown, key = ''): unknown => {
  if (Array.isArray(value)) return value.map((child) => adminPayload(child, key));
  if (value instanceof Date || value === null || value === undefined) return value;
  if (typeof value === 'string') return enumKeys.has(key) ? normalizeEnum(key, value) : value;
  if (typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, adminPayload(child, childKey)]));
};

const maintenanceBody = (body: unknown, creating = false): unknown => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const record = body as Record<string, unknown>;
  const normalized = {
    ...record,
    type:
      typeof record.type === 'string' && record.type.trim().toLowerCase() === 'scheduled'
        ? 'preventive'
        : record.type,
  };
  return creating
    ? Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== null && value !== ''))
    : normalized;
};

const createBody = (body: unknown): unknown =>
  body && typeof body === 'object' && !Array.isArray(body)
    ? Object.fromEntries(Object.entries(body).filter(([, value]) => value !== null && value !== ''))
    : body;

const unsupported = (entity: string): never => {
  throw new AppError(
    405,
    `${entity.toUpperCase()}_MUTATION_UNSUPPORTED`,
    `${entity} records are immutable through this operation; use the documented lifecycle action instead`,
  );
};

adminRouter.get('/overview', asyncRoute(async (request, response) => {
  const range = overviewRangeSchema.parse(request.query.range);
  response.json(await getAdminOverview(range));
}));

adminRouter.get('/reports', asyncRoute(async (request, response) => {
  const range = reportsRangeSchema.parse(request.query.range);
  response.json(await getAdminReports(range));
}));

adminRouter.get('/buses', asyncRoute(async (request, response) => response.json(await listAdminBuses(busQuerySchema.parse(request.query)))));
adminRouter.get('/buses/:id', asyncRoute(async (request, response) => response.json(await getAdminBus(idSchema.parse(request.params.id)))));
adminRouter.post('/buses', asyncRoute(async (request, response) => response.status(201).json(await createAdminBus(createBusSchema.parse(request.body), auditContext(request)))));
adminRouter.patch('/buses/:id', asyncRoute(async (request, response) => response.json(await updateAdminBus(idSchema.parse(request.params.id), updateBusSchema.parse(request.body), auditContext(request)))));
adminRouter.put('/buses/:id', asyncRoute(async (request, response) => response.json(await updateAdminBus(idSchema.parse(request.params.id), updateBusSchema.parse(request.body), auditContext(request)))));
adminRouter.delete('/buses/:id', asyncRoute(async (request, response) => {
  await deleteAdminBus(idSchema.parse(request.params.id), auditContext(request));
  response.status(204).end();
}));

adminRouter.get('/routes', asyncRoute(async (request, response) => response.json(await listAdminRoutes(routeQuerySchema.parse(request.query)))));
adminRouter.get('/routes/:id', asyncRoute(async (request, response) => response.json(await getAdminRoute(idSchema.parse(request.params.id)))));
adminRouter.post('/routes', asyncRoute(async (request, response) => response.status(201).json(await createAdminRoute(createRouteSchema.parse(request.body), auditContext(request)))));
adminRouter.patch('/routes/:id', asyncRoute(async (request, response) => response.json(await updateAdminRoute(idSchema.parse(request.params.id), updateRouteSchema.parse(request.body), auditContext(request)))));
adminRouter.put('/routes/:id', asyncRoute(async (request, response) => response.json(await updateAdminRoute(idSchema.parse(request.params.id), updateRouteSchema.parse(request.body), auditContext(request)))));
adminRouter.delete('/routes/:id', asyncRoute(async (request, response) => {
  await deleteAdminRoute(idSchema.parse(request.params.id), auditContext(request));
  response.status(204).end();
}));

adminRouter.get('/stops', asyncRoute(async (request, response) => response.json(await listAdminStops(stopQuerySchema.parse(request.query)))));
adminRouter.get('/stops/:id', asyncRoute(async (request, response) => response.json(await getAdminStop(idSchema.parse(request.params.id)))));
adminRouter.post('/stops', asyncRoute(async (request, response) => response.status(201).json(await createAdminStop(createStopSchema.parse(request.body), auditContext(request)))));
adminRouter.patch('/stops/:id', asyncRoute(async (request, response) => response.json(await updateAdminStop(idSchema.parse(request.params.id), updateStopSchema.parse(request.body), auditContext(request)))));
adminRouter.put('/stops/:id', asyncRoute(async (request, response) => response.json(await updateAdminStop(idSchema.parse(request.params.id), updateStopSchema.parse(request.body), auditContext(request)))));
adminRouter.delete('/stops/:id', asyncRoute(async (request, response) => {
  await deleteAdminStop(idSchema.parse(request.params.id), auditContext(request));
  response.status(204).end();
}));

adminRouter.get('/trips', asyncRoute(async (request, response) => response.json(await listAdminTrips(tripQuerySchema.parse(request.query)))));
adminRouter.get('/trips/:id', asyncRoute(async (request, response) => response.json(await getAdminTrip(idSchema.parse(request.params.id)))));
adminRouter.post('/trips', asyncRoute(async (request, response) => response.status(201).json(await createAdminTrip(createTripSchema.parse(request.body), auditContext(request)))));
adminRouter.patch('/trips/:id', asyncRoute(async (request, response) => response.json(await updateAdminTrip(idSchema.parse(request.params.id), updateTripSchema.parse(request.body), auditContext(request)))));
adminRouter.put('/trips/:id', asyncRoute(async (request, response) => response.json(await updateAdminTrip(idSchema.parse(request.params.id), updateTripSchema.parse(request.body), auditContext(request)))));
adminRouter.post('/trips/:id/cancel', asyncRoute(async (request, response) => {
  const { reason } = cancellationSchema.parse(request.body ?? {});
  response.json(await cancelAdminTrip(idSchema.parse(request.params.id), reason, auditContext(request)));
}));
adminRouter.delete('/trips/:id', asyncRoute(async (request, response) => {
  await deleteAdminTrip(idSchema.parse(request.params.id), auditContext(request));
  response.status(204).end();
}));

adminRouter.get('/assignments', asyncRoute(async (request, response) => response.json(await listAdminAssignments(assignmentQuerySchema.parse(request.query)))));
adminRouter.get('/assignments/:id', asyncRoute(async (request, response) => response.json(await getAdminAssignment(idSchema.parse(request.params.id)))));
adminRouter.post('/assignments', asyncRoute(async (request, response) => response.status(201).json(await createAdminAssignment(createAssignmentSchema.parse(request.body), auditContext(request)))));
adminRouter.patch('/assignments/:id', asyncRoute(async (request, response) => response.json(await updateAdminAssignment(idSchema.parse(request.params.id), updateAssignmentSchema.parse(request.body), auditContext(request)))));
adminRouter.put('/assignments/:id', asyncRoute(async (request, response) => response.json(await updateAdminAssignment(idSchema.parse(request.params.id), updateAssignmentSchema.parse(request.body), auditContext(request)))));
adminRouter.delete('/assignments/:id', asyncRoute(async (request, response) => {
  await deleteAdminAssignment(idSchema.parse(request.params.id), auditContext(request));
  response.status(204).end();
}));

// Catalog: Trip Schedules
adminRouter.get(
  '/schedules',
  requireRole(Role.ADMIN),
  asyncRoute(async (request, response) => {
    response.json(await listSchedules(scheduleQuerySchema.parse(request.query)));
  }),
);

adminRouter.post(
  '/schedules',
  requireRole(Role.ADMIN),
  asyncRoute(async (request, response) => {
    response.status(201).json(await createSchedule(createScheduleSchema.parse(request.body)));
  }),
);

adminRouter.get(
  '/schedules/:id',
  requireRole(Role.ADMIN),
  asyncRoute(async (request, response) => {
    response.json(await getSchedule(idSchema.parse(request.params.id)));
  }),
);

adminRouter.patch(
  '/schedules/:id',
  requireRole(Role.ADMIN),
  asyncRoute(async (request, response) => {
    response.json(await updateSchedule(idSchema.parse(request.params.id), updateScheduleSchema.parse(request.body)));
  }),
);

adminRouter.delete(
  '/schedules/:id',
  requireRole(Role.ADMIN),
  asyncRoute(async (request, response) => {
    await deleteSchedule(idSchema.parse(request.params.id));
    response.status(204).send();
  }),
);


adminRouter.get('/users', asyncRoute(async (request, response) => response.json(await listAdminUsers(userQuerySchema.parse(request.query)))));
adminRouter.get('/users/:id', asyncRoute(async (request, response) => response.json(await getAdminUser(idSchema.parse(request.params.id)))));
adminRouter.post('/users', asyncRoute(async (request, response) => response.status(201).json(await createAdminUser(createUserSchema.parse(request.body), auditContext(request)))));
adminRouter.patch('/users/:id', asyncRoute(async (request, response) => response.json(await updateAdminUser(idSchema.parse(request.params.id), updateUserSchema.parse(request.body), auditContext(request)))));
adminRouter.put('/users/:id', asyncRoute(async (request, response) => response.json(await updateAdminUser(idSchema.parse(request.params.id), updateUserSchema.parse(request.body), auditContext(request)))));
adminRouter.delete('/users/:id', asyncRoute(async (request, response) => {
  await deleteAdminUser(idSchema.parse(request.params.id), auditContext(request));
  response.status(204).end();
}));

adminRouter.get('/bookings', asyncRoute(async (request, response) => response.json(await listAdminBookings(bookingQuerySchema.parse(request.query)))));
adminRouter.get('/bookings/:id', asyncRoute(async (request, response) => response.json(await getAdminBooking(idSchema.parse(request.params.id)))));
adminRouter.post('/bookings', asyncRoute(async (request, response) => response.status(201).json(await createAdminBooking(createAdminBookingSchema.parse(request.body), auditContext(request)))));
adminRouter.patch('/bookings/:id', asyncRoute(async (request, response) => response.json(await updateAdminBooking(idSchema.parse(request.params.id), updateAdminBookingSchema.parse(request.body), auditContext(request)))));
adminRouter.put('/bookings/:id', asyncRoute(async (request, response) => response.json(await updateAdminBooking(idSchema.parse(request.params.id), updateAdminBookingSchema.parse(request.body), auditContext(request)))));
adminRouter.post('/bookings/:id/cancel', asyncRoute(async (request, response) => {
  const { reason } = cancellationSchema.parse(request.body ?? {});
  response.json(await cancelAdminBooking(idSchema.parse(request.params.id), reason, auditContext(request)));
}));
adminRouter.delete('/bookings/:id', asyncRoute(async (request, response) => {
  await deleteAdminBooking(idSchema.parse(request.params.id), auditContext(request));
  response.status(204).end();
}));

adminRouter.get('/payments', asyncRoute(async (request, response) => response.json(await listAdminPayments(paymentQuerySchema.parse(request.query)))));
adminRouter.get('/payments/:id', asyncRoute(async (request, response) => response.json(await getAdminPayment(idSchema.parse(request.params.id)))));
adminRouter.post('/payments/:id/refund', asyncRoute(async (request, response) => response.json(await refundAdminPayment(idSchema.parse(request.params.id), refundSchema.parse(request.body).reason, auditContext(request)))));
adminRouter.post('/payments', asyncRoute(() => unsupported('payment')));
adminRouter.patch('/payments/:id', asyncRoute(() => unsupported('payment')));
adminRouter.delete('/payments/:id', asyncRoute(() => unsupported('payment')));

adminRouter.get('/checkins', asyncRoute(async (request, response) => response.json(await listAdminCheckIns(checkInQuerySchema.parse(request.query)))));
adminRouter.get('/checkins/:id', asyncRoute(async (request, response) => response.json(await getAdminCheckIn(idSchema.parse(request.params.id)))));
adminRouter.post('/checkins', asyncRoute(async (request, response) => response.status(201).json(await createManualAdminCheckIn(createManualCheckInSchema.parse(request.body), auditContext(request)))));
adminRouter.post('/checkins/:id/revoke', asyncRoute(async (request, response) => response.json(await revokeAdminCheckIn(idSchema.parse(request.params.id), auditContext(request)))));
adminRouter.patch('/checkins/:id', asyncRoute(() => unsupported('check-in')));
adminRouter.delete('/checkins/:id', asyncRoute(() => unsupported('check-in')));

adminRouter.get('/maintenance', asyncRoute(async (request, response) => response.json(adminPayload(await listMaintenance(maintenanceQuerySchema.parse(request.query), true)))));
adminRouter.get('/maintenance/:id', asyncRoute(async (request, response) => response.json(adminPayload(await getMaintenance(idSchema.parse(request.params.id), true)))));
adminRouter.post('/maintenance', asyncRoute(async (request, response) => response.status(201).json(adminPayload(await createMaintenance(createMaintenanceSchema.parse(maintenanceBody(request.body, true)), auditContext(request))))));
adminRouter.patch('/maintenance/:id', asyncRoute(async (request, response) => response.json(adminPayload(await updateMaintenance(idSchema.parse(request.params.id), updateMaintenanceSchema.parse(maintenanceBody(request.body)), auditContext(request))))));
adminRouter.put('/maintenance/:id', asyncRoute(async (request, response) => response.json(adminPayload(await updateMaintenance(idSchema.parse(request.params.id), updateMaintenanceSchema.parse(maintenanceBody(request.body)), auditContext(request))))));
adminRouter.delete('/maintenance/:id', asyncRoute(async (request, response) => {
  await deleteMaintenance(idSchema.parse(request.params.id), auditContext(request));
  response.status(204).end();
}));

adminRouter.get('/road-alerts', asyncRoute(async (request, response) => response.json(adminPayload(await listRoadAlerts(roadAlertQuerySchema.parse(request.query), true)))));
adminRouter.get('/road-alerts/:id', asyncRoute(async (request, response) => response.json(adminPayload(await getRoadAlert(idSchema.parse(request.params.id), true)))));
adminRouter.post('/road-alerts', asyncRoute(async (request, response) => response.status(201).json(adminPayload(await createRoadAlert(createRoadAlertSchema.parse(createBody(request.body)), auditContext(request))))));
adminRouter.patch('/road-alerts/:id', asyncRoute(async (request, response) => response.json(adminPayload(await updateRoadAlert(idSchema.parse(request.params.id), updateRoadAlertSchema.parse(request.body), auditContext(request))))));
adminRouter.put('/road-alerts/:id', asyncRoute(async (request, response) => response.json(adminPayload(await updateRoadAlert(idSchema.parse(request.params.id), updateRoadAlertSchema.parse(request.body), auditContext(request))))));
adminRouter.delete('/road-alerts/:id', asyncRoute(async (request, response) => {
  await deleteRoadAlert(idSchema.parse(request.params.id), auditContext(request));
  response.status(204).end();
}));

adminRouter.get('/lost-found', asyncRoute(async (request, response) => response.json(adminPayload(await listLostFound(lostFoundQuerySchema.parse(request.query), request.auth, true)))));
adminRouter.get('/lost-found/:id', asyncRoute(async (request, response) => response.json(adminPayload(await getLostFound(idSchema.parse(request.params.id), request.auth)))));
adminRouter.post('/lost-found', asyncRoute(async (request, response) => response.status(201).json(adminPayload(await createLostFound(createLostFoundSchema.parse(request.body), request.auth!, [], auditContext(request))))));
adminRouter.patch('/lost-found/:id', asyncRoute(async (request, response) => response.json(adminPayload(await updateLostFound(idSchema.parse(request.params.id), updateLostFoundSchema.parse(request.body), request.auth!, auditContext(request))))));
adminRouter.put('/lost-found/:id', asyncRoute(async (request, response) => response.json(adminPayload(await updateLostFound(idSchema.parse(request.params.id), updateLostFoundSchema.parse(request.body), request.auth!, auditContext(request))))));
adminRouter.delete('/lost-found/:id', asyncRoute(async (request, response) => {
  await deleteLostFound(idSchema.parse(request.params.id), request.auth!, auditContext(request));
  response.status(204).end();
}));

adminRouter.get('/incidents', asyncRoute(async (request, response) => response.json(await listAdminIncidents(incidentQuerySchema.parse(request.query)))));
adminRouter.get('/incidents/:id', asyncRoute(async (request, response) => response.json(await getAdminIncident(idSchema.parse(request.params.id)))));
adminRouter.patch('/incidents/:id', asyncRoute(async (request, response) => response.json(await updateAdminIncident(idSchema.parse(request.params.id), updateIncidentSchema.parse(request.body), auditContext(request)))));
adminRouter.put('/incidents/:id', asyncRoute(async (request, response) => response.json(await updateAdminIncident(idSchema.parse(request.params.id), updateIncidentSchema.parse(request.body), auditContext(request)))));

adminRouter.get('/ratings', asyncRoute(async (request, response) => response.json(await listAdminRatings(ratingQuerySchema.parse(request.query)))));
adminRouter.patch('/ratings/:id', asyncRoute(async (request, response) => response.json(await moderateAdminRating(idSchema.parse(request.params.id), moderateAdminRatingSchema.parse(request.body), auditContext(request)))));
adminRouter.put('/ratings/:id', asyncRoute(async (request, response) => response.json(await moderateAdminRating(idSchema.parse(request.params.id), moderateAdminRatingSchema.parse(request.body), auditContext(request)))));
adminRouter.delete('/ratings/:id', asyncRoute(() => unsupported('rating')));

adminRouter.get('/notifications', asyncRoute(async (request, response) => response.json(await listAdminNotifications(notificationQuerySchema.parse(request.query)))));
adminRouter.get('/notifications/:id', asyncRoute(async (request, response) => response.json(await getAdminNotification(idSchema.parse(request.params.id)))));
adminRouter.post('/notifications', asyncRoute(async (request, response) => response.status(201).json(await createAdminNotification(createAdminNotificationSchema.parse(request.body), auditContext(request)))));
adminRouter.post('/notifications/:id/resend', asyncRoute(async (request, response) => {
  const { failedOnly } = z.object({ failedOnly: z.boolean().default(true) }).parse(request.body ?? {});
  response.json(await resendAdminNotification(idSchema.parse(request.params.id), failedOnly, auditContext(request)));
}));
adminRouter.patch('/notifications/:id', asyncRoute(() => unsupported('notification')));
adminRouter.delete('/notifications/:id', asyncRoute(() => unsupported('notification')));

adminRouter.get('/audit-logs', asyncRoute(async (request, response) => {
  const query = adminListQuerySchema.parse(request.query);
  const pageSize = query.pageSize ?? query.limit;
  const where = query.search
    ? {
        OR: [
          { action: { contains: query.search, mode: 'insensitive' as const } },
          { entityType: { contains: query.search, mode: 'insensitive' as const } },
          { entityId: { contains: query.search, mode: 'insensitive' as const } },
        ],
      }
    : {};
  const { prisma } = await import('../../lib/prisma.js');
  const [items, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      include: { actor: { select: { id: true, name: true, email: true } } },
      skip: (query.page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.auditLog.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  response.json({
    items: items.map((item) => ({ ...item, id: item.id.toString() })),
    pagination: { page: query.page, pageSize, total, pages: totalPages, totalPages },
    meta: { page: query.page, pageSize, total, totalPages },
  });
}));
