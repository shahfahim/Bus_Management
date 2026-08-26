import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  BookingSource,
  BookingStatus,
  BusStatus,
  CheckInResult,
  DriverStatus,
  NotificationType,
  PaymentStatus,
  Prisma,
  QrCodeStatus,
  Role,
  SeatAllocationStatus,
  SeatStatus,
  TripStatus,
  UserStatus,
} from '@prisma/client';
import type { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { lockBooking } from '../../lib/booking-lock.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { sha256 } from '../../lib/security.js';
import { disconnectUserSockets } from '../../realtime/hub.js';
import { notifyUser } from '../notifications/notification.service.js';
import { refundBookingPayments } from '../payments/payment.service.js';
import { listRatings, moderateRating } from '../ratings/rating.service.js';
import type { AuditContext } from './audit.service.js';
import { writeAuditLog } from './audit.service.js';
import type {
  bookingQuerySchema,
  checkInQuerySchema,
  createAdminBookingSchema,
  createManualCheckInSchema,
  createUserSchema,
  moderateAdminRatingSchema,
  ratingQuerySchema,
  updateAdminBookingSchema,
  updateUserSchema,
  userQuerySchema,
} from './admin.schemas.js';
import { checkInResultForFilter } from './admin.schemas.js';

type UserQuery = z.infer<typeof userQuerySchema>;
type CreateUser = z.infer<typeof createUserSchema>;
type UpdateUser = z.infer<typeof updateUserSchema>;
type BookingQuery = z.infer<typeof bookingQuerySchema>;
type CreateBooking = z.infer<typeof createAdminBookingSchema>;
type UpdateBooking = z.infer<typeof updateAdminBookingSchema>;
type CheckInQuery = z.infer<typeof checkInQuerySchema>;
type CreateCheckIn = z.infer<typeof createManualCheckInSchema>;
type RatingQuery = z.infer<typeof ratingQuerySchema>;
type ModerateRating = z.infer<typeof moderateAdminRatingSchema>;

const pageResult = <T>(items: T[], total: number, page: number, pageSize: number) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    items,
    pagination: { page, pageSize, total, pages: totalPages, totalPages },
    meta: { page, pageSize, total, totalPages },
  };
};

const userInclude = {
  studentProfile: true,
  driverProfile: true,
  _count: { select: { payments: true, notifications: true, sessions: true } },
} as const;

type UserRecord = Prisma.UserGetPayload<{ include: typeof userInclude }>;

const userStatusDto = (status: UserStatus): string =>
  status === UserStatus.DEACTIVATED ? 'inactive' : status.toLowerCase();

const userDto = (user: UserRecord) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  avatarUrl: user.avatarUrl,
  role: user.role.toLowerCase(),
  status: userStatusDto(user.status),
  identifier: user.studentProfile?.studentNumber ?? user.driverProfile?.employeeNumber ?? null,
  lastLoginAt: user.lastLoginAt,
  emailVerifiedAt: user.emailVerifiedAt,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
  deletedAt: user.deletedAt,
  studentProfile: user.studentProfile,
  driverProfile: user.driverProfile
    ? {
        ...user.driverProfile,
        status: user.driverProfile.status.toLowerCase(),
        averageRating: Number(user.driverProfile.averageRating),
      }
    : null,
});

