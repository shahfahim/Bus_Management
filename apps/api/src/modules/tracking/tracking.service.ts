import { randomBytes } from 'node:crypto';
import {
  AlertSeverity,
  BookingStatus,
  IncidentStatus,
  LocationSource,
  NotificationType,
  Role,
  TrackingStatus,
  TripStatus,
  TripStopStatus,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { lockBookings } from '../../lib/booking-lock.js';
import { lockBusSchedule } from '../../lib/bus-schedule-lock.js';
import { assertBusHasNoMaintenanceConflict } from '../../lib/maintenance-window.js';
import { estimateRouteEta, haversineMeters } from '../../lib/geo.js';
import { paginated, toPagination } from '../../lib/pagination.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { emitToRole, emitToTrip } from '../../realtime/hub.js';
import { notifyUser, notifyUsers } from '../notifications/notification.service.js';
import type { incidentSchema, locationUpdateSchema } from './tracking.schemas.js';
import type { StoredIncidentImage } from './tracking.upload.js';

type LocationInput = z.infer<typeof locationUpdateSchema>;
type IncidentInput = z.infer<typeof incidentSchema>;

const driverTripInclude = {
  route: { include: { stops: { include: { stop: true }, orderBy: { sequence: 'asc' as const } } } },
  bus: true,
  stops: { include: { routeStop: { include: { stop: true } } }, orderBy: { sequence: 'asc' as const } },
  locations: { orderBy: { recordedAt: 'desc' as const }, take: 1 },
  _count: { select: { bookings: true, checkIns: true } },
} as const;

type DriverTripRecord = Prisma.TripGetPayload<{ include: typeof driverTripInclude }>;

const assertAssigned = (
  trip: { driverId: string; conductorId: string | null },
  actor: { userId: string; role: Role },
): void => {
  const assigned =
    actor.role === Role.ADMIN ||
    (actor.role === Role.DRIVER && trip.driverId === actor.userId) ||
    (actor.role === Role.CONDUCTOR && trip.conductorId === actor.userId);
  if (!assigned) throw new AppError(403, 'NOT_ASSIGNED_TO_TRIP', 'You are not assigned to this trip');
};

const driverTripDto = (trip: DriverTripRecord) => {
  const lastLocation = trip.locations[0];
  return {
    id: trip.id,
    publicCode: trip.publicCode,
    routeId: trip.routeId,
    route: {
      id: trip.route.id,
      code: trip.route.code,
      name: trip.route.name,
      origin: trip.route.stops[0]?.stop.name ?? '',
      destination: trip.route.stops.at(-1)?.stop.name ?? '',
      stops: trip.route.stops.map((routeStop) => ({
        id: routeStop.stop.id,
        name: routeStop.stop.name,
        sequence: routeStop.sequence,
        latitude: Number(routeStop.stop.latitude),
        longitude: Number(routeStop.stop.longitude),
      })),
    },
    busId: trip.busId,
    bus: {
      id: trip.bus.id,
      registrationNumber: trip.bus.registrationNumber,
      label: trip.bus.fleetNumber,
      capacity: trip.bus.capacity,
      status: trip.bus.status,
    },
    departureTime: trip.scheduledStartAt,
    estimatedArrivalTime: trip.scheduledEndAt,
    actualDepartureTime: trip.actualStartAt,
    actualArrivalTime: trip.actualEndAt,
    fare: Number(trip.fareAmount),
    currency: trip.currency,
    status: trip.status,
    trackingStatus: trip.trackingStatus,
    locationIntervalSeconds: trip.locationIntervalSeconds,
    delayMinutes: trip.delayMinutes,
    passengerCount: trip._count?.bookings,
    checkedInCount: trip._count?.checkIns,
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

export const getDriverProfile = async (userId: string) => {
  const profile = await prisma.driverProfile.findUnique({
    where: { userId },
    include: { user: { select: { id: true, name: true, email: true, phone: true, avatarUrl: true } } },
  });
  if (!profile) throw new AppError(404, 'DRIVER_PROFILE_NOT_FOUND', 'Driver profile not found');
  return { ...profile, averageRating: Number(profile.averageRating) };
};

export const listDriverTrips = async (
  actor: { userId: string; role: Role },
  query: { page: number; pageSize: number; status?: TripStatus },
) => {
  const where = {
    ...(actor.role === Role.DRIVER
      ? { driverId: actor.userId }
      : actor.role === Role.CONDUCTOR
        ? { conductorId: actor.userId }
        : {}),
    ...(query.status ? { status: query.status } : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.trip.findMany({ where, include: driverTripInclude, ...toPagination(query), orderBy: { scheduledStartAt: 'desc' } }),
    prisma.trip.count({ where }),
  ]);
  return paginated(items.map(driverTripDto), total, query.page, query.pageSize);
};

export const getDriverTrip = async (tripId: string, actor: { userId: string; role: Role }) => {
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, include: driverTripInclude });
  if (!trip) throw new AppError(404, 'TRIP_NOT_FOUND', 'Trip not found');
  assertAssigned(trip, actor);
  return driverTripDto(trip);
};

export const startTrip = async (tripId: string, actor: { userId: string; role: Role }) => {
  const scope = await prisma.trip.findUnique({ where: { id: tripId }, select: { busId: true } });
  if (!scope) throw new AppError(404, 'TRIP_NOT_FOUND', 'Trip not found');
  await prisma.$transaction(async (tx) => {
    await lockBusSchedule(tx, scope.busId);
    const trip = await tx.trip.findUnique({ where: { id: tripId }, include: { bus: true } });
    if (!trip) throw new AppError(404, 'TRIP_NOT_FOUND', 'Trip not found');
    assertAssigned(trip, actor);
    if (actor.role === Role.CONDUCTOR) throw new AppError(403, 'DRIVER_REQUIRED', 'Only the assigned driver may start a trip');
    if (!([TripStatus.SCHEDULED, TripStatus.BOARDING, TripStatus.DELAYED] as TripStatus[]).includes(trip.status)) {
      throw new AppError(409, 'TRIP_ALREADY_STARTED', 'This trip cannot be started from its current state');
    }
    if (trip.bus.status !== 'ACTIVE') throw new AppError(409, 'BUS_UNAVAILABLE', 'The assigned bus is not active');
    await assertBusHasNoMaintenanceConflict(tx, {
      busId: trip.busId,
      startsAt: trip.scheduledStartAt,
      endsAt: trip.scheduledEndAt,
    });
    const updated = await tx.trip.updateMany({
      where: { id: trip.id, version: trip.version, status: { in: [TripStatus.SCHEDULED, TripStatus.BOARDING, TripStatus.DELAYED] } },
      data: {
        status: TripStatus.IN_PROGRESS,
        trackingStatus: TrackingStatus.ACTIVE,
        actualStartAt: trip.actualStartAt ?? new Date(),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new AppError(409, 'TRIP_STATE_CHANGED', 'Trip state changed; refresh and try again');
  });
  const result = await getDriverTrip(tripId, actor);
  emitToTrip(tripId, 'trip:status', result);
  return result;
};

export const endTrip = async (tripId: string, actor: { userId: string; role: Role }) => {
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) throw new AppError(404, 'TRIP_NOT_FOUND', 'Trip not found');
  assertAssigned(trip, actor);
  if (actor.role === Role.CONDUCTOR) throw new AppError(403, 'DRIVER_REQUIRED', 'Only the assigned driver may end a trip');
  if (!([TripStatus.IN_PROGRESS, TripStatus.DELAYED] as TripStatus[]).includes(trip.status)) {
    throw new AppError(409, 'TRIP_NOT_IN_PROGRESS', 'This trip is not currently in progress');
  }
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const bookingIds = await tx.booking.findMany({
      where: { tripId, status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] } },
      select: { id: true },
    });
    await lockBookings(tx, bookingIds.map(({ id }) => id));
    const updated = await tx.trip.updateMany({
      where: { id: trip.id, version: trip.version, status: { in: [TripStatus.IN_PROGRESS, TripStatus.DELAYED] } },
      data: {
        status: TripStatus.COMPLETED,
        trackingStatus: TrackingStatus.ENDED,
        actualEndAt: now,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new AppError(409, 'TRIP_STATE_CHANGED', 'Trip state changed; refresh and try again');
    await tx.booking.updateMany({
      where: { tripId, status: BookingStatus.CHECKED_IN },
      data: { status: BookingStatus.COMPLETED, completedAt: now, version: { increment: 1 } },
    });
  });
  const result = await getDriverTrip(tripId, actor);
  emitToTrip(tripId, 'trip:status', result);
  return result;
};

const trafficMultiplierFor = (alerts: Array<{ severity: AlertSeverity }>): number => {
  const values: Record<AlertSeverity, number> = {
    INFO: 1,
    MINOR: 1.1,
    MODERATE: 1.25,
    MAJOR: 1.5,
    CRITICAL: 2,
  };
  return alerts.reduce((maximum, alert) => Math.max(maximum, values[alert.severity]), 1);
};

const updateEtasAndNotify = async (tripId: string, input: LocationInput): Promise<void> => {
  const now = new Date();
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      stops: { include: { routeStop: { include: { stop: true } } }, orderBy: { sequence: 'asc' } },
      route: {
        include: {
          alertRoutes: {
            where: {
              alert: { status: 'ACTIVE', startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
            },
            include: { alert: { select: { severity: true } } },
          },
        },
      },
      locations: { orderBy: { recordedAt: 'desc' }, take: 8, select: { speedKph: true } },
    },
  });
  if (!trip) return;
  const usableSpeeds = trip.locations.map((location) => Number(location.speedKph)).filter((speed) => speed >= 3 && speed <= 100);
  const averageSpeed = usableSpeeds.length ? usableSpeeds.reduce((sum, speed) => sum + speed, 0) / usableSpeeds.length : null;
  const routePoints = trip.stops.map((tripStop) => ({
    sequence: tripStop.sequence,
    latitude: Number(tripStop.routeStop.stop.latitude),
    longitude: Number(tripStop.routeStop.stop.longitude),
  }));
  const trafficMultiplier = trafficMultiplierFor(trip.route.alertRoutes.map((item) => item.alert));
  const estimates = trip.stops
    .map((tripStop) => ({
      tripStop,
      estimate: estimateRouteEta({
        current: { latitude: input.latitude, longitude: input.longitude },
        routePoints,
        destinationSequence: tripStop.sequence,
        reportedSpeedKph: input.speedKph,
        recentAverageSpeedKph: averageSpeed,
        trafficMultiplier,
        scheduleDelayMinutes: trip.delayMinutes,
      }),
    }))
    .filter((item) => item.estimate !== null);

  await prisma.$transaction(
    estimates.map(({ tripStop, estimate }) =>
      prisma.tripStop.update({
        where: { id: tripStop.id },
        data: {
          estimatedArrivalAt: new Date(now.getTime() + estimate!.minutes * 60_000),
          etaUpdatedAt: now,
          ...(estimate!.minutes <= 5 && tripStop.status === TripStopStatus.SCHEDULED
            ? { status: TripStopStatus.APPROACHING }
            : {}),
        },
      }),
    ),
  );

  const approachingIds = estimates
    .filter(({ estimate }) => estimate!.minutes >= 10 && estimate!.minutes <= 20)
    .map(({ tripStop }) => tripStop.id);
  if (!approachingIds.length) return;
  const bookings = await prisma.booking.findMany({
    where: {
      tripId,
      boardingTripStopId: { in: approachingIds },
      status: BookingStatus.CONFIRMED,
    },
    include: { boardingStop: { include: { routeStop: { include: { stop: true } } } } },
  });
  for (const booking of bookings) {
    const eta = estimates.find(({ tripStop }) => tripStop.id === booking.boardingTripStopId)?.estimate;
    await notifyUser({
      userId: booking.studentId,
      type: NotificationType.BUS_ETA_15_MINUTES,
      title: 'Your bus is approaching',
      body: `Bus ${trip.publicCode} is about ${Math.round(eta?.minutes ?? 15)} minutes from ${booking.boardingStop.routeStop.stop.name}.`,
      data: { bookingId: booking.id, tripId, etaMinutes: eta?.minutes, stopId: booking.boardingTripStopId },
      dedupeKey: `eta-15:${tripId}:${booking.id}`,
      expiresAt: new Date(now.getTime() + 2 * 60 * 60_000),
    });
  }
};

