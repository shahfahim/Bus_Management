import { z } from 'zod';

const tripLocationSchema = z.object({
  name: z.string().trim().min(2).max(100),
  address: z.string().trim().max(300).optional(),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
});

export const createDriverTripSchema = z
  .object({
    busId: z.string().uuid(),
    origin: tripLocationSchema,
    destination: tripLocationSchema,
    scheduledStart: z.coerce.date(),
    scheduledEnd: z.coerce.date(),
    fare: z.coerce.number().nonnegative().max(100_000),
  })
  .refine((value) => value.scheduledStart > new Date(Date.now() - 5 * 60_000), {
    path: ['scheduledStart'],
    message: 'Departure cannot be in the past',
  })
  .refine((value) => value.scheduledEnd > value.scheduledStart, {
    path: ['scheduledEnd'],
    message: 'Arrival must be after departure',
  })
  .refine((value) => value.scheduledEnd.getTime() - value.scheduledStart.getTime() <= 24 * 60 * 60_000, {
    path: ['scheduledEnd'],
    message: 'A custom trip cannot exceed 24 hours',
  });

export const locationUpdateSchema = z.object({
  tripId: z.string().trim().min(5).max(100),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().nonnegative().max(10_000).optional(),
  speedKph: z.number().nonnegative().max(200).nullable().optional(),
  heading: z.number().min(0).max(360).nullable().optional(),
  altitudeMeters: z.number().min(-500).max(10_000).nullable().optional(),
  capturedAt: z.coerce.date(),
  sequence: z.number().int().nonnegative().optional(),
  batteryLevel: z.number().min(0).max(1).optional(),
  isOfflineReplay: z.boolean().default(false),
});

export const incidentSchema = z.object({
  tripId: z.preprocess((value) => (value === '' ? undefined : value), z.string().uuid().optional()),
  category: z.enum([
    'EMERGENCY',
    'ACCIDENT',
    'BREAKDOWN',
    'VEHICLE',
    'TRAFFIC',
    'ROADBLOCK',
    'CONSTRUCTION',
    'WEATHER',
    'SAFETY',
    'OTHER',
  ]),
  title: z.string().trim().min(3).max(150),
  description: z.string().trim().min(5).max(2_000),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
});
