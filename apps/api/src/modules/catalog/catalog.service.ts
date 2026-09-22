import {
  BookingStatus,
  BusStatus,
  RouteStatus,
  SeatAllocationStatus,
  SeatStatus,
  TripStatus,
  Prisma,
} from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { paginated, toPagination } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import { reservedSeatIds, seatOrder } from '../../lib/reserved-seats.js';
import type { z } from 'zod';
import type { routeQuerySchema, tripQuerySchema } from './catalog.schemas.js';

type RouteQuery = z.infer<typeof routeQuerySchema>;
type TripQuery = z.infer<typeof tripQuerySchema>;

const stopDto = (routeStop: {
  sequence: number;
  plannedOffsetMinutes: number | null;
  stop: { id: string; code: string; name: string; address: string | null; latitude: unknown; longitude: unknown };
}) => ({
  id: routeStop.stop.id,
  code: routeStop.stop.code,
  name: routeStop.stop.name,
  address: routeStop.stop.address,
  latitude: Number(routeStop.stop.latitude),
  longitude: Number(routeStop.stop.longitude),
  sequence: routeStop.sequence,
  scheduledOffsetMinutes: routeStop.plannedOffsetMinutes,
});

const routeDto = (route: {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: RouteStatus;
  distanceMeters: number | null;
  estimatedDurationMinutes: number | null;
  encodedPolyline: string | null;
  stops: Array<Parameters<typeof stopDto>[0]>;
}) => {
  const stops = route.stops.map(stopDto);
  return {
    id: route.id,
    code: route.code,
    name: route.name,
    description: route.description,
    origin: stops[0]?.name ?? '',
    destination: stops.at(-1)?.name ?? '',
    status: route.status,
    active: route.status === RouteStatus.ACTIVE,
    distanceKm: route.distanceMeters === null ? null : route.distanceMeters / 1000,
    durationMinutes: route.estimatedDurationMinutes,
    encodedPolyline: route.encodedPolyline,
    stops,
    path: stops.map((stop) => [stop.latitude, stop.longitude]),
  };
};

const routeInclude = Prisma.validator<Prisma.RouteInclude>()({
  stops: {
    orderBy: { sequence: 'asc' as const },
    include: { stop: true },
  },
});

