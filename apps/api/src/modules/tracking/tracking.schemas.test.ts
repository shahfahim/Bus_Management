import { describe, expect, it } from 'vitest';
import { TripStatus } from '@prisma/client';
import { createDriverTripSchema, driverTripQuerySchema } from './tracking.schemas.js';

const validTrip = {
  busId: '00000000-0000-4000-8000-000000000001',
  origin: { name: 'My current location', latitude: 23.75, longitude: 90.37 },
  destination: { name: 'University Campus', latitude: 23.7289, longitude: 90.3984 },
  scheduledStart: new Date(Date.now() + 60 * 60_000).toISOString(),
  scheduledEnd: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
  fare: 50,
};

describe('driver custom trip validation', () => {
  it('accepts arbitrary valid pickup and destination coordinates', () => {
    const result = createDriverTripSchema.parse(validTrip);
    expect(result.origin.latitude).toBe(23.75);
    expect(result.destination.name).toBe('University Campus');
  });

  it('rejects an arrival before departure', () => {
    expect(() => createDriverTripSchema.parse({ ...validTrip, scheduledEnd: validTrip.scheduledStart })).toThrow();
  });

  it('rejects invalid coordinates and trips longer than 24 hours', () => {
    expect(() => createDriverTripSchema.parse({ ...validTrip, origin: { ...validTrip.origin, latitude: 100 } })).toThrow();
    expect(() => createDriverTripSchema.parse({
      ...validTrip,
      scheduledEnd: new Date(Date.now() + 26 * 60 * 60_000).toISOString(),
    })).toThrow();
  });
});

describe('driver trip filters', () => {
  it('accepts the service date and active flag used by the driver panel', () => {
    expect(driverTripQuerySchema.parse({ date: '2026-08-28', active: 'true' })).toMatchObject({
      date: '2026-08-28',
      active: true,
      page: 1,
      pageSize: 20,
    });
    expect(driverTripQuerySchema.parse({ status: 'DELAYED' }).status).toBe(TripStatus.DELAYED);
  });

  it('rejects malformed dates and boolean filters', () => {
    expect(() => driverTripQuerySchema.parse({ date: '28-08-2026' })).toThrow();
    expect(() => driverTripQuerySchema.parse({ active: 'yes' })).toThrow();
  });
});
