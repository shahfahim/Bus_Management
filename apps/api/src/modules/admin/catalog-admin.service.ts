import type { Prisma} from '@prisma/client';
import { BusStatus, RouteStatus } from '@prisma/client';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { lockBusSchedule } from '../../lib/bus-schedule-lock.js';
import { prisma } from '../../lib/prisma.js';
import type { AuditContext } from './audit.service.js';
import { writeAuditLog } from './audit.service.js';
import type {
  busQuerySchema,
  createBusSchema,
  createRouteSchema,
  createStopSchema,
  routeQuerySchema,
  stopQuerySchema,
  updateBusSchema,
  updateRouteSchema,
  updateStopSchema,
} from './admin.schemas.js';

type BusQuery = z.infer<typeof busQuerySchema>;
type CreateBus = z.infer<typeof createBusSchema>;
type UpdateBus = z.infer<typeof updateBusSchema>;
type RouteQuery = z.infer<typeof routeQuerySchema>;
type CreateRoute = z.infer<typeof createRouteSchema>;
type UpdateRoute = z.infer<typeof updateRouteSchema>;
type StopQuery = z.infer<typeof stopQuerySchema>;
type CreateStop = z.infer<typeof createStopSchema>;
type UpdateStop = z.infer<typeof updateStopSchema>;

const paging = (query: { page: number; pageSize?: number; limit: number }) => {
  const pageSize = query.pageSize ?? query.limit;
  return { pageSize, skip: (query.page - 1) * pageSize, take: pageSize };
};

const pageResult = <T>(items: T[], total: number, page: number, pageSize: number) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    items,
    pagination: { page, pageSize, total, pages: totalPages, totalPages },
    meta: { page, pageSize, total, totalPages },
  };
};

const lower = (value: string): string => value.toLowerCase();

const busInclude = {
  trips: {
    where: { lastLocationAt: { not: null } },
    select: { lastLocationAt: true },
    orderBy: { lastLocationAt: 'desc' as const },
    take: 1,
  },
  _count: { select: { seats: true, trips: true, assignments: true, maintenanceRecords: true, checkIns: true } },
} as const;

type BusRecord = Prisma.BusGetPayload<{ include: typeof busInclude }>;

const busDto = (bus: BusRecord) => {
  const amenities =
    bus.amenities && typeof bus.amenities === 'object' && !Array.isArray(bus.amenities)
      ? (bus.amenities as Record<string, unknown>)
      : undefined;
  return {
    ...bus,
    status: lower(bus.status === BusStatus.UNDER_MAINTENANCE ? 'MAINTENANCE' : bus.status),
    gpsDeviceId: bus.trackingDeviceId,
    notes: typeof amenities?.notes === 'string' ? amenities.notes : null,
    lastLocationAt: bus.trips[0]?.lastLocationAt ?? null,
    seatCount: bus._count.seats,
  };
};