export const listAdminUsers = async (query: UserQuery) => {
  const pageSize = query.pageSize ?? query.limit;
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    ...(query.role ? { role: query.role } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
            { phone: { contains: query.search, mode: 'insensitive' } },
            { studentProfile: { studentNumber: { contains: query.search, mode: 'insensitive' } } },
            { driverProfile: { employeeNumber: { contains: query.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
  const sortMap: Record<string, Prisma.UserOrderByWithRelationInput> = {
    name: { name: query.order },
    email: { email: query.order },
    role: { role: query.order },
    status: { status: query.order },
    lastLoginAt: { lastLoginAt: query.order },
  };
  const orderBy = (query.sort ? sortMap[query.sort] : undefined) ?? { createdAt: 'desc' as const };
  const [items, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      include: userInclude,
      skip: (query.page - 1) * pageSize,
      take: pageSize,
      orderBy,
    }),
    prisma.user.count({ where }),
  ]);
  return pageResult(items.map((item) => userDto(item)), total, query.page, pageSize);
};

export const getAdminUser = async (id: string) => {
  const user = await prisma.user.findFirst({ where: { id, deletedAt: null }, include: userInclude });
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  return userDto(user);
};

export const createAdminUser = async (input: CreateUser, context: AuditContext) => {
  const passwordHash = await bcrypt.hash(input.temporaryPassword, 12);
  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: input.name,
        email: input.email.toLowerCase(),
        phone: input.phone,
        role: input.role,
        status: input.status,
        passwordHash,
        emailVerifiedAt: input.status === UserStatus.ACTIVE ? new Date() : undefined,
        studentProfile:
          input.role === Role.STUDENT || input.role === Role.TEACHER
            ? { create: { studentNumber: input.identifier } }
            : undefined,
        driverProfile:
          input.role === Role.DRIVER
            ? {
                create: {
                  employeeNumber: input.identifier,
                  licenseNumber: input.licenseNumber!,
                  licenseExpiresAt: input.licenseExpiresAt!,
                  status: input.status === UserStatus.ACTIVE ? DriverStatus.ACTIVE : DriverStatus.INACTIVE,
                },
              }
            : undefined,
      },
      include: userInclude,
    });
    await writeAuditLog({
      context,
      action: 'user.create',
      entityType: 'User',
      entityId: user.id,
      after: userDto(user),
      metadata: input.role === Role.CONDUCTOR || input.role === Role.ADMIN ? { externalIdentifier: input.identifier } : undefined,
      client: tx,
    });
    return user;
  });
  return userDto(created);
};

const protectAdminMutation = async (
  tx: Prisma.TransactionClient,
  target: { id: string; role: Role; status: UserStatus },
  context: AuditContext,
  next?: { role?: Role; status?: UserStatus },
) => {
  if (target.id === context.actorId && (next?.role && next.role !== Role.ADMIN)) {
    throw new AppError(409, 'CANNOT_REMOVE_OWN_ADMIN_ROLE', 'You cannot remove your own administrator role');
  }
  if (target.id === context.actorId && next?.status && next.status !== UserStatus.ACTIVE) {
    throw new AppError(409, 'CANNOT_DISABLE_SELF', 'You cannot disable your own administrator account');
  }
  if (
    target.role === Role.ADMIN &&
    target.status === UserStatus.ACTIVE &&
    ((next?.role && next.role !== Role.ADMIN) || (next?.status && next.status !== UserStatus.ACTIVE))
  ) {
    const activeAdmins = await tx.user.count({ where: { role: Role.ADMIN, status: UserStatus.ACTIVE, deletedAt: null } });
    if (activeAdmins <= 1) throw new AppError(409, 'LAST_ADMIN', 'The last active administrator cannot be disabled');
  }
};

export const updateAdminUser = async (id: string, input: UpdateUser, context: AuditContext) => {
  const updated = await prisma.$transaction(async (tx) => {
    const before = await tx.user.findFirst({ where: { id, deletedAt: null }, include: userInclude });
    if (!before) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    if (input.role && input.role !== before.role) {
      throw new AppError(409, 'USER_ROLE_IMMUTABLE', 'Role changes require a dedicated identity migration and are not supported by this endpoint');
    }
    await protectAdminMutation(tx, before, context, { role: input.role, status: input.status });
    if (input.identifier && (before.role === Role.STUDENT || before.role === Role.TEACHER)) {
      await tx.studentProfile.update({ where: { userId: id }, data: { studentNumber: input.identifier } });
    } else if (before.role === Role.DRIVER && (input.identifier || input.licenseNumber || input.licenseExpiresAt || input.driverStatus || input.status)) {
      await tx.driverProfile.update({
        where: { userId: id },
        data: {
          employeeNumber: input.identifier,
          licenseNumber: input.licenseNumber,
          licenseExpiresAt: input.licenseExpiresAt,
          status: input.driverStatus ?? (input.status === UserStatus.ACTIVE ? DriverStatus.ACTIVE : input.status ? DriverStatus.INACTIVE : undefined),
        },
      });
    }
    const user = await tx.user.update({
      where: { id },
      data: {
        name: input.name,
        email: input.email?.toLowerCase(),
        phone: input.phone,
        status: input.status,
        emailVerifiedAt:
          input.status === UserStatus.ACTIVE && before.status !== UserStatus.ACTIVE ? new Date() : undefined,
        failedLoginAttempts: input.status === UserStatus.ACTIVE ? 0 : undefined,
        lockedUntil: input.status === UserStatus.ACTIVE ? null : undefined,
        sessions:
          input.status && input.status !== UserStatus.ACTIVE
            ? { updateMany: { where: { revokedAt: null }, data: { revokedAt: new Date(), revocationReason: 'Account disabled by administrator' } } }
            : undefined,
      },
      include: userInclude,
    });
    await writeAuditLog({
      context,
      action: 'user.update',
      entityType: 'User',
      entityId: id,
      before: userDto(before),
      after: userDto(user),
      metadata: before.role === Role.CONDUCTOR || before.role === Role.ADMIN ? { externalIdentifier: input.identifier } : undefined,
      client: tx,
    });
    return user;
  });
  if (updated.status !== UserStatus.ACTIVE) disconnectUserSockets(updated.id);
  return userDto(updated);
};

