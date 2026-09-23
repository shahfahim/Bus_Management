import { BookingStatus, CheckInResult, TripStatus, UserStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findTrips: vi.fn(),
  findStudent: vi.fn(),
  findBooking: vi.fn(),
  createCheckIn: vi.fn(),
  consumeBooking: vi.fn(),
  findReader: vi.fn(),
  touchReader: vi.fn(),
  emitToTrip: vi.fn(),
}));

vi.mock('../../lib/prisma.js', () => {
  const tx = {
    $queryRaw: vi.fn(),
    booking: { updateMany: mocks.consumeBooking },
    seatAllocation: { updateMany: vi.fn() },
    checkIn: { create: mocks.createCheckIn },
  };
  return {
    prisma: {
      trip: { findMany: mocks.findTrips },
      studentProfile: { findUnique: mocks.findStudent },
      booking: { findFirst: mocks.findBooking },
      checkIn: { create: mocks.createCheckIn },
      doorReader: { findUnique: mocks.findReader, update: mocks.touchReader },
      $transaction: (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    },
  };
});
vi.mock('../../realtime/hub.js', () => ({ emitToTrip: mocks.emitToTrip, emitToUser: vi.fn() }));
vi.mock('../admin/audit.service.js', () => ({ writeAuditLog: vi.fn() }));

import { generateBoardingCode, normalizeBoardingCode } from './boarding.codes.js';
import { authenticateDoorReader, checkInWithBoardingCode } from './boarding.service.js';

const reader = { doorReaderId: 'reader-1', busId: 'bus-1' };
const code = 'UR0123456789ABCDEF0123';
const trip = { id: 'trip-1', busId: 'bus-1', driverId: 'driver-1', conductorId: null, status: TripStatus.IN_PROGRESS, scheduledStartAt: new Date(), publicCode: 'TRIP-1' };
const student = { userId: 'student-1', studentNumber: 'CSE-2201', user: { name: 'Nadia Rahman', status: UserStatus.ACTIVE, deletedAt: null } };

const checkInData = () => (mocks.createCheckIn.mock.calls as Array<[{ data: Record<string, unknown> }]>)[0]![0].data;

describe('boarding codes', () => {
  it('generates codes in the documented format', () => {
    expect(generateBoardingCode()).toMatch(/^UR[0-9A-F]{20}$/);
    expect(generateBoardingCode()).not.toBe(generateBoardingCode());
  });

  it('accepts codes typed with spaces, dashes or lower case', () => {
    expect(normalizeBoardingCode(' ur01-2345 6789abcdef0123 ')).toBe(code);
    expect(normalizeBoardingCode('UR123')).toBeUndefined();
    expect(normalizeBoardingCode('XX0123456789ABCDEF0123')).toBeUndefined();
  });
});

describe('door check-in with a boarding card', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findTrips.mockResolvedValue([trip]);
    mocks.findStudent.mockResolvedValue(student);
    mocks.createCheckIn.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'check-in-1', checkedInAt: new Date(), ...data, booking: { seatAllocations: [{ seat: { seatNumber: '7' } }] } }),
    );
  });

  it('checks in a paid booking on the bus trip and uses it up', async () => {
    mocks.findBooking.mockResolvedValueOnce({ id: 'booking-1', tripId: 'trip-1', bookingNumber: 'BKG-1' });
    mocks.consumeBooking.mockResolvedValue({ count: 1 });

    const result = await checkInWithBoardingCode(code, reader);

    expect(result).toMatchObject({ accepted: true, bookingId: 'booking-1', passenger: { name: 'Nadia Rahman', seatNumber: '7' } });
    const consumed = (mocks.consumeBooking.mock.calls as Array<[{ where: unknown; data: { status: BookingStatus } }]>)[0]![0];
    expect(consumed.where).toEqual({ id: 'booking-1', status: BookingStatus.CONFIRMED });
    expect(consumed.data.status).toBe(BookingStatus.CHECKED_IN);
    expect(checkInData()).toMatchObject({ doorReaderId: 'reader-1', result: CheckInResult.ACCEPTED });
  });

  it('refuses the same card again once its booking has been used', async () => {
    mocks.findBooking
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'booking-1', tripId: 'trip-1', status: BookingStatus.CHECKED_IN });

    await expect(checkInWithBoardingCode(code, reader)).rejects.toMatchObject({ code: 'ALREADY_CHECKED_IN' });
    expect(checkInData()).toMatchObject({ result: CheckInResult.REJECTED_DUPLICATE });
  });

  it('refuses a student without a paid booking for this bus', async () => {
    mocks.findBooking.mockResolvedValue(null);

    await expect(checkInWithBoardingCode(code, reader)).rejects.toMatchObject({ code: 'NO_BOOKING', passenger: { name: 'Nadia Rahman' } });
  });

  it('refuses unknown cards without revealing anything', async () => {
    mocks.findStudent.mockResolvedValue(null);

    await expect(checkInWithBoardingCode(code, reader)).rejects.toMatchObject({ code: 'UNKNOWN_CODE', passenger: undefined });
  });

  it('refuses scans when the bus has no trip boarding', async () => {
    mocks.findTrips.mockResolvedValue([]);

    await expect(checkInWithBoardingCode(code, reader)).rejects.toMatchObject({ code: 'NO_ACTIVE_TRIP' });
  });
});

describe('door reader authentication', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects missing, unknown and deactivated keys', async () => {
    await expect(authenticateDoorReader(undefined)).rejects.toMatchObject({ statusCode: 401 });
    mocks.findReader.mockResolvedValueOnce(null);
    await expect(authenticateDoorReader('drk_unknown')).rejects.toMatchObject({ code: 'READER_NOT_AUTHORISED' });
    mocks.findReader.mockResolvedValueOnce({ id: 'reader-1', busId: 'bus-1', isActive: false, revokedAt: null });
    await expect(authenticateDoorReader('drk_inactive')).rejects.toMatchObject({ code: 'READER_NOT_AUTHORISED' });
  });

  it('returns the reader bus for an active key', async () => {
    mocks.findReader.mockResolvedValueOnce({ id: 'reader-1', busId: 'bus-1', isActive: true, revokedAt: null });
    await expect(authenticateDoorReader('drk_valid')).resolves.toEqual({ doorReaderId: 'reader-1', busId: 'bus-1' });
    expect(mocks.touchReader).toHaveBeenCalled();
  });
});
