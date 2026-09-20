import { randomBytes } from 'node:crypto';
import {
  BookingStatus,
  BusStatus,
  NotificationType,
  PaymentStatus,
  Prisma,
  SeatAllocationStatus,
  SeatStatus,
  SubscriptionStatus,
  TripStatus,
} from '@prisma/client';
import { env } from '../../config/env.js';
import { lockBooking, lockBookings } from '../../lib/booking-lock.js';
import { AppError } from '../../lib/errors.js';
import { paginated, toPagination } from '../../lib/pagination.js';
import { logger } from '../../lib/logger.js';
import { assertBusHasNoMaintenanceConflict } from '../../lib/maintenance-window.js';
import { prisma } from '../../lib/prisma.js';
import { emitToTrip, emitToUser } from '../../realtime/hub.js';
import { notifyUser } from '../notifications/notification.service.js';
import { refundBookingPayments } from '../payments/payment.service.js';
import { BookingStateFactory } from './booking.state.js';
import type { z } from 'zod';
import type { bookingListSchema, createBookingSchema, finalizeSeatHoldSchema } from './booking.schemas.js';

type CreateBookingInput = z.infer<typeof createBookingSchema>;
type BookingListInput = z.infer<typeof bookingListSchema>;
type FinalizeSeatHoldInput = z.infer<typeof finalizeSeatHoldSchema>;

const activeBookingStatuses = [
  BookingStatus.HELD,
  BookingStatus.PENDING_PAYMENT,
  BookingStatus.CONFIRMED,
  BookingStatus.CHECKED_IN,
] as const;

const bookingNumber = (): string => {
  const day = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `BKG-${day}-${randomBytes(5).toString('hex').toUpperCase()}`;
};

const bookingInclude = {
  seatAllocations: { include: { seat: true } },
  boardingStop: { include: { routeStop: { include: { stop: true } } } },
  dropoffStop: { include: { routeStop: { include: { stop: true } } } },
  trip: {
    include: {
      route: true,
      bus: true,
      driver: { include: { user: { select: { id: true, name: true, phone: true } } } },
    },
  },
  payments: { orderBy: { createdAt: 'desc' as const }, take: 1 },
  checkIns: { where: { result: 'ACCEPTED' as const }, orderBy: { checkedInAt: 'desc' as const }, take: 1 },
} as const;

type BookingRecord = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

const paymentStatusDto = (status: PaymentStatus | undefined): string | undefined => {
  if (status === PaymentStatus.SUCCEEDED) return 'SUCCESS';
  return status;
};

const bookingDto = (booking: BookingRecord) => ({
  id: booking.id,
  reference: booking.bookingNumber,
  bookingNumber: booking.bookingNumber,
  studentId: booking.studentId,
  tripId: booking.tripId,
  trip: {
    id: booking.trip.id,
    routeId: booking.trip.routeId,
    route: booking.trip.route,
    busId: booking.trip.busId,
    bus: {
      id: booking.trip.bus.id,
      registrationNumber: booking.trip.bus.registrationNumber,
      label: booking.trip.bus.fleetNumber,
      capacity: booking.trip.bus.capacity,
      status: booking.trip.bus.status,
    },
    driver: {
      id: booking.trip.driver.user.id,
      name: booking.trip.driver.user.name,
      phone: booking.trip.driver.user.phone,
      averageRating: Number(booking.trip.driver.averageRating),
    },
    departureTime: booking.trip.scheduledStartAt,
    estimatedArrivalTime: booking.trip.scheduledEndAt,
    fare: Number(booking.trip.fareAmount),
    currency: booking.trip.currency,
    status: booking.trip.status,
    delayMinutes: booking.trip.delayMinutes,
  },
  seatId: booking.seatAllocations[0]?.seatId,
  seatNumber: booking.seatAllocations[0]?.seat.seatNumber,
  boardingStop: {
    id: booking.boardingStop.routeStop.stop.id,
    name: booking.boardingStop.routeStop.stop.name,
    latitude: Number(booking.boardingStop.routeStop.stop.latitude),
    longitude: Number(booking.boardingStop.routeStop.stop.longitude),
    sequence: booking.boardingStop.sequence,
  },
  destinationStop: {
    id: booking.dropoffStop.routeStop.stop.id,
    name: booking.dropoffStop.routeStop.stop.name,
    latitude: Number(booking.dropoffStop.routeStop.stop.latitude),
    longitude: Number(booking.dropoffStop.routeStop.stop.longitude),
    sequence: booking.dropoffStop.sequence,
  },
  status: ([BookingStatus.HELD, BookingStatus.PENDING_PAYMENT] as BookingStatus[]).includes(booking.status)
    ? 'PENDING'
    : booking.status,
  totalAmount: Number(booking.fareAmount),
  currency: booking.currency,
  paymentStatus:
    paymentStatusDto(booking.payments[0]?.status) ??
    (booking.status === BookingStatus.CONFIRMED ? 'SUCCESS' : undefined),
  checkedInAt: booking.checkIns[0]?.checkedInAt ?? booking.checkedInAt,
  holdExpiresAt: booking.holdExpiresAt,
  createdAt: booking.createdAt,
  confirmedAt: booking.confirmedAt,
  cancelledAt: booking.cancelledAt,
});