export const deleteAdminUser = async (id: string, context: AuditContext): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    const before = await tx.user.findFirst({ where: { id, deletedAt: null }, include: userInclude });
    if (!before) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    await protectAdminMutation(tx, before, context, { status: UserStatus.DEACTIVATED });
    const now = new Date();
    await tx.user.update({
      where: { id },
      data: {
        status: UserStatus.DEACTIVATED,
        deletedAt: now,
        sessions: { updateMany: { where: { revokedAt: null }, data: { revokedAt: now, revocationReason: 'Account removed by administrator' } } },
      },
    });
    await writeAuditLog({ context, action: 'user.deactivate', entityType: 'User', entityId: id, before: userDto(before), client: tx });
  });
  disconnectUserSockets(id);
};

const bookingInclude = {
  student: { include: { user: { select: { id: true, name: true, email: true, status: true } } } },
  trip: {
    include: {
      route: { select: { id: true, code: true, name: true } },
      bus: { select: { id: true, fleetNumber: true, registrationNumber: true } },
    },
  },
  boardingStop: { include: { routeStop: { include: { stop: true } } } },
  dropoffStop: { include: { routeStop: { include: { stop: true } } } },
  seatAllocations: { include: { seat: true } },
  payments: { select: { id: true, paymentNumber: true, status: true, amount: true } },
  _count: { select: { checkIns: true, qrCodes: true } },
} as const;

type BookingRecord = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

const bookingStatusDto = (status: BookingStatus): string =>
  status === BookingStatus.PENDING_PAYMENT ? 'pending' : status.toLowerCase();

const bookingDto = (booking: BookingRecord) => ({
  ...booking,
  reference: booking.bookingNumber,
  studentId: booking.studentId,
  seatNumber: booking.seatAllocations.find(({ status }) => status !== SeatAllocationStatus.RELEASED)?.seat.seatNumber ?? booking.seatAllocations[0]?.seat.seatNumber ?? null,
  seatAllocations: booking.seatAllocations.map(({ seat }) => seat.seatNumber),
  fareAmount: Number(booking.fareAmount),
  amount: Number(booking.fareAmount),
  status: bookingStatusDto(booking.status),
  source: booking.source.toLowerCase(),
  trip: {
    ...booking.trip,
    reference: booking.trip.publicCode,
    status: booking.trip.status.toLowerCase(),
    scheduledStart: booking.trip.scheduledStartAt,
  },
  student: {
    id: booking.studentId,
    name: booking.student.user.name,
    email: booking.student.user.email,
    identifier: booking.student.studentNumber,
    user: booking.student.user,
  },
});

export const listAdminBookings = async (query: BookingQuery) => {
  const pageSize = query.pageSize ?? query.limit;
  const where: Prisma.BookingWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.tripId ? { tripId: query.tripId } : {}),
    ...(query.studentId ? { studentId: query.studentId } : {}),
    ...(query.search
      ? {
          OR: [
            { bookingNumber: { contains: query.search, mode: 'insensitive' } },
            { student: { user: { name: { contains: query.search, mode: 'insensitive' } } } },
            { student: { studentNumber: { contains: query.search, mode: 'insensitive' } } },
            { trip: { publicCode: { contains: query.search, mode: 'insensitive' } } },
            { seatAllocations: { some: { seat: { seatNumber: { contains: query.search, mode: 'insensitive' } } } } },
          ],
        }
      : {}),
  };
  const sortMap: Record<string, Prisma.BookingOrderByWithRelationInput> = {
    bookingNumber: { bookingNumber: query.order },
    createdAt: { createdAt: query.order },
    status: { status: query.order },
  };
  const orderBy = (query.sort ? sortMap[query.sort] : undefined) ?? { createdAt: 'desc' as const };
  const [items, total] = await prisma.$transaction([
    prisma.booking.findMany({
      where,
      include: bookingInclude,
      skip: (query.page - 1) * pageSize,
      take: pageSize,
      orderBy,
    }),
    prisma.booking.count({ where }),
  ]);
  return pageResult(items.map((item) => bookingDto(item)), total, query.page, pageSize);
};

