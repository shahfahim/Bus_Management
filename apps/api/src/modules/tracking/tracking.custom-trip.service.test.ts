import { AssignmentStatus, BusStatus, DriverStatus, Role, TripStatus, UserStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), queryRaw: vi.fn(), findProfile: vi.fn(), findAssignment: vi.fn(), findConflict: vi.fn(),
  findMaintenance: vi.fn(), createStop: vi.fn(), createRoute: vi.fn(), createRouteStop: vi.fn(), createTrip: vi.fn(),
  createTripStops: vi.fn(), createAudit: vi.fn(), countTrips: vi.fn(), findTrip: vi.fn(), emitToRole: vi.fn(),
}));

vi.mock('../../lib/prisma.js', () => ({ prisma: { $transaction: mocks.transaction, trip: { findUnique: mocks.findTrip } } }));
vi.mock('../../realtime/hub.js', () => ({
  emitToRole: mocks.emitToRole,
  emitToTrip: vi.fn(),
}));

import { createDriverTrip } from './tracking.service.js';

const driverId = '00000000-0000-4000-8000-000000000001';
const busId = '00000000-0000-4000-8000-000000000002';
const tripId = '00000000-0000-4000-8000-000000000003';
const start = new Date(Date.now() + 60 * 60_000);
const end = new Date(Date.now() + 2 * 60 * 60_000);
const bus = { id: busId, fleetNumber: 'BUS-01', registrationNumber: 'DHAKA-01', capacity: 32, status: BusStatus.ACTIVE };
const profile = {
  userId: driverId,
  status: DriverStatus.ACTIVE,
  licenseExpiresAt: new Date('2035-01-01T00:00:00.000Z'),
  user: { status: UserStatus.ACTIVE },
};

const input = {
  busId,
  origin: { name: 'Pickup', latitude: 23.75, longitude: 90.37 },
  destination: { name: 'University Campus', latitude: 23.7289, longitude: 90.3984 },
  scheduledStart: start,
  scheduledEnd: end,
  fare: 50,
};

describe('driver custom trip creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryRaw.mockResolvedValue([]);
    mocks.findProfile.mockResolvedValue(profile);
    mocks.findAssignment.mockResolvedValue({ id: 'assignment-1', busId, status: AssignmentStatus.ACTIVE, bus });
    mocks.findConflict.mockResolvedValue(null);
    mocks.countTrips.mockResolvedValue(0);
    mocks.findMaintenance.mockResolvedValue(null);
    mocks.createStop
      .mockResolvedValueOnce({ id: 'origin-stop' })
      .mockResolvedValueOnce({ id: 'destination-stop' });
    mocks.createRoute.mockResolvedValue({ id: 'route-1' });
    mocks.createRouteStop
      .mockResolvedValueOnce({ id: 'origin-route-stop' })
      .mockResolvedValueOnce({ id: 'destination-route-stop' });
    mocks.createTrip.mockResolvedValue({
      id: tripId, publicCode: 'DRV-TEST', routeId: 'route-1', busId, driverId,
      scheduledStartAt: start, scheduledEndAt: end,
    });
    mocks.createTripStops.mockResolvedValue({ count: 2 });
    mocks.createAudit.mockResolvedValue({});
    const tx = {
      $queryRaw: mocks.queryRaw,
      driverProfile: { findUnique: mocks.findProfile },
      driverAssignment: { findFirst: mocks.findAssignment },
      trip: { findFirst: mocks.findConflict, count: mocks.countTrips, create: mocks.createTrip },
      maintenanceRecord: { findFirst: mocks.findMaintenance },
      stop: { create: mocks.createStop },
      route: { create: mocks.createRoute },
      routeStop: { create: mocks.createRouteStop },
      tripStop: { createMany: mocks.createTripStops },
      auditLog: { create: mocks.createAudit },
    };
    mocks.transaction.mockImplementation((operation: (client: unknown) => unknown) => operation(tx));
    mocks.findTrip.mockResolvedValue({
      id: tripId,
      publicCode: 'DRV-TEST',
      routeId: 'route-1',
      route: {
        id: 'route-1', code: 'DRV-ROUTE', name: 'Pickup to University Campus',
        stops: [
          { sequence: 1, stop: { id: 'origin-stop', name: 'Pickup', latitude: 23.75, longitude: 90.37 } },
          { sequence: 2, stop: { id: 'destination-stop', name: 'University Campus', latitude: 23.7289, longitude: 90.3984 } },
        ],
      },
      busId, bus,
      driverId, conductorId: null,
      scheduledStartAt: start, scheduledEndAt: end,
      actualStartAt: null, actualEndAt: null,
      fareAmount: 50, currency: 'BDT', status: TripStatus.SCHEDULED, trackingStatus: 'NOT_STARTED',
      locationIntervalSeconds: 15, delayMinutes: 0, locations: [], stops: [],
      _count: { bookings: 0, checkIns: 0 },
    });
  });

  it('creates the route, two stops, trip, timings, and audit record atomically', async () => {
    const result = await createDriverTrip(driverId, input);
    expect(mocks.createStop).toHaveBeenCalledTimes(2);
    expect(mocks.createRoute).toHaveBeenCalledOnce();
    expect(mocks.createTrip).toHaveBeenCalledOnce();
    const tripStopsInput = mocks.createTripStops.mock.calls[0]?.[0] as unknown as { data: Array<{ sequence: number }> };
    expect(tripStopsInput.data.map(({ sequence }) => sequence)).toEqual([1, 2]);
    expect(mocks.createAudit).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ id: tripId, route: { origin: 'Pickup', destination: 'University Campus' } });
    expect(mocks.emitToRole).toHaveBeenCalledWith(Role.ADMIN, 'trip:updated', expect.objectContaining({ id: tripId }));
  });

  it('rejects a bus that is not assigned to the driver for the full trip window', async () => {
    mocks.findAssignment.mockResolvedValue(null);
    await expect(createDriverTrip(driverId, input)).rejects.toMatchObject({ statusCode: 403, code: 'BUS_NOT_ASSIGNED' });
    expect(mocks.createStop).not.toHaveBeenCalled();
  });

  it('caps unfinished future custom trips to prevent route spam', async () => {
    mocks.countTrips.mockResolvedValue(20);
    await expect(createDriverTrip(driverId, input)).rejects.toMatchObject({
      statusCode: 409,
      code: 'CUSTOM_TRIP_LIMIT_REACHED',
    });
    expect(mocks.createStop).not.toHaveBeenCalled();
  });
});
