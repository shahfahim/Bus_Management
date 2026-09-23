import {
  BookingStatus,
  CheckInResult,
  Prisma,
  Role,
  SeatAllocationStatus,
  TripStatus,
  UserStatus,
} from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { lockBooking } from '../../lib/booking-lock.js';
import { prisma } from '../../lib/prisma.js';
import { sha256 } from '../../lib/security.js';
import { emitToTrip, emitToUser } from '../../realtime/hub.js';
import type { AuditContext } from '../admin/audit.service.js';
import { writeAuditLog } from '../admin/audit.service.js';
import { generateBoardingCode, generateDoorReaderKey, normalizeBoardingCode } from './boarding.codes.js';

// Riders may board from shortly before departure until the trip ends.
const BOARDING_OPENS_BEFORE_DEPARTURE_MS = 45 * 60_000;
// A trip still running this long after its scheduled start is no longer a boarding candidate.
const LONGEST_TRIP_MS = 12 * 60 * 60_000;

/** A scan that must be refused; `code` is stable for readers, `message` is for people. */
export class BoardingRejection extends AppError {
  constructor(
    statusCode: number,
    code: string,
    message: string,
    public readonly passenger?: { name: string; studentId: string },
  ) {
    super(statusCode, code, message);
  }
}

// ---------------------------------------------------------------------------------------------
// Student boarding cards
// ---------------------------------------------------------------------------------------------

const cardDto = (profile: { boardingCode: string; boardingCodeIssuedAt: Date | null; studentNumber: string; user: { name: string } }) => ({
  code: profile.boardingCode,
  issuedAt: profile.boardingCodeIssuedAt,
  name: profile.user.name,
  studentId: profile.studentNumber,
});

/** Returns the student's boarding card, creating the code on first use (e.g. older accounts). */
export const getBoardingCard = async (userId: string) => {
  const profile = await prisma.studentProfile.findUnique({ where: { userId }, include: { user: { select: { name: true } } } });
  if (!profile) throw new AppError(404, 'STUDENT_PROFILE_NOT_FOUND', 'A student profile is required for a boarding card');
  if (profile.boardingCode) return cardDto({ ...profile, boardingCode: profile.boardingCode });
  const updated = await prisma.studentProfile.update({
    where: { userId },
    data: { boardingCode: generateBoardingCode(), boardingCodeIssuedAt: new Date() },
    include: { user: { select: { name: true } } },
  });
  return cardDto({ ...updated, boardingCode: updated.boardingCode! });
};

/** Replaces a lost or leaked code: the old barcode stops working immediately. */
export const reissueBoardingCard = async (userId: string) => {
  const updated = await prisma.studentProfile.update({
    where: { userId },
    data: { boardingCode: generateBoardingCode(), boardingCodeIssuedAt: new Date() },
    include: { user: { select: { name: true } } },
  });
  await prisma.auditLog.create({
    data: { actorId: userId, action: 'boardingCard.reissue', entityType: 'StudentProfile', entityId: userId },
  });
  return cardDto({ ...updated, boardingCode: updated.boardingCode! });
};

// ---------------------------------------------------------------------------------------------
// Checking riders in with their boarding code
// ---------------------------------------------------------------------------------------------

type Scanner = { doorReaderId: string; busId: string } | { userId: string; role: Role; tripId: string };

const isDoorReader = (scanner: Scanner): scanner is { doorReaderId: string; busId: string } => 'doorReaderId' in scanner;