export const listAdminBuses = async (query: BusQuery) => {
  const { pageSize, skip, take } = paging(query);
  const where: Prisma.BusWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.search
      ? {
          OR: [
            { fleetNumber: { contains: query.search, mode: 'insensitive' } },
            { registrationNumber: { contains: query.search, mode: 'insensitive' } },
            { make: { contains: query.search, mode: 'insensitive' } },
            { model: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const sortMap: Record<string, Prisma.BusOrderByWithRelationInput> = {
    fleetNumber: { fleetNumber: query.order },
    registrationNumber: { registrationNumber: query.order },
    capacity: { capacity: query.order },
    status: { status: query.order },
  };
  const orderBy = (query.sort ? sortMap[query.sort] : undefined) ?? { fleetNumber: 'asc' as const };
  const [items, total] = await prisma.$transaction([
    prisma.bus.findMany({ where, include: busInclude, skip, take, orderBy }),
    prisma.bus.count({ where }),
  ]);
  return pageResult(items.map((item) => busDto(item)), total, query.page, pageSize);
};

export const getAdminBus = async (id: string) => {
  const bus = await prisma.bus.findUnique({ where: { id }, include: busInclude });
  if (!bus) throw new AppError(404, 'BUS_NOT_FOUND', 'Bus not found');
  return busDto(bus);
};

const notesJson = (notes: string | undefined): Prisma.InputJsonValue | undefined =>
  notes === undefined ? undefined : { notes };

export const createAdminBus = async (input: CreateBus, context: AuditContext) => {
  if (input.status === BusStatus.UNDER_MAINTENANCE) {
    throw new AppError(409, 'USE_MAINTENANCE_WORKFLOW', 'Create the bus first, then add a maintenance record');
  }
  const bus = await prisma.$transaction(async (tx) => {
    const created = await tx.bus.create({
      data: {
        fleetNumber: input.fleetNumber,
        registrationNumber: input.registrationNumber,
        make: input.make,
        model: input.model,
        modelYear: input.modelYear,
        capacity: input.capacity,
        status: input.status,
        trackingDeviceId: input.trackingDeviceId ?? input.gpsDeviceId,
        amenities: notesJson(input.notes),
        seats: {
          create: Array.from({ length: input.capacity }, (_, index) => ({
            seatNumber: String(index + 1),
            rowNumber: Math.floor(index / 4) + 1,
            columnLabel: String.fromCharCode(65 + (index % 4)),
          })),
        },
      },
      include: busInclude,
    });
    await writeAuditLog({
      context,
      action: 'bus.create',
      entityType: 'Bus',
      entityId: created.id,
      after: created,
      client: tx,
    });
    return created;
  });
  return busDto(bus);
};

export const updateAdminBus = async (id: string, input: UpdateBus, context: AuditContext) => {
  const result = await prisma.$transaction(async (tx) => {
    await lockBusSchedule(tx, id);
    const before = await tx.bus.findUnique({
      where: { id },
      include: { ...busInclude, seats: { include: { _count: { select: { allocations: true } } } } },
    });
    if (!before) throw new AppError(404, 'BUS_NOT_FOUND', 'Bus not found');
    if (before.status === BusStatus.RETIRED && input.status && input.status !== BusStatus.RETIRED) {
      throw new AppError(409, 'BUS_RETIRED', 'A retired bus cannot be returned to service');
    }
    if (
      input.status &&
      input.status !== before.status &&
      (input.status === BusStatus.UNDER_MAINTENANCE || before.status === BusStatus.UNDER_MAINTENANCE)
    ) {
      throw new AppError(
        409,
        'USE_MAINTENANCE_WORKFLOW',
        'Start, complete, or cancel the maintenance record from the Maintenance workspace',
      );
    }
    if (input.capacity !== undefined && input.capacity !== before.capacity) {
      if (input.capacity > before.capacity) {
        const existing = new Set(before.seats.map(({ seatNumber }) => seatNumber));
        const additions = [];
        for (let number = 1; additions.length < input.capacity - before.capacity; number += 1) {
          if (!existing.has(String(number))) {
            const index = number - 1;
            additions.push({
              busId: id,
              seatNumber: String(number),
              rowNumber: Math.floor(index / 4) + 1,
              columnLabel: String.fromCharCode(65 + (index % 4)),
            });
          }
        }
        await tx.busSeat.createMany({ data: additions });
      } else {
        const removeCount = before.capacity - input.capacity;
        const candidates = [...before.seats].sort((left, right) => {
          const leftNumber = Number(left.seatNumber);
          const rightNumber = Number(right.seatNumber);
          if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return rightNumber - leftNumber;
          return right.seatNumber.localeCompare(left.seatNumber, undefined, { numeric: true });
        });
        const removable = candidates.filter((seat) => seat._count.allocations === 0).slice(0, removeCount);
        if (removable.length !== removeCount) {
          throw new AppError(
            409,
            'BUS_CAPACITY_HAS_HISTORY',
            'Capacity cannot be reduced because the seats being removed have booking history',
          );
        }
        await tx.busSeat.deleteMany({ where: { id: { in: removable.map(({ id: seatId }) => seatId) } } });
      }
    }
    let amenities: Prisma.InputJsonValue | undefined;
    if (input.notes !== undefined) {
      const existing =
        before.amenities && typeof before.amenities === 'object' && !Array.isArray(before.amenities)
          ? (before.amenities as Record<string, unknown>)
          : {};
      amenities = { ...existing, notes: input.notes };
    }
    const updated = await tx.bus.update({
      where: { id },
      data: {
        fleetNumber: input.fleetNumber,
        registrationNumber: input.registrationNumber,
        make: input.make,
        model: input.model,
        modelYear: input.modelYear,
        capacity: input.capacity,
        status: input.status,
        trackingDeviceId: input.trackingDeviceId ?? input.gpsDeviceId,
        amenities,
        retiredAt: input.status === BusStatus.RETIRED ? before.retiredAt ?? new Date() : undefined,
      },
      include: busInclude,
    });
    await writeAuditLog({
      context,
      action: 'bus.update',
      entityType: 'Bus',
      entityId: id,
      before,
      after: updated,
      client: tx,
    });
    return updated;
  });
  return busDto(result);
};

export const deleteAdminBus = async (id: string, context: AuditContext): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    const before = await tx.bus.findUnique({ where: { id }, include: { _count: { select: { trips: true, assignments: true, maintenanceRecords: true, checkIns: true } } } });
    if (!before) throw new AppError(404, 'BUS_NOT_FOUND', 'Bus not found');
    if (Object.values(before._count).some((count) => count > 0)) {
      throw new AppError(409, 'BUS_HAS_HISTORY', 'A bus with trips, assignments, maintenance, or check-ins cannot be deleted; retire it instead');
    }
    await tx.bus.delete({ where: { id } });
    await writeAuditLog({ context, action: 'bus.delete', entityType: 'Bus', entityId: id, before, client: tx });
  });
};

