import { z } from 'zod';

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
