import {
  IncidentStatus,
  NotificationType,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { notifyUser } from '../notifications/notification.service.js';
import type { incidentQuerySchema, updateIncidentSchema } from './admin.schemas.js';
import type { AuditContext } from './audit.service.js';
import { writeAuditLog } from './audit.service.js';

type IncidentQuery = z.infer<typeof incidentQuerySchema>;
type UpdateIncident = z.infer<typeof updateIncidentSchema>;

const incidentInclude = {
  driver: {
    include: { user: { select: { id: true, name: true, email: true, phone: true } } },
  },
  trip: {
    select: {
      id: true,
      publicCode: true,
      status: true,
      route: { select: { id: true, code: true, name: true } },
      bus: { select: { id: true, fleetNumber: true, registrationNumber: true } },
    },
  },
  resolvedBy: { select: { id: true, name: true, email: true } },
  attachments: true,
} as const;

type IncidentRecord = Prisma.DriverIncidentGetPayload<{ include: typeof incidentInclude }>;

const incidentDto = (incident: IncidentRecord) => ({
  ...incident,
  category: incident.category.toLowerCase(),
  severity: incident.severity.toLowerCase(),
  status: incident.status.toLowerCase(),
  latitude: incident.latitude === null ? null : Number(incident.latitude),
  longitude: incident.longitude === null ? null : Number(incident.longitude),
  driver: {
    id: incident.driver.userId,
    employeeNumber: incident.driver.employeeNumber,
    name: incident.driver.user.name,
    email: incident.driver.user.email,
    phone: incident.driver.user.phone,
  },
});

const pageResult = <T>(items: T[], total: number, page: number, pageSize: number) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    items,
    pagination: { page, pageSize, total, pages: totalPages, totalPages },
    meta: { page, pageSize, total, totalPages },
  };
};

export const listAdminIncidents = async (query: IncidentQuery) => {
  const pageSize = query.pageSize ?? query.limit;
  const where: Prisma.DriverIncidentWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.severity ? { severity: query.severity } : {}),
    ...(query.category ? { category: query.category } : {}),
    ...(query.driverId ? { driverId: query.driverId } : {}),
    ...(query.tripId ? { tripId: query.tripId } : {}),
    ...(query.search
      ? {
          OR: [
            { incidentNumber: { contains: query.search, mode: 'insensitive' } },
            { title: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
            { driver: { user: { name: { contains: query.search, mode: 'insensitive' } } } },
            { trip: { publicCode: { contains: query.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
  const sortMap: Record<string, Prisma.DriverIncidentOrderByWithRelationInput> = {
    incidentNumber: { incidentNumber: query.order },
    occurredAt: { occurredAt: query.order },
    status: { status: query.order },
    severity: { severity: query.order },
    category: { category: query.order },
  };
  const orderBy = (query.sort ? sortMap[query.sort] : undefined) ?? { occurredAt: 'desc' as const };
  const [items, total] = await prisma.$transaction([
    prisma.driverIncident.findMany({
      where,
      include: incidentInclude,
      skip: (query.page - 1) * pageSize,
      take: pageSize,
      orderBy,
    }),
    prisma.driverIncident.count({ where }),
  ]);
  return pageResult(items.map(incidentDto), total, query.page, pageSize);
};

export const getAdminIncident = async (id: string) => {
  const incident = await prisma.driverIncident.findUnique({ where: { id }, include: incidentInclude });
  if (!incident) throw new AppError(404, 'INCIDENT_NOT_FOUND', 'Incident not found');
  return incidentDto(incident);
};

const allowedTransitions: Record<IncidentStatus, IncidentStatus[]> = {
  OPEN: [IncidentStatus.ACKNOWLEDGED, IncidentStatus.RESOLVED, IncidentStatus.DISMISSED],
  ACKNOWLEDGED: [IncidentStatus.RESOLVED, IncidentStatus.DISMISSED],
  RESOLVED: [],
  DISMISSED: [],
};

export const updateAdminIncident = async (id: string, input: UpdateIncident, context: AuditContext) => {
  const updated = await prisma.$transaction(async (tx) => {
    const current = await tx.driverIncident.findUnique({ where: { id }, include: incidentInclude });
    if (!current) throw new AppError(404, 'INCIDENT_NOT_FOUND', 'Incident not found');
    if (!allowedTransitions[current.status].includes(input.status)) {
      throw new AppError(
        409,
        'INVALID_INCIDENT_TRANSITION',
        `Incident cannot move from ${current.status.toLowerCase()} to ${input.status.toLowerCase()}`,
      );
    }
    const now = new Date();
    const result = await tx.driverIncident.updateMany({
      where: { id, status: current.status },
      data: {
        status: input.status,
        ...(input.status === IncidentStatus.ACKNOWLEDGED ? { acknowledgedAt: now } : {}),
        ...(input.status === IncidentStatus.RESOLVED || input.status === IncidentStatus.DISMISSED
          ? {
              acknowledgedAt: current.acknowledgedAt ?? now,
              resolvedAt: now,
              resolvedById: context.actorId,
              resolutionNotes: input.resolutionNotes,
            }
          : {}),
      },
    });
    if (result.count !== 1) {
      throw new AppError(409, 'INCIDENT_CHANGED', 'The incident was updated by another administrator; reload and try again');
    }
    const next = await tx.driverIncident.findUniqueOrThrow({ where: { id }, include: incidentInclude });
    await writeAuditLog({
      context,
      action: `incident.${input.status.toLowerCase()}`,
      entityType: 'DriverIncident',
      entityId: id,
      before: { status: current.status, resolutionNotes: current.resolutionNotes },
      after: { status: next.status, resolutionNotes: next.resolutionNotes },
      client: tx,
    });
    return next;
  });

  await notifyUser({
    userId: updated.driverId,
    type: NotificationType.SYSTEM,
    title: `Incident ${updated.status.toLowerCase()}`,
    body:
      updated.status === IncidentStatus.ACKNOWLEDGED
        ? `Your incident ${updated.incidentNumber} has been acknowledged by operations.`
        : `Your incident ${updated.incidentNumber} was ${updated.status.toLowerCase()}. ${updated.resolutionNotes ?? ''}`.trim(),
    data: { incidentId: updated.id, status: updated.status },
    dedupeKey: `incident-status:${updated.id}:${updated.status}`,
  });
  return incidentDto(updated);
};