export const recordLocation = async (input: LocationInput, actor: { userId: string; role: Role }) => {
  const trip = await prisma.trip.findUnique({
    where: { id: input.tripId },
    include: { locations: { orderBy: { recordedAt: 'desc' }, take: 1 } },
  });
  if (!trip) throw new AppError(404, 'TRIP_NOT_FOUND', 'Trip not found');
  assertAssigned(trip, actor);
  if (actor.role !== Role.DRIVER && actor.role !== Role.ADMIN) {
    throw new AppError(403, 'DRIVER_REQUIRED', 'Only the assigned driver may publish GPS updates');
  }
  if (!([TripStatus.BOARDING, TripStatus.IN_PROGRESS, TripStatus.DELAYED] as TripStatus[]).includes(trip.status)) {
    throw new AppError(409, 'TRACKING_NOT_ACTIVE', 'Location sharing is not active for this trip');
  }
  const now = new Date();
  if (input.capturedAt.getTime() > now.getTime() + 2 * 60_000) {
    throw new AppError(400, 'INVALID_CAPTURE_TIME', 'The GPS timestamp is in the future');
  }
  if (!input.isOfflineReplay && input.capturedAt.getTime() < now.getTime() - 30 * 60_000) {
    throw new AppError(400, 'STALE_LOCATION', 'The GPS update is too old');
  }

  const previous = trip.locations[0];
  if (previous) {
    const elapsedSeconds = (input.capturedAt.getTime() - previous.recordedAt.getTime()) / 1000;
    const movedMeters = haversineMeters(
      { latitude: Number(previous.latitude), longitude: Number(previous.longitude) },
      { latitude: input.latitude, longitude: input.longitude },
    );
    if (elapsedSeconds >= 0 && elapsedSeconds < Math.max(5, trip.locationIntervalSeconds * 0.65) && movedMeters < 15) {
      return { accepted: false, reason: 'THROTTLED', nextUpdateInSeconds: Math.ceil(trip.locationIntervalSeconds - elapsedSeconds) };
    }
  }

  const source = input.isOfflineReplay ? LocationSource.LAST_KNOWN : input.accuracyMeters && input.accuracyMeters > 100 ? LocationSource.NETWORK : LocationSource.GPS;
  const location = await prisma.$transaction(async (tx) => {
    const created = await tx.tripLocation.create({
      data: {
        tripId: trip.id,
        latitude: input.latitude,
        longitude: input.longitude,
        accuracyMeters: input.accuracyMeters,
        speedKph: input.speedKph,
        headingDegrees: input.heading,
        altitudeMeters: input.altitudeMeters,
        source,
        isMoving: input.speedKph !== null && input.speedKph !== undefined ? input.speedKph >= 3 : undefined,
        batteryPercent: input.batteryLevel === undefined ? undefined : Math.round(input.batteryLevel * 100),
        recordedAt: input.capturedAt,
      },
    });
    await tx.trip.update({
      where: { id: trip.id },
      data: { lastLocationAt: now, trackingStatus: TrackingStatus.ACTIVE },
    });
    return created;
  });

  const payload = {
    tripId: trip.id,
    latitude: Number(location.latitude),
    longitude: Number(location.longitude),
    accuracyMeters: location.accuracyMeters === null ? null : Number(location.accuracyMeters),
    speedKph: location.speedKph === null ? null : Number(location.speedKph),
    heading: location.headingDegrees === null ? null : Number(location.headingDegrees),
    recordedAt: location.recordedAt,
    receivedAt: location.receivedAt,
  };
  emitToTrip(trip.id, 'trip:location', payload);
  void updateEtasAndNotify(trip.id, input).catch((error: unknown) =>
    logger.error({ err: error, tripId: trip.id }, 'ETA update failed after accepting GPS location'),
  );
  return { accepted: true, location: payload, recommendedIntervalSeconds: trip.locationIntervalSeconds };
};

