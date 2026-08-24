import { randomBytes } from 'node:crypto';
import {
  BookingStatus,
  BusStatus,
  DriverStatus,
  NotificationType,
  PaymentStatus,
  Prisma,
  QrCodeStatus,
  Role,
  RouteStatus,
  SeatAllocationStatus,
  TripStatus,
  UserStatus,
} from '@prisma/client';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { lockBookings } from '../../lib/booking-lock.js';
import { lockBusSchedule } from '../../lib/bus-schedule-lock.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { notifyUsers } from '../notifications/notification.service.js';
import { refundBookingPayments } from '../payments/payment.service.js';
import type { AuditContext } from './audit.service.js';
import { writeAuditLog } from './audit.service.js';
import type { createTripSchema, tripQuerySchema, updateTripSchema } from './admin.schemas.js';

type TripQuery = z.infer<typeof tripQuerySchema>;
type CreateTrip = z.infer<typeof createTripSchema>;
type UpdateTrip = z.infer<typeof updateTripSchema>;

const activeTripStatuses: TripStatus[] = [
  TripStatus.SCHEDULED,
  TripStatus.BOARDING,
  TripStatus.IN_PROGRESS,
  TripStatus.DELAYED,
];

const activeBookingStatuses: BookingStatus[] = [
  BookingStatus.HELD,
  BookingStatus.PENDING_PAYMENT,
  BookingStatus.CONFIRMED,
  BookingStatus.CHECKED_IN,
];

const tripInclude = {
  route: { select: { id: true, code: true, name: true, status: true } },
  bus: { select: { id: true, fleetNumber: true, registrationNumber: true, capacity: true, status: true } },
  driver: {
    include: { user: { select: { id: true, name: true, email: true, phone: true, status: true } } },
  },
  conductor: { select: { id: true, name: true, email: true } },
  seatAllocations: {
    where: { status: { in: [SeatAllocationStatus.HELD, SeatAllocationStatus.CONFIRMED, SeatAllocationStatus.CHECKED_IN] as SeatAllocationStatus[] } },
    select: { id: true },
  },
  _count: { select: { bookings: true, checkIns: true, locations: true, stops: true } },
} as const;

type TripRecord = Prisma.TripGetPayload<{ include: typeof tripInclude }>;

