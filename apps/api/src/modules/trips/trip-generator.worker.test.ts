import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findSchedules: vi.fn(),
  lock: vi.fn(),
  findTrip: vi.fn(),
  createTrip: vi.fn(),
  createStops: vi.fn(),
}));

vi.mock('../../lib/prisma.js', () => {
  const tx = {
    $queryRaw: mocks.lock,
    trip: { findFirst: mocks.findTrip, create: mocks.createTrip },
    tripStop: { createMany: mocks.createStops },
  };
  return {
    prisma: {
      tripSchedule: { findMany: mocks.findSchedules },
      $transaction: (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    },
  };
});

import { generateTrips, tripMatchesSchedule } from './trip-generator.worker.js';

const everyDaySchedule = {
  id: '6f1c2d3e-0000-4000-8000-000000000001',
  routeId: 'route-1',
  busId: 'bus-1',
  driverId: 'driver-1',
  departureTime: '08:30',
  isActive: true,
  validFrom: new Date('2020-01-01T00:00:00Z'),
  validTo: null,
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  fareAmount: 45,
  route: {
    estimatedDurationMinutes: 60,
    distanceMeters: 1000,
    stops: [
      { id: 'rs-1', sequence: 1, plannedOffsetMinutes: 0, distanceFromStartMeters: 0 },
      { id: 'rs-2', sequence: 2, plannedOffsetMinutes: 60, distanceFromStartMeters: 1000 },
    ],
  },
};

afterEach(() => vi.useRealTimers());

describe('trip generator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 01:00 in Dhaka, so today's 08:30 departure is still ahead.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-22T19:00:00Z'));
    mocks.findSchedules.mockResolvedValue([everyDaySchedule]);
    mocks.createTrip.mockImplementation(({ data }: { data: object }) => Promise.resolve({ id: 'trip-new', ...data }));
  });

  it('creates a week of trips priced from the schedule fare', async () => {
    mocks.findTrip.mockResolvedValue(null);

    await generateTrips();

    expect(mocks.createTrip).toHaveBeenCalledTimes(7);
    for (const [{ data }] of mocks.createTrip.mock.calls as Array<[{ data: { fareAmount: number } }]>) {
      expect(data.fareAmount).toBe(45);
    }
    expect(mocks.createStops).toHaveBeenCalledTimes(7);
  });

  it('checks for an existing trip under the schedule lock and skips duplicates', async () => {
    mocks.findTrip.mockResolvedValue({ id: 'trip-existing' });

    await generateTrips();

    expect(mocks.lock).toHaveBeenCalledTimes(7);
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.findTrip.mock.invocationCallOrder[0]!);
    expect(mocks.createTrip).not.toHaveBeenCalled();
  });

  it('skips a departure that has already passed today', async () => {
    vi.setSystemTime(new Date('2026-09-23T03:00:00Z')); // 09:00 in Dhaka, after the 08:30 departure
    mocks.findTrip.mockResolvedValue(null);

    await generateTrips();

    expect(mocks.createTrip).toHaveBeenCalledTimes(6);
  });

  it('matches trips to the schedule in Dhaka time', () => {
    const trip = { routeId: 'route-1', busId: 'bus-1', scheduledStartAt: new Date('2026-09-23T02:30:00Z') }; // 08:30 Dhaka
    expect(tripMatchesSchedule(trip, everyDaySchedule)).toBe(true);
    expect(tripMatchesSchedule(trip, { ...everyDaySchedule, departureTime: '09:00' })).toBe(false);
    expect(tripMatchesSchedule(trip, { ...everyDaySchedule, daysOfWeek: [1] })).toBe(false); // 2026-09-23 is a Wednesday
    expect(tripMatchesSchedule(trip, { ...everyDaySchedule, busId: 'bus-2' })).toBe(false);
  });
});