export const listPassengers = async (tripId: string, actor: { userId: string; role: Role }) => {
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, select: { driverId: true, conductorId: true } });
  if (!trip) throw new AppError(404, 'TRIP_NOT_FOUND', 'Trip not found');
  assertAssigned(trip, actor);
  const bookings = await prisma.booking.findMany({
    where: { tripId, status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN, BookingStatus.COMPLETED] } },
    include: {
      student: { include: { user: { select: { id: true, name: true, phone: true } } } },
      seatAllocations: { include: { seat: true } },
      boardingStop: { include: { routeStop: { include: { stop: true } } } },
      checkIns: { where: { result: 'ACCEPTED' }, take: 1 },
    },
    orderBy: { bookingNumber: 'asc' },
  });
  return bookings.map((booking) => ({
    bookingId: booking.id,
    reference: booking.bookingNumber,
    student: {
      id: booking.student.user.id,
      name: booking.student.user.name,
      studentId: booking.student.studentNumber,
      phone: booking.student.user.phone,
    },
    seatNumber: booking.seatAllocations[0]?.seat.seatNumber,
    boardingStop: { id: booking.boardingStop.routeStop.stop.id, name: booking.boardingStop.routeStop.stop.name },
    checkedInAt: booking.checkIns[0]?.checkedInAt,
  }));
};

