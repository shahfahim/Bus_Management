import { BookingStatus, TripStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findBooking: vi.fn(),
  readBooking: vi.fn(),
  updateBooking: vi.fn(),
  refundBookingPayments: vi.fn(),
}));

vi.mock('../../lib/prisma.js', () => {
  const tx = {
    $queryRaw: vi.fn(),
    booking: { findFirst: mocks.findBooking, update: mocks.updateBooking },
    studentSubscription: { update: vi.fn() },
    payment: { updateMany: vi.fn() },
  };
  return {
    prisma: {
      booking: { findFirst: mocks.readBooking },
      $transaction: (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    },
  };
});
vi.mock('../../realtime/hub.js', () => ({ emitToTrip: vi.fn(), emitToUser: vi.fn() }));
vi.mock('../notifications/notification.service.js', () => ({ notifyUser: vi.fn() }));
vi.mock('../payments/payment.service.js', () => ({ refundBookingPayments: mocks.refundBookingPayments }));

import { cancelBooking } from './booking.service.js';

const confirmedBooking = (trip: { status: TripStatus; actualStartAt: Date | null }) => ({
  id: 'booking-1',
  studentId: 'student-1',
  status: BookingStatus.CONFIRMED,
  version: 1,
  subscriptionId: null,
  subscription: null,
  payments: [{ id: 'payment-1' }],
  trip,
});

const stop = { routeStop: { stop: { id: 'stop-1', name: 'Stop', latitude: 23.7, longitude: 90.4 } }, sequence: 1 };
const storedBooking = {
  id: 'booking-1', bookingNumber: 'BKG-1', studentId: 'student-1', tripId: 'trip-1', status: BookingStatus.REFUND_PENDING,
  fareAmount: 50, currency: 'BDT', holdExpiresAt: null, createdAt: new Date(), confirmedAt: null, cancelledAt: new Date(), checkedInAt: null,
  seatAllocations: [], payments: [], checkIns: [], boardingStop: stop, dropoffStop: stop,
  trip: {
    id: 'trip-1', routeId: 'route-1', busId: 'bus-1', scheduledStartAt: new Date(), scheduledEndAt: null, fareAmount: 50,
    currency: 'BDT', status: TripStatus.SCHEDULED, delayMinutes: 0,
    route: { id: 'route-1', name: 'Route', code: 'R1', stops: [] },
    bus: { id: 'bus-1', registrationNumber: 'REG', fleetNumber: 'BUS-1', capacity: 30, status: 'ACTIVE' },
    driver: { averageRating: 5, user: { id: 'driver-1', name: 'Driver', phone: null } },
  },
};

describe('rider booking cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readBooking.mockResolvedValue(storedBooking);
    mocks.updateBooking.mockResolvedValue({
      id: 'booking-1', studentId: 'student-1', tripId: 'trip-1', bookingNumber: 'BKG-1', status: BookingStatus.REFUND_PENDING,
    });
  });

  it('refuses a paid refund once the trip has departed', async () => {
    mocks.findBooking.mockResolvedValue(confirmedBooking({ status: TripStatus.COMPLETED, actualStartAt: new Date() }));

    await expect(cancelBooking({ bookingId: 'booking-1', studentId: 'student-1', reason: 'No-show' })).rejects.toMatchObject({
      code: 'TRIP_ALREADY_DEPARTED',
    });
    expect(mocks.updateBooking).not.toHaveBeenCalled();
    expect(mocks.refundBookingPayments).not.toHaveBeenCalled();
  });

  it('still lets an administrator cancel after departure', async () => {
    mocks.findBooking.mockResolvedValue(confirmedBooking({ status: TripStatus.IN_PROGRESS, actualStartAt: new Date() }));

    await cancelBooking({ bookingId: 'booking-1', reason: 'Service disruption', isAdmin: true });

    expect(mocks.updateBooking).toHaveBeenCalled();
  });

  it('cancels and refunds before departure', async () => {
    mocks.findBooking.mockResolvedValue(confirmedBooking({ status: TripStatus.SCHEDULED, actualStartAt: null }));

    await cancelBooking({ bookingId: 'booking-1', studentId: 'student-1', reason: 'Plans changed' });

    expect(mocks.updateBooking).toHaveBeenCalled();
    expect(mocks.refundBookingPayments).toHaveBeenCalledWith('booking-1', 'Plans changed');
  });
});
