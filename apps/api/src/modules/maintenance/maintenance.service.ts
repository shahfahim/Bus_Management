import {
  BookingStatus,
  BusStatus,
  MaintenanceStatus,
  NotificationType,
  TripStatus,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { lockBusSchedule } from '../../lib/bus-schedule-lock.js';
import { paginated, toPagination } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import { notifyUsers } from '../notifications/notification.service.js';
import type { AuditContext } from '../admin/audit.service.js';
import { writeAuditLog } from '../admin/audit.service.js';
import type {
  createMaintenanceSchema,
  maintenanceQuerySchema,
  updateMaintenanceSchema,
} from './maintenance.schemas.js';

type MaintenanceQuery = z.infer<typeof maintenanceQuerySchema>;
type CreateMaintenanceInput = z.infer<typeof createMaintenanceSchema>;
type UpdateMaintenanceInput = z.infer<typeof updateMaintenanceSchema>;

const include = {
  bus: { select: { id: true, fleetNumber: true, registrationNumber: true, status: true } },
  createdBy: { select: { id: true, name: true } },
} as const;

const dto = (record: Awaited<ReturnType<typeof prisma.maintenanceRecord.findUniqueOrThrow>>) => ({
  ...record,
  cost: record.cost === null ? null : Number(record.cost),
  reason: record.title,
  startedAt: record.startsAt,
  expectedAvailableAt: record.expectedReturnAt,
});

const allowedTransitions: Record<MaintenanceStatus, MaintenanceStatus[]> = {
  SCHEDULED: [MaintenanceStatus.IN_PROGRESS, MaintenanceStatus.COMPLETED, MaintenanceStatus.CANCELLED],
  IN_PROGRESS: [MaintenanceStatus.COMPLETED, MaintenanceStatus.CANCELLED],
  COMPLETED: [],
  CANCELLED: [],
};

const assertMaintenanceWindowAvailable = async (
  tx: Prisma.TransactionClient,
  input: { busId: string; startsAt: Date; expectedReturnAt: Date | null; excludeRecordId?: string },
) => {
  await lockBusSchedule(tx, input.busId);
  const [trip, maintenance] = await Promise.all([
    tx.trip.findFirst({
      where: {
        busId: input.busId,
        status: { in: [TripStatus.SCHEDULED, TripStatus.BOARDING, TripStatus.IN_PROGRESS, TripStatus.DELAYED] },
        ...(input.expectedReturnAt ? { scheduledStartAt: { lt: input.expectedReturnAt } } : {}),
        OR: [{ scheduledEndAt: null }, { scheduledEndAt: { gt: input.startsAt } }],
      },
      select: { id: true, publicCode: true },
    }),
    tx.maintenanceRecord.findFirst({
      where: {
        id: input.excludeRecordId ? { not: input.excludeRecordId } : undefined,
        busId: input.busId,
        status: { in: [MaintenanceStatus.SCHEDULED, MaintenanceStatus.IN_PROGRESS] },
        ...(input.expectedReturnAt ? { startsAt: { lt: input.expectedReturnAt } } : {}),
        OR: [{ expectedReturnAt: null }, { expectedReturnAt: { gt: input.startsAt } }],
      },
      select: { id: true, title: true },
    }),
  ]);
  if (trip) {
    throw new AppError(
      409,
      'MAINTENANCE_TRIP_CONFLICT',
      `Reassign or cancel trip ${trip.publicCode} before scheduling this maintenance window`,
    );
  }
  if (maintenance) {
    throw new AppError(409, 'MAINTENANCE_WINDOW_CONFLICT', `This window overlaps maintenance: ${maintenance.title}`);
  }
};

const notifyingStatuses: MaintenanceStatus[] = [MaintenanceStatus.SCHEDULED, MaintenanceStatus.IN_PROGRESS];

export const syncBusStatus = async (tx: Prisma.TransactionClient, busId: string): Promise<void> => {
  const now = new Date();
  const blocking = await tx.maintenanceRecord.count({
    where: {
      busId,
      OR: [
        { status: MaintenanceStatus.IN_PROGRESS },
        { status: MaintenanceStatus.SCHEDULED, startsAt: { lte: now } },
      ],
    },
  });
  const bus = await tx.bus.findUnique({
    where: { id: busId },
    select: { status: true, preMaintenanceStatus: true },
  });
  if (!bus || bus.status === BusStatus.RETIRED) return;
  if (blocking > 0 && bus.status !== BusStatus.UNDER_MAINTENANCE) {
    await tx.bus.update({
      where: { id: busId },
      data: { status: BusStatus.UNDER_MAINTENANCE, preMaintenanceStatus: bus.status },
    });
  } else if (blocking === 0 && bus.status === BusStatus.UNDER_MAINTENANCE) {
    const restored =
      bus.preMaintenanceStatus &&
      !([BusStatus.UNDER_MAINTENANCE, BusStatus.RETIRED] as BusStatus[]).includes(bus.preMaintenanceStatus)
        ? bus.preMaintenanceStatus
        : BusStatus.ACTIVE;
    await tx.bus.update({
      where: { id: busId },
      data: { status: restored, preMaintenanceStatus: null },
    });
  } else if (blocking === 0 && bus.preMaintenanceStatus) {
    await tx.bus.update({ where: { id: busId }, data: { preMaintenanceStatus: null } });
  }
};

export const reconcileMaintenanceStatuses = async (): Promise<{ started: number; buses: number }> => {
  const now = new Date();
  const due = await prisma.maintenanceRecord.findMany({
    where: { status: MaintenanceStatus.SCHEDULED, startsAt: { lte: now } },
    select: { id: true, busId: true },
    take: 250,
  });
  let started = 0;
  for (const record of due) {
    started += await prisma.$transaction(async (tx) => {
      await lockBusSchedule(tx, record.busId);
      const transition = await tx.maintenanceRecord.updateMany({
        where: { id: record.id, status: MaintenanceStatus.SCHEDULED, startsAt: { lte: now } },
        data: { status: MaintenanceStatus.IN_PROGRESS },
      });
      await syncBusStatus(tx, record.busId);
      return transition.count;
    });
  }
  const buses = await prisma.bus.findMany({
    where: {
      status: { not: BusStatus.RETIRED },
      OR: [
        { status: BusStatus.UNDER_MAINTENANCE },
        { maintenanceRecords: { some: { status: MaintenanceStatus.IN_PROGRESS } } },
      ],
    },
    select: { id: true },
  });
  for (const bus of buses) {
    await prisma.$transaction(async (tx) => {
      await lockBusSchedule(tx, bus.id);
      await syncBusStatus(tx, bus.id);
    });
  }
  return { started, buses: buses.length };
};

const affectedStudents = async (record: {
  busId: string;
  startsAt: Date;
  expectedReturnAt: Date | null;
}): Promise<string[]> => {
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
        busId: record.busId,
        status: { in: [TripStatus.SCHEDULED, TripStatus.BOARDING, TripStatus.IN_PROGRESS, TripStatus.DELAYED] },
        scheduledStartAt: {
          gte: record.startsAt,
          ...(record.expectedReturnAt ? { lte: record.expectedReturnAt } : {}),
        },
      },
    },
    select: { studentId: true },
    distinct: ['studentId'],
  });
  return bookings.map(({ studentId }) => studentId);
};