const routeInclude = {
  stops: {
    include: { stop: true },
    orderBy: { sequence: 'asc' as const },
  },
  _count: { select: { trips: true, assignments: true, planRoutes: true, alertRoutes: true } },
} as const;

type RouteRecord = Prisma.RouteGetPayload<{ include: typeof routeInclude }>;

const routeDto = (route: RouteRecord, fallback?: { origin?: string; destination?: string }) => ({
  ...route,
  status: lower(route.status),
  distanceKm: route.distanceMeters === null ? null : route.distanceMeters / 1_000,
  origin: route.stops[0]?.stop.name ?? fallback?.origin ?? null,
  destination: route.stops.at(-1)?.stop.name ?? fallback?.destination ?? null,
  stopCount: route.stops.length,
});

export const listAdminRoutes = async (query: RouteQuery) => {
  const { pageSize, skip, take } = paging(query);
  const where: Prisma.RouteWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.search
      ? {
          OR: [
            { code: { contains: query.search, mode: 'insensitive' } },
            { name: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
            { stops: { some: { stop: { name: { contains: query.search, mode: 'insensitive' } } } } },
          ],
        }
      : {}),
  };
  const sortMap: Record<string, Prisma.RouteOrderByWithRelationInput> = {
    code: { code: query.order },
    name: { name: query.order },
    status: { status: query.order },
  };
  const orderBy = (query.sort ? sortMap[query.sort] : undefined) ?? { name: 'asc' as const };
  const [items, total] = await prisma.$transaction([
    prisma.route.findMany({ where, include: routeInclude, skip, take, orderBy }),
    prisma.route.count({ where }),
  ]);
  return pageResult(items.map((route) => routeDto(route)), total, query.page, pageSize);
};

export const getAdminRoute = async (id: string) => {
  const route = await prisma.route.findUnique({ where: { id }, include: routeInclude });
  if (!route) throw new AppError(404, 'ROUTE_NOT_FOUND', 'Route not found');
  return routeDto(route);
};

export const createAdminRoute = async (input: CreateRoute, context: AuditContext) => {
  const route = await prisma.$transaction(async (tx) => {
    const routeStopsToCreate = input.stopIds?.map((stopId, index) => ({
      stopId,
      sequence: index + 1,
    })) || [];

    const created = await tx.route.create({
      data: {
        code: input.code,
        name: input.name,
        description: input.description,
        distanceMeters: Math.round(input.distanceKm * 1_000),
        estimatedDurationMinutes: input.estimatedDurationMinutes,
        status: input.status,
        stops: {
          create: routeStopsToCreate
        }
      },
      include: routeInclude,
    });
    await writeAuditLog({
      context,
      action: 'route.create',
      entityType: 'Route',
      entityId: created.id,
      after: created,
      metadata: { requestedOrigin: input.origin, requestedDestination: input.destination },
      client: tx,
    });
    return created;
  });
  return routeDto(route, input);
};