export const getAdminBooking = async (id: string) => {
  const booking = await prisma.booking.findUnique({ where: { id }, include: bookingInclude });
  if (!booking) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
  return bookingDto(booking);
};

const bookingNumber = (): string =>
  `BKG-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(5).toString('hex').toUpperCase()}`;

export const createAdminBooking = async (input: CreateBooking, context: AuditContext) => {
  if (!([BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED] as BookingStatus[]).includes(input.status)) {
    throw new AppError(400, 'INVALID_INITIAL_BOOKING_STATUS', 'An admin booking must begin pending payment or confirmed');
  }
  const created = await prisma.$transaction(
    async (tx) => {
      const [student, trip] = await Promise.all([
        tx.studentProfile.findUnique({ where: { userId: input.studentId }, include: { user: true } }),
        tx.trip.findUnique({
          where: { id: input.tripId },
          include: {
            bus: { include: { seats: true } },
            stops: { orderBy: { sequence: 'asc' } },
          },
        }),
      ]);
      if (!student || student.user.status !== UserStatus.ACTIVE) throw new AppError(404, 'STUDENT_NOT_FOUND', 'Active student not found');
      if (!trip) throw new AppError(404, 'TRIP_NOT_FOUND', 'Trip not found');
      if (!([TripStatus.SCHEDULED, TripStatus.BOARDING, TripStatus.DELAYED] as TripStatus[]).includes(trip.status)) {
        throw new AppError(409, 'TRIP_NOT_BOOKABLE', 'This trip is not accepting bookings');
      }
      if (trip.bus.status !== BusStatus.ACTIVE) throw new AppError(409, 'BUS_UNAVAILABLE', 'The assigned bus is unavailable');
      if (trip.stops.length < 2) throw new AppError(409, 'TRIP_STOPS_REQUIRED', 'The trip needs at least two stops');
      const seat = trip.bus.seats.find(({ seatNumber }) => seatNumber.toLowerCase() === input.seatNumber.toLowerCase());
      if (!seat || seat.status !== SeatStatus.ACTIVE) throw new AppError(409, 'SEAT_UNAVAILABLE', 'The selected seat is unavailable');
      const now = new Date();
      const booking = await tx.booking.create({
        data: {
          bookingNumber: bookingNumber(),
          studentId: input.studentId,
          tripId: input.tripId,
          boardingTripStopId: trip.stops[0]!.id,
          dropoffTripStopId: trip.stops.at(-1)!.id,
          status: input.status,
          source: BookingSource.ADMIN,
          fareAmount: trip.fareAmount,
          currency: trip.currency,
          holdExpiresAt:
            input.status === BookingStatus.PENDING_PAYMENT
              ? new Date(now.getTime() + env.BOOKING_HOLD_MINUTES * 60_000)
              : null,
          confirmedAt: input.status === BookingStatus.CONFIRMED ? now : null,
        },
      });
      await tx.seatAllocation.create({
        data: {
          bookingId: booking.id,
          tripId: trip.id,
          seatId: seat.id,
          status: input.status === BookingStatus.CONFIRMED ? SeatAllocationStatus.CONFIRMED : SeatAllocationStatus.HELD,
        },
      });
      const complete = await tx.booking.findUniqueOrThrow({ where: { id: booking.id }, include: bookingInclude });
      await writeAuditLog({
        context,
        action: 'booking.create',
        entityType: 'Booking',
        entityId: booking.id,
        after: complete,
        metadata: { reason: input.adminNote },
        client: tx,
      });
      return complete;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  await notifyUser({
    userId: created.studentId,
    type: created.status === BookingStatus.CONFIRMED ? NotificationType.BOOKING_CONFIRMED : NotificationType.SYSTEM,
    title: created.status === BookingStatus.CONFIRMED ? 'Booking confirmed' : 'Booking pending payment',
    body: `An administrator created booking ${created.bookingNumber} for you.`,
    data: { bookingId: created.id, tripId: created.tripId },
    dedupeKey: `admin-booking-created:${created.id}`,
  });
  return bookingDto(created);
};

const cancelBookingInTransaction = async (
  tx: Prisma.TransactionClient,
  booking: BookingRecord,
  reason: string,
) => {
  if (!([BookingStatus.HELD, BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED] as BookingStatus[]).includes(booking.status)) {
    throw new AppError(409, 'BOOKING_NOT_CANCELLABLE', 'This booking can no longer be cancelled');
  }
  const now = new Date();
  const paid = booking.payments.some(({ status }) => status === PaymentStatus.SUCCEEDED);
  const status = paid ? BookingStatus.REFUND_PENDING : BookingStatus.CANCELLED;
  await tx.booking.update({
    where: { id: booking.id },
    data: {
      status,
      cancelledAt: now,
      cancellationReason: reason,
      version: { increment: 1 },
    },
  });
  await tx.seatAllocation.updateMany({
    where: { bookingId: booking.id, status: { in: [SeatAllocationStatus.HELD, SeatAllocationStatus.CONFIRMED] } },
    data: { status: SeatAllocationStatus.RELEASED, releasedAt: now, releaseReason: reason.slice(0, 255) },
  });
  await tx.bookingQrCode.updateMany({
    where: { bookingId: booking.id, status: QrCodeStatus.ACTIVE },
    data: { status: QrCodeStatus.REVOKED, revokedAt: now, revokeReason: 'Booking cancelled by administrator' },
  });
  if (paid) {
    await tx.payment.updateMany({
      where: { bookingId: booking.id, status: PaymentStatus.SUCCEEDED },
      data: { status: PaymentStatus.REFUND_PENDING },
    });
  }
  if (booking.subscriptionId) {
    const subscription = await tx.studentSubscription.findUnique({ where: { id: booking.subscriptionId } });
    if (subscription && subscription.remainingTrips !== null) {
      await tx.studentSubscription.update({ where: { id: subscription.id }, data: { remainingTrips: { increment: 1 } } });
    }
  }
  return { paid, status };
};

export const cancelAdminBooking = async (id: string, reason: string, context: AuditContext) => {
  let refundRequired = false;
  const updated = await prisma.$transaction(
    async (tx) => {
      await lockBooking(tx, id);
      const before = await tx.booking.findUnique({ where: { id }, include: bookingInclude });
      if (!before) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
      const outcome = await cancelBookingInTransaction(tx, before, reason);
      refundRequired = outcome.paid;
      const after = await tx.booking.findUniqueOrThrow({ where: { id }, include: bookingInclude });
      await writeAuditLog({
        context,
        action: 'booking.cancel',
        entityType: 'Booking',
        entityId: id,
        before,
        after,
        metadata: { reason, refundRequired },
        client: tx,
      });
      return after;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  await notifyUser({
    userId: updated.studentId,
    type: NotificationType.BOOKING_CANCELLED,
    title: 'Booking cancelled',
    body: `Booking ${updated.bookingNumber} was cancelled by an administrator${refundRequired ? '; a refund is being processed' : ''}.`,
    data: { bookingId: updated.id, tripId: updated.tripId },
    dedupeKey: `admin-booking-cancelled:${updated.id}:${updated.updatedAt.getTime()}`,
  });
  if (refundRequired) {
    void refundBookingPayments(updated.id, reason).catch((error: unknown) => {
      logger.error({ err: error, bookingId: updated.id }, 'Admin booking cancellation refund failed');
    });
  }
  return bookingDto(updated);
};

const bookingTransitions: Record<BookingStatus, BookingStatus[]> = {
  HELD: [BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED, BookingStatus.CANCELLED, BookingStatus.EXPIRED],
  PENDING_PAYMENT: [BookingStatus.CONFIRMED, BookingStatus.CANCELLED, BookingStatus.EXPIRED],
  CONFIRMED: [BookingStatus.CANCELLED],
  CHECKED_IN: [BookingStatus.COMPLETED],
  COMPLETED: [],
  CANCELLED: [],
  EXPIRED: [],
  REFUND_PENDING: [BookingStatus.REFUNDED],
  REFUNDED: [],
};

export const updateAdminBooking = async (id: string, input: UpdateBooking, context: AuditContext) => {
  if (input.status === BookingStatus.CANCELLED) return cancelAdminBooking(id, input.adminNote, context);
  const updated = await prisma.$transaction(async (tx) => {
    await lockBooking(tx, id);
    const before = await tx.booking.findUnique({ where: { id }, include: bookingInclude });
    if (!before) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    if (input.studentId && input.studentId !== before.studentId) {
      throw new AppError(409, 'BOOKING_STUDENT_IMMUTABLE', 'Booking student cannot be changed');
    }
    if (input.tripId && input.tripId !== before.tripId) {
      throw new AppError(409, 'BOOKING_TRIP_IMMUTABLE', 'Booking trip cannot be changed');
    }
    const currentSeat = before.seatAllocations.find(({ status }) => status !== SeatAllocationStatus.RELEASED)?.seat.seatNumber
      ?? before.seatAllocations[0]?.seat.seatNumber;
    if (input.seatNumber && input.seatNumber.toLowerCase() !== currentSeat?.toLowerCase()) {
      throw new AppError(409, 'BOOKING_SEAT_IMMUTABLE', 'Use a cancel-and-rebook workflow to change seats safely');
    }
    if (!input.status || input.status === before.status) return before;
    if (input.status === BookingStatus.CHECKED_IN) {
      throw new AppError(409, 'CHECK_IN_AUDIT_REQUIRED', 'Use the manual check-in action so entry identity and audit data are recorded');
    }
    if (input.status === BookingStatus.REFUNDED) {
      throw new AppError(409, 'PAYMENT_RECONCILIATION_REQUIRED', 'A booking becomes refunded only after provider confirmation');
    }
    if (!bookingTransitions[before.status].includes(input.status)) {
      throw new AppError(409, 'INVALID_BOOKING_TRANSITION', `Cannot change booking from ${before.status} to ${input.status}`);
    }
    const now = new Date();
    const after = await tx.booking.update({
      where: { id },
      data: {
        status: input.status,
        confirmedAt: input.status === BookingStatus.CONFIRMED ? before.confirmedAt ?? now : undefined,
        completedAt: input.status === BookingStatus.COMPLETED ? before.completedAt ?? now : undefined,
        holdExpiresAt: input.status === BookingStatus.CONFIRMED ? null : undefined,
        version: { increment: 1 },
      },
      include: bookingInclude,
    });
    if (input.status === BookingStatus.CONFIRMED) {
      const seats = await tx.seatAllocation.updateMany({
        where: { bookingId: id, status: SeatAllocationStatus.HELD },
        data: { status: SeatAllocationStatus.CONFIRMED },
      });
      if (seats.count !== 1) throw new AppError(409, 'SEAT_NOT_HELD', 'The booking no longer owns an active seat hold');
    } else if (input.status === BookingStatus.EXPIRED) {
      await tx.seatAllocation.updateMany({
        where: { bookingId: id, status: { in: [SeatAllocationStatus.HELD, SeatAllocationStatus.CONFIRMED] } },
        data: { status: SeatAllocationStatus.EXPIRED, releasedAt: now, releaseReason: input.adminNote.slice(0, 255) },
      });
    }
    await writeAuditLog({
      context,
      action: 'booking.update',
      entityType: 'Booking',
      entityId: id,
      before,
      after,
      metadata: { reason: input.adminNote },
      client: tx,
    });
    return after;
  });
  if (updated.status === BookingStatus.CONFIRMED) {
    await notifyUser({
      userId: updated.studentId,
      type: NotificationType.BOOKING_CONFIRMED,
      title: 'Booking confirmed',
      body: `Booking ${updated.bookingNumber} was confirmed by an administrator.`,
      data: { bookingId: updated.id, tripId: updated.tripId },
      dedupeKey: `admin-booking-confirmed:${updated.id}:${updated.updatedAt.getTime()}`,
    });
  }
  return bookingDto(updated);
};

export const deleteAdminBooking = async (id: string, context: AuditContext): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    const before = await tx.booking.findUnique({ where: { id }, include: bookingInclude });
    if (!before) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    if (!([BookingStatus.CANCELLED, BookingStatus.EXPIRED] as BookingStatus[]).includes(before.status) || before.payments.length > 0 || before._count.checkIns > 0) {
      throw new AppError(409, 'BOOKING_HAS_FINANCIAL_OR_ENTRY_HISTORY', 'Only cancelled or expired bookings without payment or check-in history can be deleted');
    }
    await tx.booking.delete({ where: { id } });
    await writeAuditLog({ context, action: 'booking.delete', entityType: 'Booking', entityId: id, before, client: tx });
  });
};

const checkInInclude = {
  booking: {
    include: {
      student: { include: { user: { select: { id: true, name: true, email: true } } } },
      seatAllocations: { include: { seat: true } },
    },
  },
  trip: { include: { route: { select: { id: true, code: true, name: true } } } },
  bus: { select: { id: true, fleetNumber: true, registrationNumber: true } },
  scannedBy: { select: { id: true, name: true, role: true } },
} as const;

type CheckInRecord = Prisma.CheckInGetPayload<{ include: typeof checkInInclude }>;

const checkInStatus = (result: CheckInResult): string =>
  result === CheckInResult.ACCEPTED ? 'valid' : result === CheckInResult.REJECTED_REVOKED ? 'revoked' : 'rejected';

const checkInDto = (checkIn: CheckInRecord) => ({
  ...checkIn,
  result: checkInStatus(checkIn.result),
  status: checkInStatus(checkIn.result),
  rawResult: checkIn.result.toLowerCase(),
  latitude: checkIn.latitude === null ? null : Number(checkIn.latitude),
  longitude: checkIn.longitude === null ? null : Number(checkIn.longitude),
  trip: { ...checkIn.trip, reference: checkIn.trip.publicCode, status: checkIn.trip.status.toLowerCase() },
  scannedBy: { ...checkIn.scannedBy, role: checkIn.scannedBy.role.toLowerCase() },
  student: checkIn.booking
    ? { id: checkIn.booking.studentId, name: checkIn.booking.student.user.name, email: checkIn.booking.student.user.email }
    : null,
  seatNumber: checkIn.booking?.seatAllocations[0]?.seat.seatNumber ?? null,
});

export const listAdminCheckIns = async (query: CheckInQuery) => {
  const pageSize = query.pageSize ?? query.limit;
  const where: Prisma.CheckInWhereInput = {
    ...(query.tripId ? { tripId: query.tripId } : {}),
    ...(query.status ? { result: checkInResultForFilter(query.status) } : {}),
    ...(query.search
      ? {
          OR: [
            { booking: { bookingNumber: { contains: query.search, mode: 'insensitive' } } },
            { booking: { student: { user: { name: { contains: query.search, mode: 'insensitive' } } } } },
            { trip: { publicCode: { contains: query.search, mode: 'insensitive' } } },
            { scannedBy: { name: { contains: query.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
  const orderBy: Prisma.CheckInOrderByWithRelationInput =
    query.sort === 'checkedInAt' ? { checkedInAt: query.order } : { checkedInAt: 'desc' };
  const [items, total] = await prisma.$transaction([
    prisma.checkIn.findMany({
      where,
      include: checkInInclude,
      skip: (query.page - 1) * pageSize,
      take: pageSize,
      orderBy,
    }),
    prisma.checkIn.count({ where }),
  ]);
  return pageResult(items.map(checkInDto), total, query.page, pageSize);
};

export const getAdminCheckIn = async (id: string) => {
  const checkIn = await prisma.checkIn.findUnique({ where: { id }, include: checkInInclude });
  if (!checkIn) throw new AppError(404, 'CHECK_IN_NOT_FOUND', 'Check-in not found');
  return checkInDto(checkIn);
};

export const createManualAdminCheckIn = async (input: CreateCheckIn, context: AuditContext) => {
  const now = new Date();
  const token = randomBytes(48).toString('base64url');
  const result = await prisma.$transaction(
    async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: input.bookingId },
        include: { trip: true, seatAllocations: true, checkIns: { where: { result: CheckInResult.ACCEPTED } } },
      });
      if (!booking) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
      if (booking.status !== BookingStatus.CONFIRMED) throw new AppError(409, 'BOOKING_NOT_VALID', 'Only a confirmed booking can be checked in');
      if (!([TripStatus.BOARDING, TripStatus.IN_PROGRESS, TripStatus.DELAYED] as TripStatus[]).includes(booking.trip.status)) {
        throw new AppError(409, 'CHECK_IN_CLOSED', 'Check-in is not open for this trip');
      }
      if (booking.checkIns.length > 0) throw new AppError(409, 'ALREADY_CHECKED_IN', 'This booking is already checked in');
      const credential = await tx.bookingQrCode.create({
        data: {
          bookingId: booking.id,
          tokenHash: sha256(token),
          status: QrCodeStatus.USED,
          singleUse: true,
          issuedAt: now,
          expiresAt: new Date(now.getTime() + 60_000),
          usedAt: now,
        },
      });
      const checkIn = await tx.checkIn.create({
        data: {
          bookingId: booking.id,
          qrCodeId: credential.id,
          tripId: booking.tripId,
          busId: booking.trip.busId,
          scannedById: context.actorId,
          result: CheckInResult.ACCEPTED,
          scannedTokenFingerprint: sha256(token),
          denialReason: `Manual override: ${input.reason}`.slice(0, 255),
          checkedInAt: now,
        },
        include: checkInInclude,
      });
      await tx.booking.update({ where: { id: booking.id }, data: { status: BookingStatus.CHECKED_IN, checkedInAt: now, version: { increment: 1 } } });
      await tx.seatAllocation.updateMany({
        where: { bookingId: booking.id, status: SeatAllocationStatus.CONFIRMED },
        data: { status: SeatAllocationStatus.CHECKED_IN },
      });
      await writeAuditLog({
        context,
        action: 'checkIn.manual',
        entityType: 'CheckIn',
        entityId: checkIn.id,
        after: checkIn,
        metadata: { reason: input.reason, bookingId: booking.id },
        client: tx,
      });
      return checkIn;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  return checkInDto(result);
};

export const revokeAdminCheckIn = async (id: string, context: AuditContext) => {
  const result = await prisma.$transaction(
    async (tx) => {
      const before = await tx.checkIn.findUnique({ where: { id }, include: checkInInclude });
      if (!before) throw new AppError(404, 'CHECK_IN_NOT_FOUND', 'Check-in not found');
      if (before.result !== CheckInResult.ACCEPTED || !before.bookingId || !before.qrCodeId) {
        throw new AppError(409, 'CHECK_IN_NOT_REVOCABLE', 'Only an accepted check-in can be revoked');
      }
      if (([TripStatus.COMPLETED, TripStatus.CANCELLED] as TripStatus[]).includes(before.trip.status)) {
        throw new AppError(409, 'TRIP_ENDED', 'A check-in cannot be revoked after the trip has ended');
      }
      const now = new Date();
      const updated = await tx.checkIn.update({
        where: { id },
        data: { result: CheckInResult.REJECTED_REVOKED, denialReason: 'Revoked by an administrator' },
        include: checkInInclude,
      });
      await tx.booking.update({
        where: { id: before.bookingId },
        data: { status: BookingStatus.CONFIRMED, checkedInAt: null, version: { increment: 1 } },
      });
      await tx.seatAllocation.updateMany({
        where: { bookingId: before.bookingId, status: SeatAllocationStatus.CHECKED_IN },
        data: { status: SeatAllocationStatus.CONFIRMED },
      });
      await tx.bookingQrCode.update({
        where: { id: before.qrCodeId },
        data: { status: QrCodeStatus.REVOKED, usedAt: null, revokedAt: now, revokeReason: 'Check-in revoked by administrator' },
      });
      await writeAuditLog({
        context,
        action: 'checkIn.revoke',
        entityType: 'CheckIn',
        entityId: id,
        before,
        after: updated,
        client: tx,
      });
      return updated;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  return checkInDto(result);
};

const lowerRatingPayload = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(lowerRatingPayload);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      key === 'status' && typeof child === 'string' ? child.toLowerCase() : lowerRatingPayload(child),
    ]),
  );
};

export const listAdminRatings = async (query: RatingQuery) => {
  const result = await listRatings({
    page: query.page,
    pageSize: query.pageSize ?? query.limit,
    limit: query.pageSize ?? query.limit,
    search: query.search,
    rating: query.rating,
    status: query.status,
  });
  return lowerRatingPayload(result);
};

export const moderateAdminRating = async (
  id: string,
  input: ModerateRating,
  context: AuditContext,
) => lowerRatingPayload(await moderateRating(id, input, context));
