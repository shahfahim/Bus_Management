import { Role, TripStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findTrip: vi.fn(),
  createLocation: vi.fn(),
  updateTrip: vi.fn(),
  emitToTrip: vi.fn(),
}));

vi.mock('../../lib/prisma.js', () => {
  const tx = { tripLocation: { create: mocks.createLocation }, trip: { update: mocks.updateTrip } };
  return {
    prisma: {
      trip: { findUnique: mocks.findTrip },
      $transaction: (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    },
  };
});
vi.mock('../../realtime/hub.js', () => ({ emitToTrip: mocks.emitToTrip, emitToRole: vi.fn() }));
vi.mock('../notifications/notification.service.js', () => ({ notifyUser: vi.fn(), notifyUsers: vi.fn() }));

import { recordLocation } from './tracking.service.js';

const tripId = '00000000-0000-4000-8000-000000000010';
const driver = { userId: 'driver-1', role: Role.DRIVER };
const now = Date.now();

const tripWithPrevious = (recordedAt: Date, latitude = 23.75, longitude = 90.37) => ({
  id: tripId,
  driverId: driver.userId,
  conductorId: null,
  status: TripStatus.IN_PROGRESS,
  locationIntervalSeconds: 10,
  locations: [{ latitude, longitude, recordedAt, accuracyMeters: 10 }],
});

const update = (overrides: Partial<{ latitude: number; longitude: number; capturedAt: Date; isOfflineReplay: boolean }>) => ({
  tripId,
  latitude: 23.7505,
  longitude: 90.3705,
  accuracyMeters: 10,
  capturedAt: new Date(now),
  isOfflineReplay: false,
  ...overrides,
});

describe('driver GPS ingestion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createLocation.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...data, accuracyMeters: null, speedKph: null, headingDegrees: null, receivedAt: new Date() }),
    );
  });

  it('broadcasts the newest position to riders', async () => {
    mocks.findTrip.mockResolvedValueOnce(tripWithPrevious(new Date(now - 60_000))).mockResolvedValue(null);

    const result = await recordLocation(update({}), driver);

    expect(result).toMatchObject({ accepted: true });
    expect(mocks.emitToTrip).toHaveBeenCalledWith(tripId, 'trip:location', expect.any(Object));
    expect(mocks.updateTrip).toHaveBeenCalled();
  });

  it('stores an out-of-order offline replay without publishing it as the live position', async () => {
    mocks.findTrip.mockResolvedValueOnce(tripWithPrevious(new Date(now - 60_000))).mockResolvedValue(null);

    const result = await recordLocation(update({ capturedAt: new Date(now - 5 * 60_000), isOfflineReplay: true }), driver);

    expect(result).toMatchObject({ accepted: true, stale: true });
    expect(mocks.createLocation).toHaveBeenCalled();
    expect(mocks.emitToTrip).not.toHaveBeenCalled();
    expect(mocks.updateTrip).not.toHaveBeenCalled();
  });

  it('rejects a physically impossible jump from the previous fix', async () => {
    mocks.findTrip.mockResolvedValueOnce(tripWithPrevious(new Date(now - 30_000)));

    // Roughly 60 km in 30 seconds.
    await expect(recordLocation(update({ latitude: 24.3, longitude: 90.37 }), driver)).rejects.toMatchObject({
      code: 'IMPLAUSIBLE_LOCATION',
    });
    expect(mocks.createLocation).not.toHaveBeenCalled();
  });
});
