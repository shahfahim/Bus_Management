import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as TripGenerator from '../trips/trip-generator.worker.js';

const mocks = vi.hoisted(() => ({
  findSchedule: vi.fn(),
  updateSchedule: vi.fn(),
  findTrips: vi.fn(),
  cancelAdminTrip: vi.fn(),
  updateAdminTrip: vi.fn(),
  generateTrips: vi.fn(),
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    tripSchedule: { findUnique: mocks.findSchedule, update: mocks.updateSchedule },
    trip: { findMany: mocks.findTrips },
  },
}));
vi.mock('./trip-admin.service.js', () => ({ cancelAdminTrip: mocks.cancelAdminTrip, updateAdminTrip: mocks.updateAdminTrip }));
vi.mock('./audit.service.js', () => ({ writeAuditLog: vi.fn() }));
vi.mock('../trips/trip-generator.worker.js', async (importOriginal) => ({
  ...(await importOriginal<typeof TripGenerator>()),
  generateTrips: mocks.generateTrips,
}));

import { SCHEDULE_CHANGE_CANCELLATION_REASON } from '../trips/trip-generator.worker.js';
import { updateSchedule } from './schedule-admin.service.js';

const context = { actorId: 'admin-1' };
const schedule = {
  id: 'schedule-1',
  routeId: 'route-1',
  busId: 'bus-1',
  driverId: 'driver-1',
  departureTime: '08:30',
  isActive: true,
  validFrom: new Date('2026-01-01T00:00:00Z'),
  validTo: null,
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  fareAmount: 40,
};
// 2026-09-23 is a Wednesday (weekday 3); 02:30 UTC is 08:30 in Dhaka.
const wednesdayTrip = { id: 'trip-wed', routeId: 'route-1', busId: 'bus-1', driverId: 'driver-1', scheduledStartAt: new Date('2026-09-23T02:30:00Z'), fareAmount: 40 };
const thursdayTrip = { ...wednesdayTrip, id: 'trip-thu', scheduledStartAt: new Date('2026-09-24T02:30:00Z') };

describe('schedule updates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findSchedule.mockResolvedValue(schedule);
    mocks.generateTrips.mockResolvedValue(undefined);
    mocks.findTrips.mockResolvedValue([wednesdayTrip, thursdayTrip]);
  });

  it('cancels only trips that no longer match, through the booking-aware admin path', async () => {
    mocks.updateSchedule.mockResolvedValue({ ...schedule, daysOfWeek: [3] }); // Wednesdays only

    await updateSchedule('schedule-1', { daysOfWeek: [3] }, context);

    expect(mocks.cancelAdminTrip).toHaveBeenCalledTimes(1);
    expect(mocks.cancelAdminTrip).toHaveBeenCalledWith('trip-thu', SCHEDULE_CHANGE_CANCELLATION_REASON, context);
    expect(mocks.updateAdminTrip).not.toHaveBeenCalled();
  });

  it('keeps matching trips and their bookings when only the fare changes', async () => {
    mocks.updateSchedule.mockResolvedValue({ ...schedule, fareAmount: 55 });

    await updateSchedule('schedule-1', { fareAmount: 55 }, context);

    expect(mocks.cancelAdminTrip).not.toHaveBeenCalled();
    expect(mocks.updateAdminTrip).toHaveBeenCalledWith('trip-wed', { fare: 55 }, context);
    expect(mocks.updateAdminTrip).toHaveBeenCalledWith('trip-thu', { fare: 55 }, context);
  });

  it('rejects a validity window that ends before it starts', async () => {
    await expect(
      updateSchedule('schedule-1', { validTo: new Date('2025-01-01T00:00:00Z') }, context as never),
    ).rejects.toMatchObject({ code: 'INVALID_SCHEDULE_WINDOW' });
    expect(mocks.updateSchedule).not.toHaveBeenCalled();
  });
});