export const listRoutes = async (query: RouteQuery) => {
  const where = {
    status: RouteStatus.ACTIVE,
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' as const } },
            { code: { contains: query.search, mode: 'insensitive' as const } },
            { description: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
    ...(query.stopId ? { stops: { some: { stopId: query.stopId } } } : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.route.findMany({
      where,
      include: routeInclude,
      ...toPagination(query),
      orderBy: [{ name: 'asc' }],
    }),
    prisma.route.count({ where }),
  ]);
  return paginated(items.map(routeDto), total, query.page, query.pageSize);
};

export const getRoute = async (routeId: string) => {
  const route = await prisma.route.findFirst({
    where: { id: routeId, status: { not: RouteStatus.INACTIVE } },
    include: routeInclude,
  });
  if (!route) throw new AppError(404, 'ROUTE_NOT_FOUND', 'Route not found');
  const now = new Date();
  const alerts = await prisma.roadAlert.findMany({
    where: {
      routes: { some: { routeId } },
      status: 'ACTIVE',
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    },
    orderBy: [{ severity: 'desc' }, { startsAt: 'desc' }],
  });
  return { ...routeDto(route), alerts: alerts.map(decimalCoordinates) };
};

const decimalCoordinates = <T extends { latitude?: unknown; longitude?: unknown }>(value: T) => ({
  ...value,
  ...(value.latitude === undefined || value.latitude === null ? {} : { latitude: Number(value.latitude) }),
  ...(value.longitude === undefined || value.longitude === null ? {} : { longitude: Number(value.longitude) }),
});

export const listStops = async (search?: string) =>
  (
    await prisma.stop.findMany({
      where: {
        isActive: true,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { code: { contains: search, mode: 'insensitive' } },
                { address: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
      take: 100,
    })
  ).map(decimalCoordinates);

export const listBuses = async () =>
  (
    await prisma.bus.findMany({
      where: { status: { in: [BusStatus.ACTIVE, BusStatus.UNDER_MAINTENANCE] } },
      include: {
        maintenanceRecords: {
          where: { status: { in: ['SCHEDULED', 'IN_PROGRESS'] } },
          orderBy: { startsAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { fleetNumber: 'asc' },
    })
  ).map((bus) => ({
      id: bus.id,
      registrationNumber: bus.registrationNumber,
      label: bus.fleetNumber,
      make: bus.make,
      model: bus.model,
      capacity: bus.capacity,
      status: bus.status === BusStatus.UNDER_MAINTENANCE ? 'MAINTENANCE' : bus.status,
      amenities: bus.amenities,
      expectedAvailableAt: bus.maintenanceRecords[0]?.expectedReturnAt,
    }));

const activeAllocationWhere = (now: Date) => ({
  OR: [
    { status: { in: [SeatAllocationStatus.CONFIRMED, SeatAllocationStatus.CHECKED_IN] } },
    {
      status: SeatAllocationStatus.HELD,
      booking: { holdExpiresAt: { gt: now }, status: { in: [BookingStatus.HELD, BookingStatus.PENDING_PAYMENT] } },
    },
  ],
});

const tripInclude = (now: Date) => ({
  route: { include: routeInclude },
  bus: {
    include: {
      seats: { where: { status: SeatStatus.ACTIVE }, select: { id: true } },
    },
  },
  driver: { include: { user: { select: { id: true, name: true, avatarUrl: true } } } },
  seatAllocations: { where: activeAllocationWhere(now), select: { id: true } },
  locations: { orderBy: { recordedAt: 'desc' as const }, take: 1 },
});

type CatalogTripRecord = Prisma.TripGetPayload<{ include: ReturnType<typeof tripInclude> }>;

const tripDto = (trip: CatalogTripRecord) => {
  const capacity = trip.bus.seats.length;
  const lastLocation = trip.locations[0];
  return {
    id: trip.id,
    publicCode: trip.publicCode,
    routeId: trip.routeId,
    route: routeDto(trip.route),
    busId: trip.busId,
    bus: {
      id: trip.bus.id,
      registrationNumber: trip.bus.registrationNumber,
      label: trip.bus.fleetNumber,
      capacity,
      status: trip.bus.status,
    },
    driver: {
      id: trip.driver.user.id,
      name: trip.driver.user.name,
      averageRating: Number(trip.driver.averageRating),
    },
    departureTime: trip.scheduledStartAt,
    estimatedArrivalTime: trip.scheduledEndAt,
    actualDepartureTime: trip.actualStartAt,
    actualArrivalTime: trip.actualEndAt,
    availableSeats: Math.max(0, capacity - trip.seatAllocations.length),
    totalSeats: capacity,
    fare: Number(trip.fareAmount),
    currency: trip.currency,
    status: trip.status,
    delayMinutes: trip.delayMinutes,
    currentLocation: lastLocation
      ? {
          latitude: Number(lastLocation.latitude),
          longitude: Number(lastLocation.longitude),
          speedKph: lastLocation.speedKph === null ? null : Number(lastLocation.speedKph),
          heading: lastLocation.headingDegrees === null ? null : Number(lastLocation.headingDegrees),
          recordedAt: lastLocation.recordedAt,
        }
      : null,
  };
};

export const getTripLocation = async (tripId: string) => {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: {
      id: true,
      status: true,
      trackingStatus: true,
      locations: { orderBy: { recordedAt: 'desc' }, take: 1 },
    },
  });
  if (!trip) throw new AppError(404, 'TRIP_NOT_FOUND', 'Trip not found');
  const location = trip.locations[0];
  return {
    tripId: trip.id,
    status: trip.status,
    trackingStatus: trip.trackingStatus,
    currentLocation: location
      ? {
          latitude: Number(location.latitude),
          longitude: Number(location.longitude),
          recordedAt: location.recordedAt,
          heading: location.headingDegrees === null ? null : Number(location.headingDegrees),
          speedKph: location.speedKph === null ? null : Number(location.speedKph),
        }
      : null,
  };
};

export const listTrips = async (query: TripQuery) => {
  const now = new Date();
  const dayStart = query.from ? query.from : query.date ? new Date(`${query.date}T00:00:00.000Z`) : undefined;
  const dayEnd = query.to ? query.to : dayStart ? new Date(dayStart.getTime() + 86_400_000) : undefined;
  let corridorRouteIds: string[] | undefined;
  if (query.originStopId || query.destinationStopId) {
    const routes = await prisma.route.findMany({
      where: {
        AND: [
          ...(query.originStopId ? [{ stops: { some: { stopId: query.originStopId } } }] : []),
          ...(query.destinationStopId ? [{ stops: { some: { stopId: query.destinationStopId } } }] : []),
        ],
      },
      select: {
        id: true,
        stops: {
          where: { stopId: { in: [query.originStopId, query.destinationStopId].filter((id): id is string => Boolean(id)) } },
          select: { stopId: true, sequence: true },
        },
      },
    });
    corridorRouteIds = routes
      .filter((route) => {
        if (!query.originStopId || !query.destinationStopId) return true;
        const origin = route.stops.find((stop) => stop.stopId === query.originStopId);
        const destination = route.stops.find((stop) => stop.stopId === query.destinationStopId);
        return Boolean(origin && destination && origin.sequence < destination.sequence);
      })
      .map(({ id }) => id);
  }
  const where = {
    ...(query.routeId
      ? { routeId: query.routeId }
      : corridorRouteIds
        ? { routeId: { in: corridorRouteIds } }
        : {}),
    ...(query.stopId ? { route: { stops: { some: { stopId: query.stopId } } } } : {}),
    ...(query.status?.length
      ? { status: { in: query.status } }
      : { status: { in: [TripStatus.SCHEDULED, TripStatus.BOARDING, TripStatus.IN_PROGRESS, TripStatus.DELAYED] } }),
    ...(dayStart && dayEnd ? { scheduledStartAt: { gte: dayStart, lt: dayEnd } } : { scheduledStartAt: { gte: new Date(now.getTime() - 4 * 60 * 60_000) } }),
  };
  const [items, total] = await prisma.$transaction([
    prisma.trip.findMany({
      where,
      include: tripInclude(now),
      ...toPagination(query),
      orderBy: { scheduledStartAt: 'asc' },
    }),
    prisma.trip.count({ where }),
  ]);
  return paginated(items.map(tripDto), total, query.page, query.pageSize);
};

export const getTrip = async (tripId: string) => {
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, include: tripInclude(new Date()) });
  if (!trip) throw new AppError(404, 'TRIP_NOT_FOUND', 'Trip not found');
  return tripDto(trip);
};

export const getTripSeats = async (tripId: string, userId?: string) => {
  const now = new Date();
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      bus: { include: { seats: { orderBy: seatOrder } } },
      seatAllocations: {
        where: activeAllocationWhere(now),
        include: {
          booking: { select: { id: true, studentId: true, status: true, holdExpiresAt: true } },
        },
      },
    },
  });
  if (!trip) throw new AppError(404, 'TRIP_NOT_FOUND', 'Trip not found');
  const allocations = new Map(trip.seatAllocations.map((allocation) => [allocation.seatId, allocation]));
  const reserved = reservedSeatIds(trip.bus.seats);
  const seats = trip.bus.seats.map((seat) => {
    const allocation = allocations.get(seat.id);
    const isReserved = reserved.has(seat.id);
    const held = allocation?.status === SeatAllocationStatus.HELD;
    const recoverableByCurrentUser = Boolean(
      held &&
      userId &&
      allocation?.booking.studentId === userId &&
      allocation.booking.status === BookingStatus.HELD &&
      allocation.booking.holdExpiresAt &&
      allocation.booking.holdExpiresAt > now,
    );
    return {
      id: seat.id,
      number: seat.seatNumber,
      row: seat.rowNumber,
      column: seat.columnLabel,
      type: seat.type,
      reserved: isReserved,
      status:
        seat.status !== SeatStatus.ACTIVE || (isReserved && !allocation)
          ? 'BLOCKED'
          : allocation
            ? held
              ? 'HELD'
              : 'BOOKED'
            : 'AVAILABLE',
      heldByCurrentUser: recoverableByCurrentUser,
    };
  });
  const currentAllocation = trip.seatAllocations.find(
    (allocation) =>
      allocation.status === SeatAllocationStatus.HELD &&
      allocation.booking.studentId === userId &&
      allocation.booking.status === BookingStatus.HELD &&
      allocation.booking.holdExpiresAt &&
      allocation.booking.holdExpiresAt > now,
  );
  const currentSeat = currentAllocation
    ? trip.bus.seats.find((seat) => seat.id === currentAllocation.seatId)
    : undefined;
  return {
    tripId,
    items: seats,
    seats,
    currentHold:
      currentAllocation && currentSeat && currentAllocation.booking.holdExpiresAt
        ? {
            id: currentAllocation.booking.id,
            seatNumber: currentSeat.seatNumber,
            expiresAt: currentAllocation.booking.holdExpiresAt,
          }
        : null,
    updatedAt: new Date(),
  };
};

export const listSubscriptionPlans = () =>
  prisma.subscriptionPlan.findMany({
    where: { isActive: true },
    include: { routes: { include: { route: { select: { id: true, code: true, name: true } } } } },
    orderBy: { price: 'asc' },
  });
