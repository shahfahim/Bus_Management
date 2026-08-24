import { BookingStatus, CheckInResult, Prisma } from '@prisma/client';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { paginated, toPagination } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import type { AuditContext } from '../admin/audit.service.js';
import { writeAuditLog } from '../admin/audit.service.js';
import type { createRatingSchema, moderateRatingSchema, ratingQuerySchema, updateRatingSchema } from './rating.schemas.js';

type RatingQuery = z.infer<typeof ratingQuerySchema>;
type CreateRatingInput = z.infer<typeof createRatingSchema>;
type UpdateRatingInput = z.infer<typeof updateRatingSchema>;
type ModerateRatingInput = z.infer<typeof moderateRatingSchema>;

const include = {
  driver: { include: { user: { select: { id: true, name: true, avatarUrl: true } } } },
  student: { include: { user: { select: { id: true, name: true, avatarUrl: true } } } },
  trip: { include: { route: { select: { id: true, code: true, name: true } } } },
  booking: { select: { id: true, bookingNumber: true, status: true } },
} as const;

type RatingWithRelations = Prisma.DriverRatingGetPayload<{ include: typeof include }>;

const dto = (rating: RatingWithRelations) => ({
  id: rating.id,
  driverId: rating.driverId,
  studentId: rating.studentId,
  tripId: rating.tripId,
  bookingId: rating.bookingId,
  score: rating.score,
  rating: rating.score,
  comment: rating.comment,
  isVisible: rating.isVisible,
  status: rating.isVisible ? 'PUBLISHED' : 'HIDDEN',
  createdAt: rating.createdAt,
  updatedAt: rating.updatedAt,
  driver: {
    id: rating.driver.user.id,
    name: rating.driver.user.name,
    avatarUrl: rating.driver.user.avatarUrl,
    averageRating: Number(rating.driver.averageRating),
    ratingCount: rating.driver.ratingCount,
  },
  student: rating.student.user,
  trip: {
    id: rating.trip.id,
    publicCode: rating.trip.publicCode,
    route: rating.trip.route,
    departureTime: rating.trip.scheduledStartAt,
  },
  booking: rating.booking,
});

const refreshDriverAggregate = async (tx: Prisma.TransactionClient, driverId: string): Promise<void> => {
  const aggregate = await tx.driverRating.aggregate({
    where: { driverId, isVisible: true },
    _avg: { score: true },
    _count: { score: true },
  });
  await tx.driverProfile.update({
    where: { userId: driverId },
    data: {
      averageRating: aggregate._avg.score ?? 0,
      ratingCount: aggregate._count.score,
    },
  });
};