export const updateAdminRoute = async (id: string, input: UpdateRoute, context: AuditContext) => {
  const route = await prisma.$transaction(async (tx) => {
    const before = await tx.route.findUnique({ where: { id }, include: routeInclude });
    if (!before) throw new AppError(404, 'ROUTE_NOT_FOUND', 'Route not found');
    if (input.status === RouteStatus.INACTIVE) {
      const activeTrips = await tx.trip.count({
        where: { routeId: id, status: { in: ['SCHEDULED', 'BOARDING', 'IN_PROGRESS', 'DELAYED'] } },
      });
      if (activeTrips > 0) throw new AppError(409, 'ROUTE_HAS_ACTIVE_TRIPS', 'Cancel or reassign active trips before deactivating this route');
    }
    const updated = await tx.route.update({
      where: { id },
      data: {
        code: input.code,
        name: input.name,
        description: input.description,
        distanceMeters: input.distanceKm === undefined ? undefined : Math.round(input.distanceKm * 1_000),
        estimatedDurationMinutes: input.estimatedDurationMinutes,
        status: input.status,
      },
      include: routeInclude,
    });
    await writeAuditLog({
      context,
      action: 'route.update',
      entityType: 'Route',
      entityId: id,
      before,
      after: updated,
      metadata: { requestedOrigin: input.origin, requestedDestination: input.destination },
      client: tx,
    });
    return updated;
  });
  return routeDto(route, {
    origin: input.origin ?? undefined,
    destination: input.destination ?? undefined,
  });
};

export const deleteAdminRoute = async (id: string, context: AuditContext): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    const before = await tx.route.findUnique({ where: { id }, include: routeInclude });
    if (!before) throw new AppError(404, 'ROUTE_NOT_FOUND', 'Route not found');
    if (Object.values(before._count).some((count) => count > 0)) {
      throw new AppError(409, 'ROUTE_IN_USE', 'A route with trips, assignments, plans, or alerts cannot be deleted; deactivate it instead');
    }
    await tx.route.delete({ where: { id } });
    await writeAuditLog({ context, action: 'route.delete', entityType: 'Route', entityId: id, before, client: tx });
  });
};

const routeStopInclude = {
  route: { select: { id: true, code: true, name: true, status: true } },
  stop: true,
  _count: { select: { tripStops: true } },
} as const;

type RouteStopRecord = Prisma.RouteStopGetPayload<{ include: typeof routeStopInclude }>;

const stopDto = (routeStop: RouteStopRecord) => ({
  id: routeStop.id,
  routeStopId: routeStop.id,
  stopId: routeStop.stopId,
  routeId: routeStop.routeId,
  route: { ...routeStop.route, status: lower(routeStop.route.status) },
  code: routeStop.stop.code,
  name: routeStop.stop.name,
  sequence: routeStop.sequence,
  latitude: Number(routeStop.stop.latitude),
  longitude: Number(routeStop.stop.longitude),
  status: routeStop.stop.isActive ? 'active' : 'inactive',
  landmark: routeStop.stop.address,
  createdAt: routeStop.createdAt,
  updatedAt: routeStop.updatedAt > routeStop.stop.updatedAt ? routeStop.updatedAt : routeStop.stop.updatedAt,
});