const expireStaleHolds = async (tx: Prisma.TransactionClient, tripId?: string): Promise<number> => {
  const now = new Date();
  const candidates = await tx.booking.findMany({
    where: {
      ...(tripId ? { tripId } : {}),
      status: { in: [BookingStatus.HELD, BookingStatus.PENDING_PAYMENT] },
      holdExpiresAt: { lte: now },
    },
    select: { id: true },
    take: 500,
  });
  if (!candidates.length) return 0;
  await lockBookings(tx, candidates.map(({ id }) => id));
  const stale = await tx.booking.findMany({
    where: {
      id: { in: candidates.map(({ id }) => id) },
      status: { in: [BookingStatus.HELD, BookingStatus.PENDING_PAYMENT] },
      holdExpiresAt: { lte: now },
    },
    select: { id: true },
  });
  if (!stale.length) return 0;
  const ids = stale.map(({ id }) => id);
  const expired = await tx.booking.updateMany({
    where: {
      id: { in: ids },
      status: { in: [BookingStatus.HELD, BookingStatus.PENDING_PAYMENT] },
      holdExpiresAt: { lte: now },
    },
    data: { status: BookingStatus.EXPIRED, version: { increment: 1 } },
  });
  await tx.seatAllocation.updateMany({
    where: { bookingId: { in: ids }, status: SeatAllocationStatus.HELD },
    data: { status: SeatAllocationStatus.EXPIRED, releasedAt: now, releaseReason: 'Booking hold expired' },
  });
  return expired.count;
};

export const expireBookingHolds = () => prisma.$transaction((tx) => expireStaleHolds(tx));

const withSerializableRetry = async <T>(operation: () => Promise<T>, attempts = 3): Promise<T> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error: unknown) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
      if (!retryable || attempt >= attempts) throw error;
    }
  }
};