const notifyAffectedStudents = async (record: {
  id: string;
  busId: string;
  title: string;
  status: MaintenanceStatus;
  startsAt: Date;
  expectedReturnAt: Date | null;
  updatedAt: Date;
  bus: { fleetNumber: string };
}): Promise<void> => {
  if (!notifyingStatuses.includes(record.status)) return;
  const userIds = await affectedStudents(record);
  if (!userIds.length) return;
  await notifyUsers(userIds, {
    type: NotificationType.BUS_MAINTENANCE,
    title: `Bus ${record.bus.fleetNumber} maintenance`,
    body: `${record.title}. Expected availability: ${record.expectedReturnAt?.toLocaleString() ?? 'to be confirmed'}.`,
    data: {
      maintenanceId: record.id,
      busId: record.busId,
      startsAt: record.startsAt.toISOString(),
      expectedReturnAt: record.expectedReturnAt?.toISOString() ?? null,
    },
    dedupePrefix: `maintenance:${record.id}:${record.status}:${record.updatedAt.getTime()}`,
  });
};

export const listMaintenance = async (rawQuery: MaintenanceQuery, admin = false) => {
  const pageSize = rawQuery.pageSize ?? rawQuery.limit ?? 20;
  const query = { ...rawQuery, pageSize };
  const now = new Date();
  const where: Prisma.MaintenanceRecordWhereInput = {
    ...(rawQuery.busId ? { busId: rawQuery.busId } : {}),
    ...(rawQuery.status ? { status: rawQuery.status } : {}),
    ...(!admin || rawQuery.active
      ? {
          status: { in: [MaintenanceStatus.SCHEDULED, MaintenanceStatus.IN_PROGRESS] },
          OR: [{ expectedReturnAt: null }, { expectedReturnAt: { gt: now } }],
        }
      : {}),
    ...(rawQuery.search
      ? {
          OR: [
            { title: { contains: rawQuery.search, mode: 'insensitive' } },
            { description: { contains: rawQuery.search, mode: 'insensitive' } },
            { notes: { contains: rawQuery.search, mode: 'insensitive' } },
            { bus: { fleetNumber: { contains: rawQuery.search, mode: 'insensitive' } } },
            { bus: { registrationNumber: { contains: rawQuery.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.maintenanceRecord.findMany({ where, include, ...toPagination(query), orderBy: { startsAt: 'desc' } }),
    prisma.maintenanceRecord.count({ where }),
  ]);
  const result = paginated(items.map(dto), total, query.page, pageSize);
  return { ...result, pagination: { ...result.pagination, totalPages: result.pagination.pages } };
};

export const getMaintenance = async (id: string) => {
  const record = await prisma.maintenanceRecord.findUnique({ where: { id }, include });
  if (!record) throw new AppError(404, 'MAINTENANCE_NOT_FOUND', 'Maintenance record not found');
  return dto(record);
};

export const createMaintenance = async (
  input: CreateMaintenanceInput,
  context: AuditContext,
) => {
  const title = input.title ?? input.reason!;
  const expectedReturnAt = input.expectedReturnAt ?? input.expectedAvailableAt;
  const created = await prisma.$transaction(async (tx) => {
    await lockBusSchedule(tx, input.busId);
    const bus = await tx.bus.findUnique({ where: { id: input.busId } });
    if (!bus) throw new AppError(404, 'BUS_NOT_FOUND', 'Bus not found');
    if (bus.status === BusStatus.RETIRED) throw new AppError(409, 'BUS_RETIRED', 'A retired bus cannot be scheduled for maintenance');
    if (([MaintenanceStatus.SCHEDULED, MaintenanceStatus.IN_PROGRESS] as MaintenanceStatus[]).includes(input.status)) {
      await assertMaintenanceWindowAvailable(tx, {
        busId: input.busId,
        startsAt: input.startsAt,
        expectedReturnAt: expectedReturnAt ?? null,
      });
    }
    const record = await tx.maintenanceRecord.create({
      data: {
        busId: input.busId,
        createdById: context.actorId,
        type: input.type,
        status: input.status,
        title,
        description: input.description ?? title,
        startsAt: input.startsAt,
        expectedReturnAt,
        completedAt: input.status === MaintenanceStatus.COMPLETED ? new Date() : undefined,
        cost: input.cost,
        notes: input.notes,
      },
      include,
    });
    await syncBusStatus(tx, record.busId);
    await writeAuditLog({ context, action: 'maintenance.create', entityType: 'MaintenanceRecord', entityId: record.id, after: record, client: tx });
    return record;
  });
  await notifyAffectedStudents(created);
  return dto(created);
};

export const updateMaintenance = async (
  id: string,
  input: UpdateMaintenanceInput,
  context: AuditContext,
) => {
  const updated = await prisma.$transaction(async (tx) => {
    const before = await tx.maintenanceRecord.findUnique({ where: { id }, include });
    if (!before) throw new AppError(404, 'MAINTENANCE_NOT_FOUND', 'Maintenance record not found');
    await lockBusSchedule(tx, before.busId);
    if (input.status && input.status !== before.status && !allowedTransitions[before.status].includes(input.status)) {
      throw new AppError(409, 'INVALID_MAINTENANCE_TRANSITION', `Cannot change maintenance from ${before.status} to ${input.status}`);
    }
    const startsAt = input.startsAt ?? before.startsAt;
    const expectedReturnAt =
      input.expectedReturnAt !== undefined
        ? input.expectedReturnAt
        : input.expectedAvailableAt !== undefined
          ? input.expectedAvailableAt
          : before.expectedReturnAt;
    if (expectedReturnAt && expectedReturnAt <= startsAt) {
      throw new AppError(400, 'INVALID_MAINTENANCE_WINDOW', 'Expected return must be after the start time');
    }
    const status = input.status ?? before.status;
    if (([MaintenanceStatus.SCHEDULED, MaintenanceStatus.IN_PROGRESS] as MaintenanceStatus[]).includes(status)) {
      await assertMaintenanceWindowAvailable(tx, {
        busId: before.busId,
        startsAt,
        expectedReturnAt,
        excludeRecordId: before.id,
      });
    }
    const record = await tx.maintenanceRecord.update({
      where: { id },
      data: {
        type: input.type,
        status,
        title: input.title ?? input.reason,
        description: input.description,
        startsAt: input.startsAt,
        expectedReturnAt,
        completedAt: status === MaintenanceStatus.COMPLETED ? before.completedAt ?? new Date() : null,
        cost: input.cost,
        notes: input.notes,
      },
      include,
    });
    await syncBusStatus(tx, record.busId);
    await writeAuditLog({ context, action: 'maintenance.update', entityType: 'MaintenanceRecord', entityId: id, before, after: record, client: tx });
    return record;
  });
  await notifyAffectedStudents(updated);
  return dto(updated);
};

export const deleteMaintenance = async (id: string, context: AuditContext): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    const before = await tx.maintenanceRecord.findUnique({ where: { id } });
    if (!before) throw new AppError(404, 'MAINTENANCE_NOT_FOUND', 'Maintenance record not found');
    if (before.status === MaintenanceStatus.IN_PROGRESS) {
      throw new AppError(409, 'MAINTENANCE_IN_PROGRESS', 'Complete or cancel in-progress maintenance before deleting it');
    }
    await tx.maintenanceRecord.delete({ where: { id } });
    await syncBusStatus(tx, before.busId);
    await writeAuditLog({ context, action: 'maintenance.delete', entityType: 'MaintenanceRecord', entityId: id, before, client: tx });
  });
};