const tripDto = (trip: TripRecord) => ({
  ...trip,
  reference: trip.publicCode,
  status: trip.status.toLowerCase(),
  trackingStatus: trip.trackingStatus.toLowerCase(),
  scheduledStart: trip.scheduledStartAt,
  scheduledEnd: trip.scheduledEndAt,
  fare: Number(trip.fareAmount),
  fareAmount: Number(trip.fareAmount),
  bookedSeats: trip.seatAllocations.length,
  route: { ...trip.route, status: trip.route.status.toLowerCase() },
  bus: { ...trip.bus, status: trip.bus.status.toLowerCase() },
  driver: {
    id: trip.driverId,
    name: trip.driver.user.name,
    email: trip.driver.user.email,
    phone: trip.driver.user.phone,
    status: trip.driver.status.toLowerCase(),
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

const dateFilter = (value: TripQuery['date']): Prisma.DateTimeFilter | undefined => {
  if (!value) return undefined;
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const tomorrow = new Date(start.getTime() + 86_400_000);
  if (value === 'today') return { gte: start, lt: tomorrow };
  if (value === 'next_7_days') return { gte: start, lt: new Date(start.getTime() + 7 * 86_400_000) };
  return { lt: now };
};

export const listAdminTrips = async (query: TripQuery) => {
  const pageSize = query.pageSize ?? query.limit;
  const where: Prisma.TripWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.routeId ? { routeId: query.routeId } : {}),
    ...(query.busId ? { busId: query.busId } : {}),
    ...(query.driverId ? { driverId: query.driverId } : {}),
    ...(query.date ? { scheduledStartAt: dateFilter(query.date) } : {}),
    ...(query.search
      ? {
          OR: [
            { publicCode: { contains: query.search, mode: 'insensitive' } },
            { route: { name: { contains: query.search, mode: 'insensitive' } } },
            { route: { code: { contains: query.search, mode: 'insensitive' } } },
            { bus: { fleetNumber: { contains: query.search, mode: 'insensitive' } } },
            { bus: { registrationNumber: { contains: query.search, mode: 'insensitive' } } },
            { driver: { user: { name: { contains: query.search, mode: 'insensitive' } } } },
          ],
        }
      : {}),
  };
  const sortMap: Record<string, Prisma.TripOrderByWithRelationInput> = {
    publicCode: { publicCode: query.order },
    scheduledStartAt: { scheduledStartAt: query.order },
    status: { status: query.order },
  };
  const orderBy = (query.sort ? sortMap[query.sort] : undefined) ?? { scheduledStartAt: 'desc' as const };
  const [items, total] = await prisma.$transaction([
    prisma.trip.findMany({
      where,
      include: tripInclude,
      skip: (query.page - 1) * pageSize,
      take: pageSize,
      orderBy,
    }),
    prisma.trip.count({ where }),
  ]);
  return pageResult(items.map((item) => tripDto(item)), total, query.page, pageSize);
};

export const getAdminTrip = async (id: string) => {
  const trip = await prisma.trip.findUnique({
    where: { id },
    include: {
      ...tripInclude,
      stops: {
        include: { routeStop: { include: { stop: true } } },
        orderBy: { sequence: 'asc' },
      },
    },
  });
  if (!trip) throw new AppError(404, 'TRIP_NOT_FOUND', 'Trip not found');
  return {
    ...tripDto(trip),
    stops: trip.stops.map((stop) => ({
      ...stop,
      status: stop.status.toLowerCase(),
      stop: {
        ...stop.routeStop.stop,
        latitude: Number(stop.routeStop.stop.latitude),
        longitude: Number(stop.routeStop.stop.longitude),
      },
    })),
  };
};

const publicCode = (): string =>
  `TRP-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(4).toString('hex').toUpperCase()}`;

const validateAssignment = async (
  tx: Prisma.TransactionClient,
  input: { routeId: string; busId: string; driverId: string; conductorId?: string | null; start: Date; end: Date },
  excludeTripId?: string,
) => {
  await lockBusSchedule(tx, input.busId);
  const [route, bus, driver, conductor, overlappingBus, overlappingDriver, overlappingMaintenance] = await Promise.all([
    tx.route.findUnique({
      where: { id: input.routeId },
      include: { stops: { include: { stop: true }, orderBy: { sequence: 'asc' } } },
    }),
    tx.bus.findUnique({ where: { id: input.busId } }),
    tx.driverProfile.findUnique({ where: { userId: input.driverId }, include: { user: true } }),
    input.conductorId
      ? tx.user.findFirst({ where: { id: input.conductorId, role: Role.CONDUCTOR, status: UserStatus.ACTIVE } })
      : Promise.resolve(null),
    tx.trip.findFirst({
      where: {
        id: excludeTripId ? { not: excludeTripId } : undefined,
        busId: input.busId,
        status: { in: activeTripStatuses },
        scheduledStartAt: { lt: input.end },
        OR: [{ scheduledEndAt: null }, { scheduledEndAt: { gt: input.start } }],
      },
      select: { id: true, publicCode: true },
    }),
    tx.trip.findFirst({
      where: {
        id: excludeTripId ? { not: excludeTripId } : undefined,
        driverId: input.driverId,
        status: { in: activeTripStatuses },
        scheduledStartAt: { lt: input.end },
        OR: [{ scheduledEndAt: null }, { scheduledEndAt: { gt: input.start } }],
      },
      select: { id: true, publicCode: true },
    }),
    tx.maintenanceRecord.findFirst({
      where: {
        busId: input.busId,
        status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
        startsAt: { lt: input.end },
        OR: [{ expectedReturnAt: null }, { expectedReturnAt: { gt: input.start } }],
      },
      select: { id: true, title: true },
    }),
  ]);
  if (!route) throw new AppError(404, 'ROUTE_NOT_FOUND', 'Route not found');
  if (route.status !== RouteStatus.ACTIVE) throw new AppError(409, 'ROUTE_UNAVAILABLE', 'Only an active route can be scheduled');
  if (route.stops.length < 2) throw new AppError(409, 'ROUTE_STOPS_REQUIRED', 'A route needs at least two ordered stops before scheduling');
  if (!bus) throw new AppError(404, 'BUS_NOT_FOUND', 'Bus not found');
  if (bus.status !== BusStatus.ACTIVE) throw new AppError(409, 'BUS_UNAVAILABLE', 'Only an active bus can be scheduled');
  if (!driver) throw new AppError(404, 'DRIVER_NOT_FOUND', 'Driver profile not found');
  if (driver.status !== DriverStatus.ACTIVE || driver.user.status !== UserStatus.ACTIVE) {
    throw new AppError(409, 'DRIVER_UNAVAILABLE', 'Only an active driver can be assigned');
  }
  if (driver.licenseExpiresAt < input.start) throw new AppError(409, 'DRIVER_LICENSE_EXPIRED', 'The driver license expires before this trip');
  if (input.conductorId && !conductor) throw new AppError(409, 'CONDUCTOR_UNAVAILABLE', 'The selected conductor is not active');
  if (overlappingBus) throw new AppError(409, 'BUS_SCHEDULE_CONFLICT', `Bus is already assigned to ${overlappingBus.publicCode}`);
  if (overlappingDriver) throw new AppError(409, 'DRIVER_SCHEDULE_CONFLICT', `Driver is already assigned to ${overlappingDriver.publicCode}`);
  if (overlappingMaintenance) {
    throw new AppError(409, 'BUS_MAINTENANCE_CONFLICT', `Bus is unavailable during maintenance: ${overlappingMaintenance.title}`);
  }
  return { route, bus, driver };
};

const makeTripStops = (
  route: Awaited<ReturnType<typeof validateAssignment>>['route'],
  tripId: string,
  start: Date,
  end: Date,
) => {
  const duration = end.getTime() - start.getTime();
  const routeDistance = route.distanceMeters ?? route.stops.at(-1)?.distanceFromStartMeters ?? 0;
  return route.stops.map((routeStop, index) => {
    const ratio =
      routeStop.plannedOffsetMinutes !== null
        ? Math.min(1, Math.max(0, (routeStop.plannedOffsetMinutes * 60_000) / duration))
        : routeDistance > 0 && routeStop.distanceFromStartMeters !== null
          ? Math.min(1, Math.max(0, routeStop.distanceFromStartMeters / routeDistance))
          : index / Math.max(1, route.stops.length - 1);
    return {
      tripId,
      routeStopId: routeStop.id,
      sequence: routeStop.sequence,
      scheduledArrivalAt: new Date(start.getTime() + duration * ratio),
    };
  });
};

export const createAdminTrip = async (input: CreateTrip, context: AuditContext) => {
  if (!([TripStatus.SCHEDULED, TripStatus.DELAYED] as TripStatus[]).includes(input.status)) {
    throw new AppError(400, 'INVALID_INITIAL_TRIP_STATUS', 'A new trip must be scheduled or delayed');
  }
  const created = await prisma.$transaction(
    async (tx) => {
      const resources = await validateAssignment(tx, {
        routeId: input.routeId,
        busId: input.busId,
        driverId: input.driverId,
        conductorId: input.conductorId,
        start: input.scheduledStart,
        end: input.scheduledEnd,
      });
      const trip = await tx.trip.create({
        data: {
          publicCode: publicCode(),
          routeId: input.routeId,
          busId: input.busId,
          driverId: input.driverId,
          conductorId: input.conductorId,
          scheduledStartAt: input.scheduledStart,
          scheduledEndAt: input.scheduledEnd,
          bookingClosesAt: input.scheduledStart,
          boardingOpensAt: new Date(input.scheduledStart.getTime() - 30 * 60_000),
          fareAmount: input.fare,
          status: input.status,
        },
      });
      await tx.tripStop.createMany({ data: makeTripStops(resources.route, trip.id, input.scheduledStart, input.scheduledEnd) });
      const complete = await tx.trip.findUniqueOrThrow({ where: { id: trip.id }, include: tripInclude });
      await writeAuditLog({
        context,
        action: 'trip.create',
        entityType: 'Trip',
        entityId: trip.id,
        after: complete,
        metadata: { notes: input.notes },
        client: tx,
      });
      return complete;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  return tripDto(created);
};

const transitions: Record<TripStatus, TripStatus[]> = {
  SCHEDULED: [TripStatus.BOARDING, TripStatus.DELAYED, TripStatus.CANCELLED],
  BOARDING: [TripStatus.IN_PROGRESS, TripStatus.DELAYED, TripStatus.CANCELLED],
  IN_PROGRESS: [TripStatus.DELAYED, TripStatus.COMPLETED, TripStatus.CANCELLED],
  DELAYED: [TripStatus.BOARDING, TripStatus.IN_PROGRESS, TripStatus.COMPLETED, TripStatus.CANCELLED],
  COMPLETED: [],
  CANCELLED: [],
};

const cancelRelatedBookings = async (tx: Prisma.TransactionClient, tripId: string, reason: string) => {
  const now = new Date();
  const bookingIds = await tx.booking.findMany({
    where: { tripId, status: { in: activeBookingStatuses } },
    select: { id: true },
  });
  await lockBookings(tx, bookingIds.map(({ id }) => id));
  const bookings = await tx.booking.findMany({
    where: { tripId, status: { in: activeBookingStatuses } },
    include: {
      payments: { where: { status: PaymentStatus.SUCCEEDED }, select: { id: true } },
      subscription: { select: { id: true, remainingTrips: true } },
    },
  });
  for (const booking of bookings) {
    const refundRequired = booking.payments.length > 0;
    await tx.booking.update({
      where: { id: booking.id },
      data: {
        status: refundRequired ? BookingStatus.REFUND_PENDING : BookingStatus.CANCELLED,
        cancelledAt: now,
        cancellationReason: reason,
        version: { increment: 1 },
      },
    });
    await tx.seatAllocation.updateMany({
      where: { bookingId: booking.id, status: { in: [SeatAllocationStatus.HELD, SeatAllocationStatus.CONFIRMED, SeatAllocationStatus.CHECKED_IN] } },
      data: { status: SeatAllocationStatus.RELEASED, releasedAt: now, releaseReason: 'Trip cancelled' },
    });
    await tx.bookingQrCode.updateMany({
      where: { bookingId: booking.id, status: QrCodeStatus.ACTIVE },
      data: { status: QrCodeStatus.REVOKED, revokedAt: now, revokeReason: 'Trip cancelled' },
    });
    if (refundRequired) {
      await tx.payment.updateMany({
        where: { bookingId: booking.id, status: PaymentStatus.SUCCEEDED },
        data: { status: PaymentStatus.REFUND_PENDING },
      });
    }
    if (booking.subscription?.remainingTrips !== null && booking.subscription?.remainingTrips !== undefined) {
      await tx.studentSubscription.update({
        where: { id: booking.subscription.id },
        data: { remainingTrips: { increment: 1 } },
      });
    }
  }
  return bookings.map(({ id, studentId, payments }) => ({ id, studentId, refundRequired: payments.length > 0 }));
};

export const updateAdminTrip = async (id: string, input: UpdateTrip, context: AuditContext) => {
  let affected: Array<{ id: string; studentId: string; refundRequired: boolean }> = [];
  const updated = await prisma.$transaction(
    async (tx) => {
      const before = await tx.trip.findUnique({ where: { id }, include: tripInclude });
      if (!before) throw new AppError(404, 'TRIP_NOT_FOUND', 'Trip not found');
      const status = input.status ?? before.status;
      if (status !== before.status && !transitions[before.status].includes(status)) {
        throw new AppError(409, 'INVALID_TRIP_TRANSITION', `Cannot change trip from ${before.status} to ${status}`);
      }
      const start = input.scheduledStart ?? before.scheduledStartAt;
      const end = input.scheduledEnd === undefined ? before.scheduledEndAt : input.scheduledEnd;
      if (!end || end <= start) throw new AppError(400, 'INVALID_TRIP_WINDOW', 'Scheduled arrival must be after departure');
      const routeId = input.routeId ?? before.routeId;
      const busId = input.busId ?? before.busId;
      const driverId = input.driverId ?? before.driverId;
      const conductorId = input.conductorId === undefined ? before.conductorId : input.conductorId;
      const assignmentChanged = routeId !== before.routeId || busId !== before.busId;
      if (assignmentChanged && before._count.bookings > 0) {
        throw new AppError(409, 'TRIP_HAS_BOOKINGS', 'Route or bus cannot change after bookings exist');
      }
      if (status !== TripStatus.CANCELLED && activeTripStatuses.includes(status)) {
        await validateAssignment(tx, { routeId, busId, driverId, conductorId, start, end }, id);
      }
      const data: Prisma.TripUpdateInput = {
        route: input.routeId ? { connect: { id: input.routeId } } : undefined,
        bus: input.busId ? { connect: { id: input.busId } } : undefined,
        driver: input.driverId ? { connect: { userId: input.driverId } } : undefined,
        conductor:
          input.conductorId === undefined
            ? undefined
            : input.conductorId === null
              ? { disconnect: true }
              : { connect: { id: input.conductorId } },
        scheduledStartAt: input.scheduledStart,
        scheduledEndAt: input.scheduledEnd,
        fareAmount: input.fare,
        status,
        delayReason: status === TripStatus.DELAYED ? input.delayReason ?? before.delayReason ?? 'Marked delayed by an administrator' : input.delayReason,
        cancellationReason:
          status === TripStatus.CANCELLED
            ? input.cancellationReason ?? before.cancellationReason ?? 'Cancelled by an administrator'
            : input.cancellationReason,
        actualEndAt: status === TripStatus.COMPLETED ? before.actualEndAt ?? new Date() : undefined,
        version: { increment: 1 },
      };
      await tx.trip.update({ where: { id }, data });
      if ((input.routeId || input.scheduledStart || input.scheduledEnd) && before._count.bookings === 0) {
        const resources = await validateAssignment(tx, { routeId, busId, driverId, conductorId, start, end }, id);
        await tx.tripStop.deleteMany({ where: { tripId: id } });
        await tx.tripStop.createMany({ data: makeTripStops(resources.route, id, start, end) });
      }
      if (status === TripStatus.CANCELLED && before.status !== TripStatus.CANCELLED) {
        affected = await cancelRelatedBookings(tx, id, data.cancellationReason as string);
      }
      const complete = await tx.trip.findUniqueOrThrow({ where: { id }, include: tripInclude });
      await writeAuditLog({
        context,
        action: status === TripStatus.CANCELLED ? 'trip.cancel' : status === TripStatus.DELAYED ? 'trip.delay' : 'trip.update',
        entityType: 'Trip',
        entityId: id,
        before,
        after: complete,
        metadata: { notes: input.notes },
        client: tx,
      });
      return complete;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  if (input.status === TripStatus.CANCELLED && affected.length > 0) {
    await notifyUsers(
      affected.map(({ studentId }) => studentId),
      {
        type: NotificationType.TRIP_CANCELLED,
        title: 'Trip cancelled',
        body: `Trip ${updated.publicCode} has been cancelled.`,
        data: { tripId: updated.id },
        dedupePrefix: `admin-trip-cancel:${updated.id}:${updated.updatedAt.getTime()}`,
      },
    );
    for (const booking of affected.filter(({ refundRequired }) => refundRequired)) {
      void refundBookingPayments(booking.id, `Trip ${updated.publicCode} cancelled`).catch((error: unknown) => {
        logger.error({ err: error, bookingId: booking.id, tripId: updated.id }, 'Automatic trip-cancellation refund failed');
      });
    }
  } else if (input.status === TripStatus.DELAYED) {
    const students = await prisma.booking.findMany({
      where: { tripId: id, status: { in: activeBookingStatuses } },
      select: { studentId: true },
      distinct: ['studentId'],
    });
    await notifyUsers(
      students.map(({ studentId }) => studentId),
      {
        type: NotificationType.TRIP_DELAYED,
        title: 'Trip delayed',
        body: `Trip ${updated.publicCode} is delayed${updated.delayReason ? `: ${updated.delayReason}` : '.'}`,
        data: { tripId: updated.id, delayMinutes: updated.delayMinutes },
        dedupePrefix: `admin-trip-delay:${updated.id}:${updated.updatedAt.getTime()}`,
      },
    );
  }
  return tripDto(updated);
};

export const cancelAdminTrip = async (id: string, reason: string, context: AuditContext) =>
  updateAdminTrip(id, { status: TripStatus.CANCELLED, cancellationReason: reason }, context);

export const deleteAdminTrip = async (id: string, context: AuditContext): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    const before = await tx.trip.findUnique({ where: { id }, include: tripInclude });
    if (!before) throw new AppError(404, 'TRIP_NOT_FOUND', 'Trip not found');
    if (before.status !== TripStatus.SCHEDULED || before._count.bookings > 0 || before._count.checkIns > 0 || before._count.locations > 0) {
      throw new AppError(409, 'TRIP_HAS_HISTORY', 'Only an unused scheduled trip can be deleted; cancel other trips instead');
    }
    await tx.trip.delete({ where: { id } });
    await writeAuditLog({ context, action: 'trip.delete', entityType: 'Trip', entityId: id, before, client: tx });
  });
};