export const createSeatHold = async (tripId: string, seatNumber: string, studentId: string) => {
  const held = await withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('seat-hold'), hashtext(${studentId + ':' + tripId})) IS NULL AS success`;
        await expireStaleHolds(tx, tripId);
        const trip = await tx.trip.findUnique({
          where: { id: tripId },
          include: {
            bus: { include: { seats: true } },
            stops: { orderBy: { sequence: 'asc' } },
          },
        });
        if (!trip) throw new AppError(404, 'TRIP_NOT_FOUND', 'Trip not found');
        if (!([TripStatus.SCHEDULED, TripStatus.BOARDING, TripStatus.DELAYED] as TripStatus[]).includes(trip.status)) {
          throw new AppError(409, 'TRIP_NOT_BOOKABLE', 'This trip is no longer accepting seat holds');
        }
        if (trip.bus.status !== BusStatus.ACTIVE) {
          throw new AppError(409, 'BUS_UNAVAILABLE', 'The assigned bus is not currently active');
        }
        await assertBusHasNoMaintenanceConflict(tx, {
          busId: trip.busId,
          startsAt: trip.scheduledStartAt,
          endsAt: trip.scheduledEndAt,
        });
        const bookingClosesAt = trip.bookingClosesAt ?? trip.scheduledStartAt;
        if (bookingClosesAt <= new Date()) {
          throw new AppError(409, 'BOOKING_CLOSED', 'Booking has closed for this trip');
        }
        if (trip.stops.length < 2) throw new AppError(409, 'TRIP_STOPS_MISSING', 'This trip does not have a valid stop sequence');
        const seat = trip.bus.seats.find((item) => item.seatNumber === seatNumber && item.status === SeatStatus.ACTIVE);
        if (!seat) throw new AppError(409, 'SEAT_UNAVAILABLE', 'The selected seat is unavailable');
        const existing = await tx.booking.findFirst({
          where: { studentId, tripId, status: { in: [...activeBookingStatuses] } },
          include: { seatAllocations: { where: { status: SeatAllocationStatus.HELD }, include: { seat: true } } },
        });
        if (existing && existing.status !== BookingStatus.HELD) {
          throw new AppError(409, 'DUPLICATE_BOOKING', 'You already have an active booking for this trip');
        }
        const previousSeatNumber = existing?.seatAllocations[0]?.seat.seatNumber;
        if (existing) {
          const releasedAt = new Date();
          await tx.booking.update({
            where: { id: existing.id },
            data: {
              status: BookingStatus.CANCELLED,
              cancelledAt: releasedAt,
              cancellationReason: 'Seat hold replaced',
              version: { increment: 1 },
            },
          });
          await tx.seatAllocation.updateMany({
            where: { bookingId: existing.id, status: SeatAllocationStatus.HELD },
            data: { status: SeatAllocationStatus.RELEASED, releasedAt, releaseReason: 'Seat hold replaced' },
          });
        }
        const expiresAt = new Date(Date.now() + env.BOOKING_HOLD_MINUTES * 60_000);
        const booking = await tx.booking.create({
          data: {
            bookingNumber: bookingNumber(),
            studentId,
            tripId,
            boardingTripStopId: trip.stops[0]!.id,
            dropoffTripStopId: trip.stops.at(-1)!.id,
            status: BookingStatus.HELD,
            fareAmount: trip.fareAmount,
            currency: trip.currency,
            holdExpiresAt: expiresAt,
          },
        });
        await tx.seatAllocation.create({
          data: { bookingId: booking.id, tripId, seatId: seat.id, status: SeatAllocationStatus.HELD },
        });
        return { id: booking.id, seatNumber: seat.seatNumber, expiresAt, previousSeatNumber };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 },
    ),
  );
  if (held.previousSeatNumber && held.previousSeatNumber !== held.seatNumber) {
    emitToTrip(tripId, 'trip:seats', {
      tripId,
      seat: { number: held.previousSeatNumber, status: 'AVAILABLE' },
      changedAt: new Date(),
    });
  }
  emitToTrip(tripId, 'trip:seats', {
    tripId,
    seat: { number: held.seatNumber, status: 'HELD', heldByCurrentUser: true },
    changedAt: new Date(),
  });
  return { id: held.id, seatNumber: held.seatNumber, expiresAt: held.expiresAt };
};

export const releaseSeatHold = async (tripId: string, holdId: string, studentId: string) => {
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    await lockBooking(tx, holdId);
    const hold = await tx.booking.findFirst({
      where: { id: holdId, tripId, studentId, status: BookingStatus.HELD },
      include: { seatAllocations: { include: { seat: true } } },
    });
    if (!hold) return null;
    await tx.booking.update({
      where: { id: hold.id },
      data: { status: BookingStatus.CANCELLED, cancelledAt: now, cancellationReason: 'Seat hold released', version: { increment: 1 } },
    });
    await tx.seatAllocation.updateMany({
      where: { bookingId: hold.id, status: SeatAllocationStatus.HELD },
      data: { status: SeatAllocationStatus.RELEASED, releasedAt: now, releaseReason: 'Seat hold released' },
    });
    return hold.seatAllocations[0]?.seat.seatNumber;
  });
  if (result) emitToTrip(tripId, 'trip:seats', { tripId, seat: { number: result, status: 'AVAILABLE' }, changedAt: now });
  return { released: Boolean(result) };
};

export const finalizeSeatHold = async (studentId: string, input: FinalizeSeatHoldInput, idempotencyKey?: string) => {
  if (idempotencyKey) {
    const existing = await prisma.booking.findUnique({ where: { idempotencyKey }, include: bookingInclude });
    if (existing) {
      if (existing.studentId !== studentId || existing.id !== input.seatHoldId || existing.tripId !== input.tripId) {
        throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'That idempotency key is already in use');
      }
      return bookingDto(existing);
    }
  }

  let finalized: BookingRecord;
  try {
    const finalizedId = await prisma.$transaction(
      async (tx) => {
      const now = new Date();
      await expireStaleHolds(tx, input.tripId);
      await lockBooking(tx, input.seatHoldId);
      const booking = await tx.booking.findFirst({
        where: {
          id: input.seatHoldId,
          tripId: input.tripId,
          studentId,
          status: BookingStatus.HELD,
          holdExpiresAt: { gt: now },
        },
        include: {
          trip: {
            include: {
              bus: { select: { status: true } },
              stops: { include: { routeStop: true }, orderBy: { sequence: 'asc' } },
            },
          },
          seatAllocations: { include: { seat: true } },
        },
      });
      if (!booking) throw new AppError(409, 'SEAT_HOLD_EXPIRED', 'The seat hold has expired; choose the seat again');
      if (!([TripStatus.SCHEDULED, TripStatus.BOARDING, TripStatus.DELAYED] as TripStatus[]).includes(booking.trip.status)) {
        throw new AppError(409, 'TRIP_NOT_BOOKABLE', 'This trip is no longer accepting bookings');
      }
      const bookingClosesAt = booking.trip.bookingClosesAt ?? booking.trip.scheduledStartAt;
      if (bookingClosesAt <= now) {
        throw new AppError(409, 'BOOKING_CLOSED', 'Booking has closed for this trip');
      }
      if (booking.trip.bus.status !== BusStatus.ACTIVE) {
        throw new AppError(409, 'BUS_UNAVAILABLE', 'The assigned bus is not currently active');
      }
      await assertBusHasNoMaintenanceConflict(tx, {
        busId: booking.trip.busId,
        startsAt: booking.trip.scheduledStartAt,
        endsAt: booking.trip.scheduledEndAt,
      });
      if (booking.seatAllocations[0]?.status !== SeatAllocationStatus.HELD) {
        throw new AppError(409, 'SEAT_HOLD_EXPIRED', 'The seat hold is no longer active');
      }
      if (booking.seatAllocations[0]?.seat.seatNumber !== input.seatNumber) {
        throw new AppError(409, 'SEAT_HOLD_MISMATCH', 'The seat hold does not match the selected seat');
      }
      const boarding = booking.trip.stops.find(
        (stop) => stop.id === input.boardingStopId || stop.routeStop.stopId === input.boardingStopId,
      );
      const dropoff = booking.trip.stops.find(
        (stop) => stop.id === input.destinationStopId || stop.routeStop.stopId === input.destinationStopId,
      );
      if (!boarding || !dropoff || boarding.sequence >= dropoff.sequence) {
        throw new AppError(400, 'INVALID_STOP_ORDER', 'Boarding must be before the destination on this trip');
      }
      let subscription = null;
      if (input.subscriptionId) {
        subscription = await tx.studentSubscription.findFirst({
          where: {
            id: input.subscriptionId,
            studentId,
            status: SubscriptionStatus.ACTIVE,
            startsAt: { lte: new Date() },
            endsAt: { gt: new Date() },
            OR: [{ remainingTrips: null }, { remainingTrips: { gt: 0 } }],
            plan: { routes: { some: { routeId: booking.trip.routeId } } },
          },
        });
        if (!subscription) throw new AppError(409, 'SUBSCRIPTION_INVALID', 'The selected subscription is not valid for this route');
      }
      const requiresPayment = !subscription && Number(booking.fareAmount) > 0;
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          boardingTripStopId: boarding.id,
          dropoffTripStopId: dropoff.id,
          subscriptionId: subscription?.id,
          idempotencyKey,
          status: requiresPayment ? BookingStatus.PENDING_PAYMENT : BookingStatus.CONFIRMED,
          fareAmount: subscription ? 0 : booking.fareAmount,
          confirmedAt: requiresPayment ? null : now,
          holdExpiresAt: requiresPayment ? booking.holdExpiresAt : null,
          version: { increment: 1 },
        },
      });
      if (!requiresPayment) {
        await tx.seatAllocation.updateMany({
          where: { bookingId: booking.id, status: SeatAllocationStatus.HELD },
          data: { status: SeatAllocationStatus.CONFIRMED },
        });
      }
      if (subscription?.remainingTrips !== null && subscription?.remainingTrips !== undefined) {
        const used = await tx.studentSubscription.updateMany({
          where: { id: subscription.id, remainingTrips: { gt: 0 } },
          data: { remainingTrips: { decrement: 1 } },
        });
        if (used.count !== 1) throw new AppError(409, 'SUBSCRIPTION_EXHAUSTED', 'The subscription has no trips remaining');
      }
      return booking.id;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 },
    );
    finalized = await prisma.booking.findUniqueOrThrow({ where: { id: finalizedId }, include: bookingInclude });
  } catch (error: unknown) {
    if (idempotencyKey) {
      const existing = await prisma.booking.findUnique({ where: { idempotencyKey }, include: bookingInclude });
      if (existing && existing.studentId === studentId && existing.id === input.seatHoldId) {
        finalized = existing;
      } else {
        throw error;
      }
    } else {
      throw error;
    }
  }
  const result = bookingDto(finalized);
  await notifyUser({
    userId: studentId,
    type: finalized.status === BookingStatus.CONFIRMED ? NotificationType.BOOKING_CONFIRMED : NotificationType.SYSTEM,
    title: finalized.status === BookingStatus.CONFIRMED ? 'Booking confirmed' : 'Booking ready for payment',
    body:
      finalized.status === BookingStatus.CONFIRMED
        ? `Booking ${finalized.bookingNumber} is confirmed.`
        : `Complete payment for ${finalized.bookingNumber} before the hold expires.`,
    data: { bookingId: finalized.id, tripId: finalized.tripId },
    dedupeKey: `booking-finalized:${finalized.id}`,
  });
  emitToUser(studentId, 'booking:updated', result);
  return result;
};

export const createBooking = async ({
  studentId,
  input,
  idempotencyKey,
}: {
  studentId: string;
  input: CreateBookingInput;
  idempotencyKey?: string;
}) => {
  if (idempotencyKey) {
    const existing = await prisma.booking.findUnique({ where: { idempotencyKey }, include: bookingInclude });
    if (existing) {
      if (existing.studentId !== studentId) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'That idempotency key is already in use');
      return bookingDto(existing);
    }
  }

  let created;
  try {
    created = await withSerializableRetry(() =>
      prisma.$transaction(
        async (tx) => {
          await expireStaleHolds(tx, input.tripId);
          const trip = await tx.trip.findUnique({
            where: { id: input.tripId },
            include: {
              bus: { include: { seats: true } },
              stops: { include: { routeStop: true }, orderBy: { sequence: 'asc' } },
            },
          });
          if (!trip) throw new AppError(404, 'TRIP_NOT_FOUND', 'Trip not found');
          if (!([TripStatus.SCHEDULED, TripStatus.BOARDING, TripStatus.DELAYED] as TripStatus[]).includes(trip.status)) {
            throw new AppError(409, 'TRIP_NOT_BOOKABLE', 'This trip is no longer accepting bookings');
          }
          if (trip.bus.status !== BusStatus.ACTIVE) {
            throw new AppError(409, 'BUS_UNAVAILABLE', 'The assigned bus is not currently active');
          }
          await assertBusHasNoMaintenanceConflict(tx, {
            busId: trip.busId,
            startsAt: trip.scheduledStartAt,
            endsAt: trip.scheduledEndAt,
          });
          if (trip.bookingClosesAt && trip.bookingClosesAt <= new Date()) {
            throw new AppError(409, 'BOOKING_CLOSED', 'Booking has closed for this trip');
          }
          const seat = trip.bus.seats.find((candidate) => candidate.id === input.seatId);
          if (!seat || seat.status !== SeatStatus.ACTIVE) {
            throw new AppError(409, 'SEAT_UNAVAILABLE', 'The selected seat is unavailable');
          }
          const boarding = trip.stops.find(
            (stop) => stop.id === input.pickupStopId || stop.routeStop.stopId === input.pickupStopId,
          );
          const dropoff = trip.stops.find(
            (stop) => stop.id === input.dropoffStopId || stop.routeStop.stopId === input.dropoffStopId,
          );
          if (!boarding || !dropoff || boarding.sequence >= dropoff.sequence) {
            throw new AppError(400, 'INVALID_STOP_ORDER', 'Boarding must be before the destination on this trip');
          }
          const existingTripBooking = await tx.booking.findFirst({
            where: { studentId, tripId: trip.id, status: { in: [...activeBookingStatuses] } },
            select: { id: true },
          });
          if (existingTripBooking) throw new AppError(409, 'DUPLICATE_BOOKING', 'You already have an active booking for this trip');

          let subscription: Awaited<ReturnType<typeof tx.studentSubscription.findFirst>> = null;
          if (input.subscriptionId) {
            subscription = await tx.studentSubscription.findFirst({
              where: {
                id: input.subscriptionId,
                studentId,
                status: SubscriptionStatus.ACTIVE,
                startsAt: { lte: new Date() },
                endsAt: { gt: new Date() },
                OR: [{ remainingTrips: null }, { remainingTrips: { gt: 0 } }],
                plan: { routes: { some: { routeId: trip.routeId } } },
              },
            });
            if (!subscription) {
              throw new AppError(409, 'SUBSCRIPTION_INVALID', 'The selected subscription is not valid for this route');
            }
          }

          const requiresPayment = !subscription && Number(trip.fareAmount) > 0;
          const now = new Date();
          const holdExpiresAt = requiresPayment ? new Date(now.getTime() + env.BOOKING_HOLD_MINUTES * 60_000) : null;
          const booking = await tx.booking.create({
            data: {
              bookingNumber: bookingNumber(),
              studentId,
              tripId: trip.id,
              boardingTripStopId: boarding.id,
              dropoffTripStopId: dropoff.id,
              subscriptionId: subscription?.id,
              status: requiresPayment ? BookingStatus.PENDING_PAYMENT : BookingStatus.CONFIRMED,
              idempotencyKey,
              fareAmount: subscription ? 0 : trip.fareAmount,
              currency: trip.currency,
              holdExpiresAt,
              confirmedAt: requiresPayment ? null : now,
            },
          });
          await tx.seatAllocation.create({
            data: {
              bookingId: booking.id,
              tripId: trip.id,
              seatId: seat.id,
              status: requiresPayment ? SeatAllocationStatus.HELD : SeatAllocationStatus.CONFIRMED,
            },
          });
          if (subscription?.remainingTrips !== null && subscription?.remainingTrips !== undefined) {
            const decremented = await tx.studentSubscription.updateMany({
              where: { id: subscription.id, remainingTrips: { gt: 0 } },
              data: { remainingTrips: { decrement: 1 } },
            });
            if (decremented.count !== 1) throw new AppError(409, 'SUBSCRIPTION_EXHAUSTED', 'The subscription has no trips remaining');
          }
          return tx.booking.findUniqueOrThrow({ where: { id: booking.id }, include: bookingInclude });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const rawTarget = error.meta?.target;
      const target = Array.isArray(rawTarget)
        ? rawTarget.filter((item): item is string => typeof item === 'string').join(',')
        : typeof rawTarget === 'string'
          ? rawTarget
          : '';
      if (target.includes('seat') || target.includes('active')) {
        throw new AppError(409, 'SEAT_UNAVAILABLE', 'That seat was just booked by someone else');
      }
    }
    throw error;
  }

  const result = bookingDto(created);
  const confirmed = created.status === BookingStatus.CONFIRMED;
  await notifyUser({
    userId: studentId,
    type: confirmed ? NotificationType.BOOKING_CONFIRMED : NotificationType.SYSTEM,
    title: confirmed ? 'Booking confirmed' : 'Seat held for payment',
    body: confirmed
      ? `Booking ${created.bookingNumber} is confirmed.`
      : `Complete payment for ${created.bookingNumber} before ${created.holdExpiresAt?.toLocaleTimeString()}.`,
    data: { bookingId: created.id, tripId: created.tripId, actionUrl: `/student/bookings/${created.id}` },
    dedupeKey: `booking-created:${created.id}`,
  });
  emitToTrip(created.tripId, 'trip:seats', { tripId: created.tripId, changedAt: new Date() });
  emitToUser(studentId, 'booking:updated', result);
  return result;
};

export const listBookings = async (studentId: string, query: BookingListInput) => {
  await prisma.$transaction((tx) => expireStaleHolds(tx));
  let statusFilter: Prisma.BookingWhereInput['status'];
  if (query.status === 'PENDING') {
    statusFilter = { in: [BookingStatus.HELD, BookingStatus.PENDING_PAYMENT] };
  } else if (query.status && query.status !== 'ALL' && query.status !== 'UPCOMING') {
    statusFilter = query.status;
  }
  const upcoming = query.upcoming || query.status === 'UPCOMING';
  const where: Prisma.BookingWhereInput = {
    studentId,
    ...(query.unrated ? { rating: null } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(upcoming
      ? {
          status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] },
          trip: { scheduledStartAt: { gte: new Date() } },
        }
      : {}),
    ...(query.from || query.to
      ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.booking.findMany({
      where,
      include: bookingInclude,
      ...toPagination({ page: query.page, pageSize: query.limit ?? query.pageSize }),
      orderBy: upcoming ? { trip: { scheduledStartAt: 'asc' } } : { createdAt: 'desc' },
    }),
    prisma.booking.count({ where }),
  ]);
  return paginated(items.map(bookingDto), total, query.page, query.limit ?? query.pageSize);
};

export const getBooking = async (bookingId: string, requester: { userId: string; isAdmin: boolean }) => {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, ...(requester.isAdmin ? {} : { studentId: requester.userId }) },
    include: bookingInclude,
  });
  if (!booking) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
  return bookingDto(booking);
};

export const cancelBooking = async ({ bookingId, studentId, reason, isAdmin = false }: { bookingId: string; studentId?: string; reason: string; isAdmin?: boolean }) => {
  const now = new Date();
  const cancelled = await prisma.$transaction(
    async (tx) => {
      await lockBooking(tx, bookingId);
      const booking = await tx.booking.findFirst({
        where: { id: bookingId, ...(isAdmin ? {} : { studentId }) },
        include: { payments: { where: { status: PaymentStatus.SUCCEEDED } }, subscription: true },
      });
      if (!booking) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
      const currentState = BookingStateFactory.getState(booking.status);
      const transition = currentState.cancel({ now, reason });
      
      const nextStatus = booking.payments.length ? BookingStatus.REFUND_PENDING : transition.status as BookingStatus;
      const updated = await tx.booking.update({
        where: { id: booking.id, version: booking.version },
        data: {
          ...transition,
          status: nextStatus,
          qrCodes: {
            updateMany: {
              where: { status: 'ACTIVE' },
              data: { status: 'REVOKED', revokedAt: now, revokeReason: 'Booking cancelled' },
            },
          },
        },
      });
      if (booking.subscriptionId && booking.subscription?.remainingTrips !== null) {
        await tx.studentSubscription.update({
          where: { id: booking.subscriptionId },
          data: { remainingTrips: { increment: 1 } },
        });
      }
      if (booking.payments.length) {
        await tx.payment.updateMany({
          where: { bookingId: booking.id, status: PaymentStatus.SUCCEEDED },
          data: { status: PaymentStatus.REFUND_PENDING },
        });
      }
      return updated;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 },
  );

  await notifyUser({
    userId: cancelled.studentId,
    type: NotificationType.BOOKING_CANCELLED,
    title: 'Booking cancelled',
    body: `Booking ${cancelled.bookingNumber} was cancelled${cancelled.status === BookingStatus.REFUND_PENDING ? '; its refund is being processed' : ''}.`,
    data: { bookingId: cancelled.id, tripId: cancelled.tripId },
    dedupeKey: `booking-cancelled:${cancelled.id}`,
  });
  emitToTrip(cancelled.tripId, 'trip:seats', { tripId: cancelled.tripId, changedAt: now });
  emitToUser(cancelled.studentId, 'booking:updated', { id: cancelled.id, status: cancelled.status });
  if (cancelled.status === BookingStatus.REFUND_PENDING) {
    try {
      await refundBookingPayments(cancelled.id, reason);
    } catch (error: unknown) {
      logger.warn({ err: error, bookingId: cancelled.id }, 'Automatic booking refund remains pending');
    }
  }
  return {
    ...(await getBooking(cancelled.id, { userId: cancelled.studentId, isAdmin: true })),
    refundRequired: cancelled.status === BookingStatus.REFUND_PENDING,
  };
};
