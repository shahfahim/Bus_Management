import {
  AssignmentStatus,
  BusStatus,
  DriverStatus,
  RouteStatus,
  UserStatus,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { lockBusSchedule } from '../../lib/bus-schedule-lock.js';
import { prisma } from '../../lib/prisma.js';
import type { AuditContext } from './audit.service.js';
import { writeAuditLog } from './audit.service.js';
import type {
  assignmentQuerySchema,
  createAssignmentSchema,
  updateAssignmentSchema,
} from './admin.schemas.js';

type AssignmentQuery = z.infer<typeof assignmentQuerySchema>;
type CreateAssignment = z.infer<typeof createAssignmentSchema>;
type UpdateAssignment = z.infer<typeof updateAssignmentSchema>;

const activeStatuses = [AssignmentStatus.SCHEDULED, AssignmentStatus.ACTIVE];
const include = {
  driver: { include: { user: { select: { id: true, name: true, email: true, status: true } } } },
  bus: { select: { id: true, fleetNumber: true, registrationNumber: true, status: true } },
  route: { select: { id: true, code: true, name: true, status: true } },
  _count: { select: { trips: true } },
} as const;

type AssignmentRecord = Prisma.DriverAssignmentGetPayload<{ include: typeof include }>;

const dto = (record: AssignmentRecord) => ({
  ...record,
  status: record.status.toLowerCase(),
  driver: {
    id: record.driverId,
    name: record.driver.user.name,
    email: record.driver.user.email,
  },
  bus: { ...record.bus, status: record.bus.status.toLowerCase() },
  route: { ...record.route, status: record.route.status.toLowerCase() },
  tripCount: record._count.trips,
});

const pageResult = <T>(items: T[], total: number, page: number, pageSize: number) => ({
  items,
  meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
});

export const listAdminAssignments = async (query: AssignmentQuery) => {
  const pageSize = query.pageSize ?? query.limit;
  const where: Prisma.DriverAssignmentWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.driverId ? { driverId: query.driverId } : {}),
    ...(query.busId ? { busId: query.busId } : {}),
    ...(query.search
      ? {
          OR: [
            { driver: { user: { name: { contains: query.search, mode: 'insensitive' } } } },
            { driver: { user: { email: { contains: query.search, mode: 'insensitive' } } } },
            { bus: { fleetNumber: { contains: query.search, mode: 'insensitive' } } },
            { route: { name: { contains: query.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.driverAssignment.findMany({
      where,
      include,
      orderBy: { startsAt: query.order },
      skip: (query.page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.driverAssignment.count({ where }),
  ]);
  return pageResult(items.map(dto), total, query.page, pageSize);
};

export const getAdminAssignment = async (id: string) => {
  const record = await prisma.driverAssignment.findUnique({ where: { id }, include });
  if (!record) throw new AppError(404, 'ASSIGNMENT_NOT_FOUND', 'Driver assignment not found');
  return dto(record);
};

const validateResources = async (
  tx: Prisma.TransactionClient,
  input: { driverId: string; busId: string; routeId: string; startsAt: Date; endsAt: Date | null },
  excludeId?: string,
) => {
  await lockBusSchedule(tx, input.busId);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'driver-schedule:' + input.driverId}))`;
  const overlap = {
    startsAt: { lt: input.endsAt ?? new Date('9999-12-31T23:59:59.999Z') },
    OR: [{ endsAt: null }, { endsAt: { gt: input.startsAt } }],
  };
  const [driver, bus, route, driverConflict, busConflict] = await Promise.all([
    tx.driverProfile.findUnique({ where: { userId: input.driverId }, include: { user: true } }),
    tx.bus.findUnique({ where: { id: input.busId } }),
    tx.route.findUnique({ where: { id: input.routeId } }),
    tx.driverAssignment.findFirst({
      where: { driverId: input.driverId, status: { in: activeStatuses }, id: excludeId ? { not: excludeId } : undefined, ...overlap },
    }),
    tx.driverAssignment.findFirst({
      where: { busId: input.busId, status: { in: activeStatuses }, id: excludeId ? { not: excludeId } : undefined, ...overlap },
    }),
  ]);
  if (!driver) throw new AppError(404, 'DRIVER_NOT_FOUND', 'Driver profile not found');
  if (driver.status !== DriverStatus.ACTIVE || driver.user.status !== UserStatus.ACTIVE) {
    throw new AppError(409, 'DRIVER_UNAVAILABLE', 'Verify and activate the driver before assigning a bus');
  }
  if (driver.licenseExpiresAt < input.startsAt) throw new AppError(409, 'DRIVER_LICENSE_EXPIRED', 'Driver license expires before this assignment');
  if (!bus) throw new AppError(404, 'BUS_NOT_FOUND', 'Bus not found');
  if (bus.status !== BusStatus.ACTIVE) throw new AppError(409, 'BUS_UNAVAILABLE', 'Only an active bus can be assigned');
  if (!route) throw new AppError(404, 'ROUTE_NOT_FOUND', 'Route not found');
  if (route.status !== RouteStatus.ACTIVE) throw new AppError(409, 'ROUTE_UNAVAILABLE', 'Only an active route can be assigned');
  if (driverConflict) throw new AppError(409, 'DRIVER_ASSIGNMENT_CONFLICT', 'Driver already has an overlapping assignment');
  if (busConflict) throw new AppError(409, 'BUS_ASSIGNMENT_CONFLICT', 'Bus already has an overlapping assignment');
};

export const createAdminAssignment = async (input: CreateAssignment, context: AuditContext) =>
  prisma.$transaction(async (tx) => {
    const endsAt = input.endsAt ?? null;
    await validateResources(tx, { ...input, endsAt });
    const record = await tx.driverAssignment.create({
      data: { ...input, endsAt, createdById: context.actorId },
      include,
    });
    await writeAuditLog({ context, action: 'driver_assignment.created', entityType: 'DriverAssignment', entityId: record.id, after: record, client: tx });
    return dto(record);
  });

export const updateAdminAssignment = async (id: string, input: UpdateAssignment, context: AuditContext) =>
  prisma.$transaction(async (tx) => {
    const before = await tx.driverAssignment.findUnique({ where: { id }, include });
    if (!before) throw new AppError(404, 'ASSIGNMENT_NOT_FOUND', 'Driver assignment not found');
    const next = {
      driverId: input.driverId ?? before.driverId,
      busId: input.busId ?? before.busId,
      routeId: input.routeId ?? before.routeId,
      startsAt: input.startsAt ?? before.startsAt,
      endsAt: input.endsAt === undefined ? before.endsAt : input.endsAt,
    };
    if (next.endsAt && next.endsAt <= next.startsAt) throw new AppError(400, 'INVALID_ASSIGNMENT_WINDOW', 'Assignment end must be after its start');
    if ((input.status ?? before.status) !== AssignmentStatus.CANCELLED && (input.status ?? before.status) !== AssignmentStatus.COMPLETED) {
      await validateResources(tx, next, id);
    }
    const record = await tx.driverAssignment.update({ where: { id }, data: input, include });
    await writeAuditLog({ context, action: 'driver_assignment.updated', entityType: 'DriverAssignment', entityId: id, before, after: record, client: tx });
    return dto(record);
  });

export const deleteAdminAssignment = async (id: string, context: AuditContext) =>
  prisma.$transaction(async (tx) => {
    const before = await tx.driverAssignment.findUnique({ where: { id }, include });
    if (!before) throw new AppError(404, 'ASSIGNMENT_NOT_FOUND', 'Driver assignment not found');
    if (before._count.trips > 0) throw new AppError(409, 'ASSIGNMENT_HAS_TRIPS', 'An assignment with trips cannot be deleted; cancel it instead');
    await tx.driverAssignment.delete({ where: { id } });
    await writeAuditLog({ context, action: 'driver_assignment.deleted', entityType: 'DriverAssignment', entityId: id, before, client: tx });
  });