/** Trips this scanner can currently board riders onto. */
const boardableTrips = async (scanner: Scanner, now: Date) => {
  if (!isDoorReader(scanner)) {
    const trip = await prisma.trip.findUnique({
      where: { id: scanner.tripId },
      select: { id: true, busId: true, driverId: true, conductorId: true, status: true, scheduledStartAt: true, publicCode: true },
    });
    if (!trip) throw new AppError(404, 'TRIP_NOT_FOUND', 'Trip not found');
    const assigned =
      scanner.role === Role.ADMIN ||
      (scanner.role === Role.DRIVER && trip.driverId === scanner.userId) ||
      (scanner.role === Role.CONDUCTOR && trip.conductorId === scanner.userId);
    if (!assigned) throw new AppError(403, 'NOT_ASSIGNED_TO_TRIP', 'You are not assigned to this trip');
    const open =
      ([TripStatus.BOARDING, TripStatus.IN_PROGRESS, TripStatus.DELAYED] as TripStatus[]).includes(trip.status) ||
      (trip.status === TripStatus.SCHEDULED && trip.scheduledStartAt.getTime() - BOARDING_OPENS_BEFORE_DEPARTURE_MS <= now.getTime());
    if (!open) throw new BoardingRejection(409, 'CHECK_IN_CLOSED', 'Check-in is not open for this trip');
    return [trip];
  }
  // A door reader belongs to a bus: its candidates are that bus's trips that are boarding or under way.
  return prisma.trip.findMany({
    where: {
      busId: scanner.busId,
      scheduledStartAt: { gte: new Date(now.getTime() - LONGEST_TRIP_MS), lte: new Date(now.getTime() + BOARDING_OPENS_BEFORE_DEPARTURE_MS) },
      status: { in: [TripStatus.SCHEDULED, TripStatus.BOARDING, TripStatus.IN_PROGRESS, TripStatus.DELAYED] },
    },
    select: { id: true, busId: true, driverId: true, conductorId: true, status: true, scheduledStartAt: true, publicCode: true },
    orderBy: { scheduledStartAt: 'asc' },
  });
};

const recordRejection = async (
  scanner: Scanner,
  trip: { id: string; busId: string } | undefined,
  fingerprint: string,
  result: CheckInResult,
  reason: string,
  bookingId?: string,
) => {
  // Rejections are only logged against a known trip (check_ins.tripId is required).
  if (!trip) return;
  await prisma.checkIn.create({
    data: {
      tripId: trip.id,
      busId: trip.busId,
      bookingId,
      ...(isDoorReader(scanner) ? { doorReaderId: scanner.doorReaderId } : { scannedById: scanner.userId }),
      result,
      denialReason: reason.slice(0, 255),
      scannedTokenFingerprint: fingerprint,
    },
  });
};

/**
 * Checks a rider in by their personal boarding code. The code must belong to an active student
 * with a paid (CONFIRMED) booking on a trip this scanner serves; that booking becomes CHECKED_IN,
 * so the same code is refused on the next ride until the student books and pays again.
 */