export const listAdminStops = async (query: StopQuery) => {
  const { pageSize, skip, take } = paging(query);
  const where: Prisma.RouteStopWhereInput = {
    ...(query.routeId ? { routeId: query.routeId } : {}),
    ...(query.status ? { stop: { isActive: query.status === 'active' } } : {}),
    ...(query.search
      ? {
          OR: [
            { stop: { code: { contains: query.search, mode: 'insensitive' } } },
            { stop: { name: { contains: query.search, mode: 'insensitive' } } },
            { stop: { address: { contains: query.search, mode: 'insensitive' } } },
            { route: { name: { contains: query.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
  const sortMap: Record<string, Prisma.RouteStopOrderByWithRelationInput> = {
    code: { stop: { code: query.order } },
    name: { stop: { name: query.order } },
    sequence: { sequence: query.order },
  };
  const orderBy = (query.sort ? sortMap[query.sort] : undefined) ?? [{ route: { name: 'asc' as const } }, { sequence: 'asc' as const }];
  const [items, total] = await prisma.$transaction([
    prisma.routeStop.findMany({ where, include: routeStopInclude, skip, take, orderBy }),
    prisma.routeStop.count({ where }),
  ]);
  return pageResult(items.map((item) => stopDto(item)), total, query.page, pageSize);
};

export const getAdminStop = async (id: string) => {
  const routeStop = await prisma.routeStop.findUnique({ where: { id }, include: routeStopInclude });
  if (!routeStop) throw new AppError(404, 'STOP_NOT_FOUND', 'Route stop not found');
  return stopDto(routeStop);
};

export const createAdminStop = async (input: CreateStop, context: AuditContext) => {
  const result = await prisma.$transaction(async (tx) => {
    const route = await tx.route.findUnique({ where: { id: input.routeId } });
    if (!route) throw new AppError(404, 'ROUTE_NOT_FOUND', 'Route not found');
    const stop = await tx.stop.create({
      data: {
        code: input.code,
        name: input.name,
        address: input.landmark,
        latitude: input.latitude,
        longitude: input.longitude,
        isActive: input.status === 'active',
      },
    });
    const routeStop = await tx.routeStop.create({
      data: { routeId: input.routeId, stopId: stop.id, sequence: input.sequence },
      include: routeStopInclude,
    });
    await writeAuditLog({
      context,
      action: 'stop.create',
      entityType: 'RouteStop',
      entityId: routeStop.id,
      after: routeStop,
      client: tx,
    });
    return routeStop;
  });
  return stopDto(result);
};

export const updateAdminStop = async (id: string, input: UpdateStop, context: AuditContext) => {
  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.routeStop.findUnique({ where: { id }, include: routeStopInclude });
    if (!before) throw new AppError(404, 'STOP_NOT_FOUND', 'Route stop not found');
    const placementChanged =
      (input.routeId !== undefined && input.routeId !== before.routeId) ||
      (input.sequence !== undefined && input.sequence !== before.sequence);
    if (placementChanged && before._count.tripStops > 0) {
      throw new AppError(409, 'STOP_HAS_TRIP_HISTORY', 'Route placement cannot change after trips have been generated from this stop');
    }
    if (input.routeId && input.routeId !== before.routeId) {
      const route = await tx.route.findUnique({ where: { id: input.routeId } });
      if (!route) throw new AppError(404, 'ROUTE_NOT_FOUND', 'Route not found');
    }
    await tx.stop.update({
      where: { id: before.stopId },
      data: {
        code: input.code,
        name: input.name,
        address: input.landmark,
        latitude: input.latitude,
        longitude: input.longitude,
        isActive: input.status === undefined ? undefined : input.status === 'active',
      },
    });
    const updated = await tx.routeStop.update({
      where: { id },
      data: { routeId: input.routeId, sequence: input.sequence },
      include: routeStopInclude,
    });
    await writeAuditLog({
      context,
      action: 'stop.update',
      entityType: 'RouteStop',
      entityId: id,
      before,
      after: updated,
      client: tx,
    });
    return updated;
  });
  return stopDto(result);
};

export const deleteAdminStop = async (id: string, context: AuditContext): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    const before = await tx.routeStop.findUnique({ where: { id }, include: routeStopInclude });
    if (!before) throw new AppError(404, 'STOP_NOT_FOUND', 'Route stop not found');
    if (before._count.tripStops > 0) {
      throw new AppError(409, 'STOP_HAS_TRIP_HISTORY', 'A stop used by generated trips cannot be deleted; mark it inactive instead');
    }
    await tx.routeStop.delete({ where: { id } });
    const remainingRoutes = await tx.routeStop.count({ where: { stopId: before.stopId } });
    if (remainingRoutes === 0) await tx.stop.delete({ where: { id: before.stopId } });
    await writeAuditLog({ context, action: 'stop.delete', entityType: 'RouteStop', entityId: id, before, client: tx });
  });
};
