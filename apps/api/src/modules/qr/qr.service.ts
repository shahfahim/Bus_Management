import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import {
  BookingStatus,
  CheckInResult,
  QrCodeStatus,
  Role,
  SeatAllocationStatus,
  TripStatus,
} from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { lockBooking } from '../../lib/booking-lock.js';
import { prisma } from '../../lib/prisma.js';
import { sha256 } from '../../lib/security.js';
import { emitToTrip, emitToUser } from '../../realtime/hub.js';
import { issueQrToken, verifyQrToken } from './qr.tokens.js';

const bookingForQr = async (bookingId: string, userId: string) => {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, studentId: userId },
    include: { trip: true },
  });
  if (!booking) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
  if (booking.status !== BookingStatus.CONFIRMED) {
    throw new AppError(409, 'QR_NOT_AVAILABLE', 'A QR code is available only for a confirmed booking');
  }
  if (([TripStatus.CANCELLED, TripStatus.COMPLETED] as TripStatus[]).includes(booking.trip.status)) {
    throw new AppError(409, 'TRIP_ENDED', 'This trip no longer accepts check-ins');
  }
  return booking;
};

const issueCredential = async (bookingId: string, userId: string, rotate: boolean) => {
  const booking = await bookingForQr(bookingId, userId);
  const fallbackExpiry = new Date(booking.trip.scheduledStartAt.getTime() + 24 * 60 * 60_000);
  const expiresAt = booking.trip.scheduledEndAt
    ? new Date(booking.trip.scheduledEndAt.getTime() + 4 * 60 * 60_000)
    : fallbackExpiry;
  if (expiresAt <= new Date()) {
    throw new AppError(409, 'TRIP_EXPIRED', 'A QR code cannot be issued for an expired trip');
  }
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'qr:' + bookingId}))`;
    const existing = await tx.bookingQrCode.findFirst({
      where: { bookingId, status: QrCodeStatus.ACTIVE },
      orderBy: { issuedAt: 'desc' },
    });
    const now = new Date();
    if (existing && existing.expiresAt > now && !rotate) {
      const { token } = issueQrToken({
        userId,
        bookingId: booking.id,
        tripId: booking.tripId,
        expiresAt: existing.expiresAt,
        issuedAt: existing.issuedAt,
        jti: existing.id,
      });
      if (sha256(token) !== existing.tokenHash) {
        throw new AppError(409, 'QR_REISSUE_REQUIRED', 'The existing QR credential must be reissued');
      }
      return { credential: existing, token };
    }
    if (existing) {
      await tx.bookingQrCode.update({
        where: { id: existing.id },
        data: {
          status: existing.expiresAt <= now ? QrCodeStatus.EXPIRED : QrCodeStatus.REVOKED,
          revokedAt: existing.expiresAt <= now ? null : now,
          revokeReason: existing.expiresAt <= now ? 'Credential expired' : 'Explicitly reissued by student',
        },
      });
    }
    const credentialId = randomUUID();
    const { token } = issueQrToken({
      userId,
      bookingId: booking.id,
      tripId: booking.tripId,
      expiresAt,
      issuedAt: now,
      jti: credentialId,
    });
    const credential = await tx.bookingQrCode.create({
      data: {
        id: credentialId,
        bookingId,
        tokenHash: sha256(token),
        status: QrCodeStatus.ACTIVE,
        singleUse: true,
        issuedAt: now,
        expiresAt,
      },
    });
    return { credential, token };
  });
  const qrDataUrl = await QRCode.toDataURL(result.token, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 360,
    color: { dark: '#102a43', light: '#ffffff' },
  });
  return {
    credentialId: result.credential.id,
    token: result.token,
    qrToken: result.token,
    qrDataUrl,
    expiresAt: result.credential.expiresAt,
  };
};

export const getBookingQr = (bookingId: string, userId: string) => issueCredential(bookingId, userId, false);
export const rotateBookingQr = (bookingId: string, userId: string) => issueCredential(bookingId, userId, true);

const writeRejectedCheckIn = async ({
  token,
  scanner,
  tripId,
  result,
  reason,
}: {
  token: string;
  scanner: { userId: string; role: Role };
  tripId?: string;
  result: CheckInResult;
  reason: string;
}) => {
  if (!tripId) return;
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { id: true, busId: true, driverId: true, conductorId: true },
  });
  if (!trip) return;
  const assigned =
    scanner.role === Role.ADMIN ||
    trip.driverId === scanner.userId ||
    (scanner.role === Role.CONDUCTOR && trip.conductorId === scanner.userId);
  if (!assigned) return;
  await prisma.checkIn.create({
    data: {
      tripId: trip.id,
      busId: trip.busId,
      scannedById: scanner.userId,
      result,
      denialReason: reason,
      scannedTokenFingerprint: sha256(token),
    },
  });
};

export const scanBookingQr = async ({
  token,
  requestedTripId,
  scanner,
}: {
  token: string;
  requestedTripId?: string;
  scanner: { userId: string; role: Role };
}) => {
  let claims;
  try {
    claims = verifyQrToken(token);
  } catch (error) {
    await writeRejectedCheckIn({
      token,
      scanner,
      tripId: requestedTripId,
      result: CheckInResult.REJECTED_INVALID,
      reason: 'Signature or token claims invalid',
    });
    throw error;
  }

  const credential = await prisma.bookingQrCode.findUnique({
    where: { tokenHash: sha256(token) },
    include: {
      booking: {
        include: {
          trip: { include: { route: true, bus: true } },
          student: { include: { user: { select: { id: true, name: true } } } },
          seatAllocations: { include: { seat: true } },
        },
      },
    },
  });
  const tripId = requestedTripId ?? claims.tripId;
  if (!credential || credential.bookingId !== claims.bookingId || credential.booking.studentId !== claims.sub) {
    await writeRejectedCheckIn({
      token,
      scanner,
      tripId,
      result: CheckInResult.REJECTED_INVALID,
      reason: 'Credential not registered by the server',
    });
    throw new AppError(400, 'INVALID_QR', 'The QR code is not registered or was replaced');
  }
  const trip = credential.booking.trip;
  const scannerAssigned =
    scanner.role === Role.ADMIN ||
    trip.driverId === scanner.userId ||
    (scanner.role === Role.CONDUCTOR && trip.conductorId === scanner.userId);
  if (!scannerAssigned) throw new AppError(403, 'NOT_ASSIGNED_TO_TRIP', 'You are not assigned to scan passengers on this trip');
  if (requestedTripId && requestedTripId !== claims.tripId) {
    await writeRejectedCheckIn({
      token,
      scanner,
      tripId: requestedTripId,
      result: CheckInResult.REJECTED_WRONG_TRIP,
      reason: 'QR belongs to a different trip',
    });
    throw new AppError(409, 'WRONG_TRIP', 'The QR code belongs to a different trip');
  }
  if (credential.status === QrCodeStatus.USED || credential.usedAt) {
    await writeRejectedCheckIn({
      token,
      scanner,
      tripId: trip.id,
      result: CheckInResult.REJECTED_DUPLICATE,
      reason: 'Credential was already used',
    });
    throw new AppError(409, 'QR_ALREADY_USED', 'This QR code has already been checked in');
  }
  if (credential.status === QrCodeStatus.REVOKED) {
    await writeRejectedCheckIn({
      token,
      scanner,
      tripId: trip.id,
      result: CheckInResult.REJECTED_REVOKED,
      reason: 'Credential was revoked',
    });
    throw new AppError(409, 'QR_REVOKED', 'This QR code was revoked');
  }
  if (credential.expiresAt <= new Date() || credential.status === QrCodeStatus.EXPIRED) {
    await writeRejectedCheckIn({
      token,
      scanner,
      tripId: trip.id,
      result: CheckInResult.REJECTED_EXPIRED,
      reason: 'Credential expired',
    });
    throw new AppError(410, 'QR_EXPIRED', 'This QR code has expired');
  }
  if (!([TripStatus.BOARDING, TripStatus.IN_PROGRESS, TripStatus.DELAYED] as TripStatus[]).includes(trip.status)) {
    throw new AppError(409, 'CHECK_IN_CLOSED', 'Check-in is not open for this trip');
  }

  const now = new Date();
  const checkIn = await prisma.$transaction(async (tx) => {
    await lockBooking(tx, credential.bookingId);
    const currentTrip = await tx.trip.findUnique({
      where: { id: trip.id },
      select: { status: true, busId: true, driverId: true, conductorId: true },
    });
    const stillAssigned =
      scanner.role === Role.ADMIN ||
      currentTrip?.driverId === scanner.userId ||
      (scanner.role === Role.CONDUCTOR && currentTrip?.conductorId === scanner.userId);
    if (
      !currentTrip ||
      !stillAssigned ||
      !([TripStatus.BOARDING, TripStatus.IN_PROGRESS, TripStatus.DELAYED] as TripStatus[]).includes(currentTrip.status)
    ) {
      throw new AppError(409, 'CHECK_IN_CLOSED', 'Check-in closed while the QR code was being validated');
    }
    const consumed = await tx.bookingQrCode.updateMany({
      where: { id: credential.id, status: QrCodeStatus.ACTIVE, usedAt: null, expiresAt: { gt: now } },
      data: { status: QrCodeStatus.USED, usedAt: now },
    });
    if (consumed.count !== 1) throw new AppError(409, 'QR_ALREADY_USED', 'This QR code has already been checked in');
    const bookingUpdated = await tx.booking.updateMany({
      where: { id: credential.bookingId, status: BookingStatus.CONFIRMED },
      data: { status: BookingStatus.CHECKED_IN, checkedInAt: now, version: { increment: 1 } },
    });
    if (bookingUpdated.count !== 1) throw new AppError(409, 'BOOKING_NOT_VALID', 'The booking is not valid for check-in');
    await tx.seatAllocation.updateMany({
      where: { bookingId: credential.bookingId, status: SeatAllocationStatus.CONFIRMED },
      data: { status: SeatAllocationStatus.CHECKED_IN },
    });
    return tx.checkIn.create({
      data: {
        bookingId: credential.bookingId,
        qrCodeId: credential.id,
        tripId: trip.id,
        busId: currentTrip.busId,
        scannedById: scanner.userId,
        result: CheckInResult.ACCEPTED,
        scannedTokenFingerprint: sha256(token),
        checkedInAt: now,
      },
    });
  });

  const seat = credential.booking.seatAllocations[0]?.seat.seatNumber;
  const passenger = {
    bookingId: credential.bookingId,
    reference: credential.booking.bookingNumber,
    student: {
      id: credential.booking.student.user.id,
      name: credential.booking.student.user.name,
      studentId: credential.booking.student.studentNumber,
    },
    seatNumber: seat,
    checkedInAt: checkIn.checkedInAt,
  };
  const result = {
    accepted: true,
    checkInId: checkIn.id,
    checkIn: { id: checkIn.id, checkedInAt: checkIn.checkedInAt },
    checkedInAt: checkIn.checkedInAt,
    bookingId: credential.bookingId,
    bookingNumber: credential.booking.bookingNumber,
    passenger,
    seatNumber: seat,
    tripId: trip.id,
    trip: {
      id: trip.id,
      routeId: trip.routeId,
      route: { id: trip.route.id, code: trip.route.code, name: trip.route.name },
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
      status: trip.status,
    },
  };
  emitToTrip(trip.id, 'check-in:new', {
    tripId: trip.id,
    checkInId: checkIn.id,
    checkedInAt: checkIn.checkedInAt,
    seatNumber: seat,
  });
  emitToUser(credential.booking.studentId, 'booking:updated', { id: credential.bookingId, status: BookingStatus.CHECKED_IN });
  return result;
};