export const checkInWithBoardingCode = async (rawCode: string, scanner: Scanner) => {
  const now = new Date();
  const code = normalizeBoardingCode(rawCode);
  const fingerprint = sha256(code ?? rawCode.trim());
  const trips = await boardableTrips(scanner, now);
  if (!trips.length) {
    throw new BoardingRejection(409, 'NO_ACTIVE_TRIP', 'This bus has no trip boarding right now');
  }

  const student = code
    ? await prisma.studentProfile.findUnique({
        where: { boardingCode: code },
        select: { userId: true, studentNumber: true, user: { select: { name: true, status: true, deletedAt: true } } },
      })
    : null;
  if (!student || student.user.status !== UserStatus.ACTIVE || student.user.deletedAt) {
    await recordRejection(scanner, trips[0], fingerprint, CheckInResult.REJECTED_INVALID, 'Unknown or inactive boarding code');
    throw new BoardingRejection(404, 'UNKNOWN_CODE', 'This boarding card is not recognised');
  }
  const passenger = { name: student.user.name, studentId: student.studentNumber };
  const tripIds = trips.map(({ id }) => id);

  const booking = await prisma.booking.findFirst({
    where: { studentId: student.userId, tripId: { in: tripIds }, status: BookingStatus.CONFIRMED },
    orderBy: { trip: { scheduledStartAt: 'asc' } },
    select: { id: true, tripId: true, bookingNumber: true },
  });
  if (!booking) {
    const other = await prisma.booking.findFirst({
      where: {
        studentId: student.userId,
        tripId: { in: tripIds },
        status: { in: [BookingStatus.CHECKED_IN, BookingStatus.COMPLETED, BookingStatus.HELD, BookingStatus.PENDING_PAYMENT] },
      },
      select: { id: true, tripId: true, status: true },
    });
    const trip = trips.find(({ id }) => id === other?.tripId) ?? trips[0];
    if (other && ([BookingStatus.CHECKED_IN, BookingStatus.COMPLETED] as BookingStatus[]).includes(other.status)) {
      await recordRejection(scanner, trip, fingerprint, CheckInResult.REJECTED_DUPLICATE, 'Booking already used', other.id);
      throw new BoardingRejection(409, 'ALREADY_CHECKED_IN', 'This booking was already used to board. Book again to ride.', passenger);
    }
    if (other) {
      await recordRejection(scanner, trip, fingerprint, CheckInResult.REJECTED_NO_BOOKING, 'Booking not paid', other.id);
      throw new BoardingRejection(409, 'PAYMENT_PENDING', 'This booking is not paid yet', passenger);
    }
    await recordRejection(scanner, trip, fingerprint, CheckInResult.REJECTED_NO_BOOKING, 'No booking for this bus');
    throw new BoardingRejection(409, 'NO_BOOKING', 'No paid booking for this bus', passenger);
  }

  const trip = trips.find(({ id }) => id === booking.tripId)!;
  const checkIn = await prisma.$transaction(
    async (tx) => {
      await lockBooking(tx, booking.id);
      // Guarded transition: two simultaneous scans can only consume the booking once.
      const consumed = await tx.booking.updateMany({
        where: { id: booking.id, status: BookingStatus.CONFIRMED },
        data: { status: BookingStatus.CHECKED_IN, checkedInAt: now, version: { increment: 1 } },
      });
      if (consumed.count !== 1) {
        throw new BoardingRejection(409, 'ALREADY_CHECKED_IN', 'This booking was already used to board. Book again to ride.', passenger);
      }
      await tx.seatAllocation.updateMany({
        where: { bookingId: booking.id, status: SeatAllocationStatus.CONFIRMED },
        data: { status: SeatAllocationStatus.CHECKED_IN },
      });
      return tx.checkIn.create({
        data: {
          bookingId: booking.id,
          tripId: trip.id,
          busId: trip.busId,
          ...(isDoorReader(scanner) ? { doorReaderId: scanner.doorReaderId } : { scannedById: scanner.userId }),
          result: CheckInResult.ACCEPTED,
          scannedTokenFingerprint: fingerprint,
          checkedInAt: now,
        },
        include: { booking: { include: { seatAllocations: { include: { seat: true } } } } },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  const seatNumber = checkIn.booking?.seatAllocations[0]?.seat.seatNumber ?? null;
  emitToTrip(trip.id, 'check-in:new', { tripId: trip.id, checkInId: checkIn.id, checkedInAt: checkIn.checkedInAt, seatNumber });
  emitToUser(student.userId, 'booking:updated', { id: booking.id, status: BookingStatus.CHECKED_IN });
  return {
    accepted: true as const,
    checkInId: checkIn.id,
    checkedInAt: checkIn.checkedInAt,
    bookingId: booking.id,
    bookingNumber: booking.bookingNumber,
    passenger: { ...passenger, seatNumber },
    trip: { id: trip.id, publicCode: trip.publicCode },
    message: `Welcome, ${passenger.name}${seatNumber ? ` · seat ${seatNumber}` : ''}`,
  };
};

// ---------------------------------------------------------------------------------------------
// Door readers
// ---------------------------------------------------------------------------------------------

/** Authenticates a door reader by its API key and records that it was seen. */
export const authenticateDoorReader = async (key: string | undefined) => {
  if (!key) throw new AppError(401, 'READER_KEY_REQUIRED', 'A door reader key is required');
  const reader = await prisma.doorReader.findUnique({
    where: { keyHash: sha256(key) },
    select: { id: true, busId: true, isActive: true, revokedAt: true, bus: { select: { status: true } } },
  });
  if (!reader || !reader.isActive || reader.revokedAt) {
    throw new AppError(401, 'READER_NOT_AUTHORISED', 'This door reader is not authorised');
  }
  await prisma.doorReader.update({ where: { id: reader.id }, data: { lastSeenAt: new Date() } });
  return { doorReaderId: reader.id, busId: reader.busId };
};

const readerSelect = {
  id: true,
  name: true,
  busId: true,
  keyPrefix: true,
  isActive: true,
  lastSeenAt: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
  bus: { select: { id: true, fleetNumber: true, registrationNumber: true } },
  _count: { select: { checkIns: true } },
} satisfies Prisma.DoorReaderSelect;

type ReaderRecord = Prisma.DoorReaderGetPayload<{ select: typeof readerSelect }>;

const readerDto = (reader: ReaderRecord) => ({
  ...reader,
  status: reader.revokedAt ? 'revoked' : reader.isActive ? 'active' : 'inactive',
  keyHint: `${reader.keyPrefix}…`,
  checkInCount: reader._count.checkIns,
});

const pageResult = <T>(items: T[], total: number, page: number, pageSize: number) => ({
  items,
  data: items,
  meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) },
});

export const listDoorReaders = async (query: { page: number; pageSize: number; search?: string; busId?: string }) => {
  const where: Prisma.DoorReaderWhereInput = {
    ...(query.busId ? { busId: query.busId } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { bus: { fleetNumber: { contains: query.search, mode: 'insensitive' } } },
            { bus: { registrationNumber: { contains: query.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.doorReader.findMany({
      where,
      select: readerSelect,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.doorReader.count({ where }),
  ]);
  return pageResult(items.map(readerDto), total, query.page, query.pageSize);
};

export const getDoorReader = async (id: string) => {
  const reader = await prisma.doorReader.findUnique({ where: { id }, select: readerSelect });
  if (!reader) throw new AppError(404, 'DOOR_READER_NOT_FOUND', 'Door reader not found');
  return readerDto(reader);
};

/** Creates a reader and returns its API key once; only the hash is kept. */
export const createDoorReader = async (input: { name: string; busId: string }, context: AuditContext) => {
  const bus = await prisma.bus.findUnique({ where: { id: input.busId }, select: { id: true } });
  if (!bus) throw new AppError(404, 'BUS_NOT_FOUND', 'Bus not found');
  const apiKey = generateDoorReaderKey();
  const reader = await prisma.doorReader.create({
    data: { name: input.name, busId: input.busId, keyHash: sha256(apiKey), keyPrefix: apiKey.slice(0, 10) },
    select: readerSelect,
  });
  await writeAuditLog({ context, action: 'doorReader.create', entityType: 'DoorReader', entityId: reader.id, after: readerDto(reader) });
  return { ...readerDto(reader), apiKey };
};

export const updateDoorReader = async (
  id: string,
  input: { name?: string; busId?: string; isActive?: boolean },
  context: AuditContext,
) => {
  const before = await prisma.doorReader.findUnique({ where: { id }, select: readerSelect });
  if (!before) throw new AppError(404, 'DOOR_READER_NOT_FOUND', 'Door reader not found');
  if (before.revokedAt && input.isActive) {
    throw new AppError(409, 'DOOR_READER_REVOKED', 'A revoked reader cannot be reactivated; rotate its key instead');
  }
  const reader = await prisma.doorReader.update({ where: { id }, data: input, select: readerSelect });
  await writeAuditLog({ context, action: 'doorReader.update', entityType: 'DoorReader', entityId: id, before: readerDto(before), after: readerDto(reader) });
  return readerDto(reader);
};

/** Issues a new key (e.g. the old one leaked); the previous key stops working at once. */
export const rotateDoorReaderKey = async (id: string, context: AuditContext) => {
  const apiKey = generateDoorReaderKey();
  const reader = await prisma.doorReader.update({
    where: { id },
    data: { keyHash: sha256(apiKey), keyPrefix: apiKey.slice(0, 10), revokedAt: null, isActive: true },
    select: readerSelect,
  });
  await writeAuditLog({ context, action: 'doorReader.rotateKey', entityType: 'DoorReader', entityId: id });
  return { ...readerDto(reader), apiKey };
};

/** Readers with check-in history are revoked (kept for the audit trail); unused ones are deleted. */
export const deleteDoorReader = async (id: string, context: AuditContext): Promise<void> => {
  const reader = await prisma.doorReader.findUnique({ where: { id }, select: readerSelect });
  if (!reader) throw new AppError(404, 'DOOR_READER_NOT_FOUND', 'Door reader not found');
  if (reader._count.checkIns > 0) {
    await prisma.doorReader.update({ where: { id }, data: { isActive: false, revokedAt: new Date() } });
    await writeAuditLog({ context, action: 'doorReader.revoke', entityType: 'DoorReader', entityId: id, before: readerDto(reader) });
    return;
  }
  await prisma.doorReader.delete({ where: { id } });
  await writeAuditLog({ context, action: 'doorReader.delete', entityType: 'DoorReader', entityId: id, before: readerDto(reader) });
};