const severityMap = { LOW: AlertSeverity.MINOR, MEDIUM: AlertSeverity.MODERATE, HIGH: AlertSeverity.MAJOR, CRITICAL: AlertSeverity.CRITICAL } as const;

export const reportIncident = async (
  input: IncidentInput,
  actor: { userId: string; role: Role },
  image?: StoredIncidentImage,
) => {
  if (actor.role !== Role.DRIVER) throw new AppError(403, 'DRIVER_REQUIRED', 'Only the assigned driver may report an incident');
  if (input.tripId) {
    const trip = await prisma.trip.findUnique({ where: { id: input.tripId }, select: { driverId: true, conductorId: true } });
    if (!trip) throw new AppError(404, 'TRIP_NOT_FOUND', 'Trip not found');
    assertAssigned(trip, actor);
  } else {
    const profile = await prisma.driverProfile.findUnique({ where: { userId: actor.userId }, select: { userId: true } });
    if (!profile) throw new AppError(403, 'DRIVER_PROFILE_REQUIRED', 'A driver profile is required to report an incident');
  }
  const category =
    input.category === 'SAFETY'
      ? 'SECURITY'
      : input.category === 'VEHICLE'
        ? 'BREAKDOWN'
        : input.category === 'CONSTRUCTION'
          ? 'ROADBLOCK'
          : input.category;
  const incident = await prisma.driverIncident.create({
    data: {
      incidentNumber: `INC-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`,
      tripId: input.tripId,
      driverId: actor.userId,
      category,
      severity: severityMap[input.severity],
      status: IncidentStatus.OPEN,
      title: input.title,
      description: input.description,
      latitude: input.latitude,
      longitude: input.longitude,
      ...(image ? { attachments: { create: { url: image.url, mediaType: image.mediaType } } } : {}),
    },
    include: { attachments: true },
  });
  const admins = await prisma.user.findMany({ where: { role: Role.ADMIN, status: 'ACTIVE' }, select: { id: true } });
  await notifyUsers(
    admins.map(({ id }) => id),
    {
      type: input.category === 'EMERGENCY' ? NotificationType.EMERGENCY : NotificationType.SYSTEM,
      title: `${input.category === 'EMERGENCY' ? 'Emergency' : 'Driver incident'}: ${input.title}`,
      body: input.description,
      data: { incidentId: incident.id, tripId: input.tripId ?? null },
      dedupePrefix: `incident:${incident.id}`,
    },
  );
  emitToRole(Role.ADMIN, 'notification:new', { type: 'INCIDENT', incident });
  return incident;
};
