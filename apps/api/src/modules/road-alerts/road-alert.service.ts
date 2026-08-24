import {
  BookingStatus,
  NotificationType,
  RoadAlertStatus,
  TripStatus,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { paginated, toPagination } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import type { AuditContext } from '../admin/audit.service.js';
import { writeAuditLog } from '../admin/audit.service.js';
import { notifyUsers } from '../notifications/notification.service.js';
import type { createRoadAlertSchema, roadAlertQuerySchema, updateRoadAlertSchema } from './road-alert.schemas.js';

type RoadAlertQuery = z.infer<typeof roadAlertQuerySchema>;
type CreateRoadAlertInput = z.infer<typeof createRoadAlertSchema>;
type UpdateRoadAlertInput = z.infer<typeof updateRoadAlertSchema>;

const closedAlertStatuses: RoadAlertStatus[] = [
  RoadAlertStatus.RESOLVED,
  RoadAlertStatus.CANCELLED,
  RoadAlertStatus.EXPIRED,
];

const include = {
  routes: { include: { route: { select: { id: true, code: true, name: true } } }, orderBy: { route: { name: 'asc' as const } } },
  createdBy: { select: { id: true, name: true } },
} as const;

type AlertWithRelations = Prisma.RoadAlertGetPayload<{ include: typeof include }>;

const dto = (alert: AlertWithRelations) => {
  const routes = alert.routes.map(({ route }) => route);
  const now = new Date();
  const active =
    alert.status === RoadAlertStatus.ACTIVE &&
    alert.startsAt <= now &&
    (!alert.endsAt || alert.endsAt > now);
  return {
    ...alert,
    latitude: alert.latitude === null ? null : Number(alert.latitude),
    longitude: alert.longitude === null ? null : Number(alert.longitude),
    routeId: routes[0]?.id,
    route: routes[0],
    affectedRoutes: routes,
    location: alert.locationText,
    coordinates:
      alert.latitude === null || alert.longitude === null
        ? undefined
        : { latitude: Number(alert.latitude), longitude: Number(alert.longitude) },
    activeFrom: alert.startsAt,
    activeUntil: alert.endsAt,
    active,
  };
};

const validateRoutes = async (tx: Prisma.TransactionClient, routeIds: string[]): Promise<void> => {
  const count = await tx.route.count({ where: { id: { in: routeIds } } });
  if (count !== routeIds.length) throw new AppError(404, 'ROUTE_NOT_FOUND', 'One or more affected routes do not exist');
};

const affectedStudents = async (alert: AlertWithRelations): Promise<string[]> => {
  const routeIds = alert.routes.map(({ routeId }) => routeId);
  const now = new Date();
  const bookings = await prisma.booking.findMany({
    where: {
      status: {
        in: [
          BookingStatus.HELD,
          BookingStatus.PENDING_PAYMENT,
          BookingStatus.CONFIRMED,
          BookingStatus.CHECKED_IN,
        ],
      },
      trip: {
        routeId: { in: routeIds },
        status: { in: [TripStatus.SCHEDULED, TripStatus.BOARDING, TripStatus.IN_PROGRESS, TripStatus.DELAYED] },
        scheduledStartAt: {
          gte: new Date(Math.min(now.getTime(), alert.startsAt.getTime()) - 6 * 60 * 60_000),
          ...(alert.endsAt ? { lte: alert.endsAt } : {}),
        },
      },
    },
    select: { studentId: true },
    distinct: ['studentId'],
  });
  return bookings.map(({ studentId }) => studentId);
};

const sendAlertNotifications = async (alert: AlertWithRelations): Promise<void> => {
  if (alert.status !== RoadAlertStatus.ACTIVE) return;
  const userIds = await affectedStudents(alert);
  if (!userIds.length) return;
  await notifyUsers(userIds, {
    type: NotificationType.ROAD_ALERT,
    title: alert.title,
    body: alert.description,
    data: {
      roadAlertId: alert.id,
      routeIds: alert.routes.map(({ routeId }) => routeId),
      severity: alert.severity,
      category: alert.category,
      startsAt: alert.startsAt.toISOString(),
      endsAt: alert.endsAt?.toISOString() ?? null,
    },
    dedupePrefix: `road-alert:${alert.id}:${alert.updatedAt.getTime()}`,
  });
};

export const listRoadAlerts = async (rawQuery: RoadAlertQuery, admin = false) => {
  const pageSize = rawQuery.pageSize ?? rawQuery.limit ?? 20;
  const query = { ...rawQuery, pageSize };
  const now = new Date();
  const effectiveOnly = !admin || rawQuery.active === true;
  const where: Prisma.RoadAlertWhereInput = {
    ...(rawQuery.routeId ? { routes: { some: { routeId: rawQuery.routeId } } } : {}),
    ...(rawQuery.category ? { category: rawQuery.category } : {}),
    ...(rawQuery.severity ? { severity: rawQuery.severity } : {}),
    ...(rawQuery.status ? { status: rawQuery.status } : {}),
    ...(effectiveOnly
      ? {
          status: RoadAlertStatus.ACTIVE,
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        }
      : {}),
    ...(rawQuery.search
      ? {
          AND: [
            {
              OR: [
                { title: { contains: rawQuery.search, mode: 'insensitive' } },
                { description: { contains: rawQuery.search, mode: 'insensitive' } },
                { locationText: { contains: rawQuery.search, mode: 'insensitive' } },
                { routes: { some: { route: { name: { contains: rawQuery.search, mode: 'insensitive' } } } } },
              ],
            },
          ],
        }
      : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.roadAlert.findMany({ where, include, ...toPagination(query), orderBy: [{ severity: 'desc' }, { startsAt: 'desc' }] }),
    prisma.roadAlert.count({ where }),
  ]);
  const result = paginated(items.map(dto), total, query.page, pageSize);
  return { ...result, pagination: { ...result.pagination, totalPages: result.pagination.pages } };
};

export const getRoadAlert = async (id: string, admin = false) => {
  const alert = await prisma.roadAlert.findUnique({ where: { id }, include });
  if (!alert) throw new AppError(404, 'ROAD_ALERT_NOT_FOUND', 'Road alert not found');
  const value = dto(alert);
  if (!admin && !value.active) throw new AppError(404, 'ROAD_ALERT_NOT_FOUND', 'Road alert not found');
  return value;
};

export const createRoadAlert = async (input: CreateRoadAlertInput, context: AuditContext) => {
  const routeIds = [...new Set([...(input.routeIds ?? []), ...(input.routeId ? [input.routeId] : [])])];
  const created = await prisma.$transaction(async (tx) => {
    await validateRoutes(tx, routeIds);
    const alert = await tx.roadAlert.create({
      data: {
        createdById: context.actorId,
        category: input.category,
        severity: input.severity,
        status: input.status,
        title: input.title,
        description: input.description,
        locationText: input.locationText ?? input.location,
        latitude: input.latitude,
        longitude: input.longitude,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        resolvedAt: input.status === RoadAlertStatus.RESOLVED ? new Date() : undefined,
        routes: { create: routeIds.map((routeId) => ({ routeId })) },
      },
      include,
    });
    await writeAuditLog({ context, action: 'roadAlert.create', entityType: 'RoadAlert', entityId: alert.id, after: alert, client: tx });
    return alert;
  });
  if (input.notifyAffectedStudents) await sendAlertNotifications(created);
  return dto(created);
};

export const updateRoadAlert = async (id: string, input: UpdateRoadAlertInput, context: AuditContext) => {
  const updated = await prisma.$transaction(async (tx) => {
    const before = await tx.roadAlert.findUnique({ where: { id }, include });
    if (!before) throw new AppError(404, 'ROAD_ALERT_NOT_FOUND', 'Road alert not found');
    if (closedAlertStatuses.includes(before.status) && input.status === RoadAlertStatus.ACTIVE) {
      throw new AppError(409, 'ROAD_ALERT_TERMINAL', 'A closed road alert cannot be reactivated; create a new alert instead');
    }
    const routeIds = input.routeIds ?? (input.routeId ? [input.routeId] : undefined);
    if (routeIds) await validateRoutes(tx, routeIds);
    const startsAt = input.startsAt ?? before.startsAt;
    const endsAt = input.endsAt !== undefined ? input.endsAt : before.endsAt;
    if (endsAt && endsAt <= startsAt) throw new AppError(400, 'INVALID_ALERT_WINDOW', 'End time must be after start time');
    const status = input.status ?? before.status;
    const alert = await tx.roadAlert.update({
      where: { id },
      data: {
        category: input.category,
        severity: input.severity,
        status,
        title: input.title,
        description: input.description,
        locationText: input.locationText !== undefined ? input.locationText : input.location,
        latitude: input.latitude,
        longitude: input.longitude,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        resolvedAt: status === RoadAlertStatus.RESOLVED ? before.resolvedAt ?? new Date() : null,
        ...(routeIds
          ? {
              routes: {
                deleteMany: {},
                create: [...new Set(routeIds)].map((routeId) => ({ routeId })),
              },
            }
          : {}),
      },
      include,
    });
    await writeAuditLog({ context, action: 'roadAlert.update', entityType: 'RoadAlert', entityId: id, before, after: alert, client: tx });
    return alert;
  });
  if (input.notifyAffectedStudents) await sendAlertNotifications(updated);
  return dto(updated);
};

export const deleteRoadAlert = async (id: string, context: AuditContext): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    const before = await tx.roadAlert.findUnique({ where: { id }, include });
    if (!before) throw new AppError(404, 'ROAD_ALERT_NOT_FOUND', 'Road alert not found');
    if (before.status === RoadAlertStatus.ACTIVE) {
      throw new AppError(409, 'ROAD_ALERT_ACTIVE', 'Resolve or cancel an active alert before deleting it');
    }
    await tx.roadAlert.delete({ where: { id } });
    await writeAuditLog({ context, action: 'roadAlert.delete', entityType: 'RoadAlert', entityId: id, before, client: tx });
  });
};