export const createRating = async (studentId: string, input: CreateRatingInput) => {
  return prisma.$transaction(
    async (tx) => {
      const booking = await tx.booking.findFirst({
        where: {
          ...(input.bookingId ? { id: input.bookingId } : { tripId: input.tripId }),
          studentId,
          status: { in: [BookingStatus.CHECKED_IN, BookingStatus.COMPLETED] },
        },
        include: {
          trip: true,
          checkIns: { where: { result: CheckInResult.ACCEPTED }, select: { id: true }, take: 1 },
          rating: { select: { id: true } },
        },
      });
      if (!booking) {
        throw new AppError(404, 'RATABLE_BOOKING_NOT_FOUND', 'A checked-in or completed booking for this trip was not found');
      }
      if (!booking.checkedInAt && booking.checkIns.length === 0) {
        throw new AppError(409, 'CHECK_IN_REQUIRED', 'Only a verified passenger who checked in may rate this trip');
      }
      if (input.driverId && input.driverId !== booking.trip.driverId) {
        throw new AppError(400, 'DRIVER_MISMATCH', 'The selected driver was not assigned to this booking');
      }
      if (booking.rating) throw new AppError(409, 'RATING_ALREADY_EXISTS', 'This journey has already been rated');
      const rating = await tx.driverRating.create({
        data: {
          studentId,
          driverId: booking.trip.driverId,
          tripId: booking.tripId,
          bookingId: booking.id,
          score: input.score,
          comment: input.comment || null,
        },
        include,
      });
      await refreshDriverAggregate(tx, rating.driverId);
      return dto(rating);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
};

export const listRatings = async (rawQuery: RatingQuery, options: { studentId?: string; publicOnly?: boolean } = {}) => {
  const pageSize = rawQuery.pageSize ?? rawQuery.limit ?? 20;
  const query = { ...rawQuery, pageSize };
  const requestedStatus = rawQuery.status?.toUpperCase();
  const where: Prisma.DriverRatingWhereInput = {
    ...(options.studentId ? { studentId: options.studentId } : {}),
    ...(rawQuery.driverId ? { driverId: rawQuery.driverId } : {}),
    ...(rawQuery.tripId ? { tripId: rawQuery.tripId } : {}),
    ...(rawQuery.rating || rawQuery.score ? { score: rawQuery.rating ?? rawQuery.score } : {}),
    ...(options.publicOnly || requestedStatus === 'PUBLISHED'
      ? { isVisible: true }
      : requestedStatus === 'HIDDEN' || requestedStatus === 'FLAGGED'
        ? { isVisible: false }
        : {}),
    ...(rawQuery.search
      ? {
          OR: [
            { comment: { contains: rawQuery.search, mode: 'insensitive' } },
            { driver: { user: { name: { contains: rawQuery.search, mode: 'insensitive' } } } },
            { student: { user: { name: { contains: rawQuery.search, mode: 'insensitive' } } } },
            { trip: { publicCode: { contains: rawQuery.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.driverRating.findMany({ where, include, ...toPagination(query), orderBy: { createdAt: 'desc' } }),
    prisma.driverRating.count({ where }),
  ]);
  const result = paginated(items.map(dto), total, query.page, pageSize);
  return { ...result, pagination: { ...result.pagination, totalPages: result.pagination.pages } };
};

export const getDriverRatingSummary = async (driverId: string) => {
  const driver = await prisma.driverProfile.findUnique({
    where: { userId: driverId },
    include: { user: { select: { id: true, name: true, avatarUrl: true } } },
  });
  if (!driver) throw new AppError(404, 'DRIVER_NOT_FOUND', 'Driver not found');
  const distributionRows = await prisma.driverRating.groupBy({
    by: ['score'],
    where: { driverId, isVisible: true },
    _count: { score: true },
    orderBy: { score: 'desc' },
  });
  return {
    driver: driver.user,
    averageRating: Number(driver.averageRating),
    ratingCount: driver.ratingCount,
    distribution: Object.fromEntries([1, 2, 3, 4, 5].map((score) => [score, distributionRows.find((row) => row.score === score)?._count.score ?? 0])),
  };
};

export const updateOwnRating = async (ratingId: string, studentId: string, input: UpdateRatingInput) => {
  return prisma.$transaction(async (tx) => {
    const before = await tx.driverRating.findFirst({ where: { id: ratingId, studentId }, include });
    if (!before) throw new AppError(404, 'RATING_NOT_FOUND', 'Rating not found');
    if (Date.now() - before.createdAt.getTime() > 7 * 86_400_000) {
      throw new AppError(409, 'RATING_EDIT_WINDOW_CLOSED', 'Ratings may be edited for seven days after submission');
    }
    const rating = await tx.driverRating.update({
      where: { id: ratingId },
      data: { score: input.score, comment: input.comment },
      include,
    });
    await refreshDriverAggregate(tx, rating.driverId);
    return dto(rating);
  });
};

export const moderateRating = async (
  ratingId: string,
  input: ModerateRatingInput,
  context: AuditContext,
) => {
  return prisma.$transaction(async (tx) => {
    const before = await tx.driverRating.findUnique({ where: { id: ratingId }, include });
    if (!before) throw new AppError(404, 'RATING_NOT_FOUND', 'Rating not found');
    const rating = await tx.driverRating.update({
      where: { id: ratingId },
      data: { isVisible: input.status === 'PUBLISHED' },
      include,
    });
    await refreshDriverAggregate(tx, rating.driverId);
    await writeAuditLog({
      context,
      action: 'rating.moderate',
      entityType: 'DriverRating',
      entityId: ratingId,
      before,
      after: rating,
      metadata: { moderationStatus: input.status, reason: input.reason },
      client: tx,
    });
    return dto(rating);
  });
};

export const deleteOwnRating = async (ratingId: string, studentId: string): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    const rating = await tx.driverRating.findFirst({ where: { id: ratingId, studentId } });
    if (!rating) throw new AppError(404, 'RATING_NOT_FOUND', 'Rating not found');
    if (Date.now() - rating.createdAt.getTime() > 24 * 60 * 60_000) {
      throw new AppError(409, 'RATING_DELETE_WINDOW_CLOSED', 'Ratings may only be deleted within 24 hours');
    }
    await tx.driverRating.delete({ where: { id: ratingId } });
    await refreshDriverAggregate(tx, rating.driverId);
  });
};

