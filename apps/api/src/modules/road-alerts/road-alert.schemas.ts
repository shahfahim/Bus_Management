import { AlertSeverity, RoadAlertCategory, RoadAlertStatus } from '@prisma/client';
import { z } from 'zod';
import { paginationSchema } from '../../lib/pagination.js';

const enumValue = <T extends z.EnumLike>(values: T, aliases: Record<string, string> = {}) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const normalized = value.trim().toUpperCase().replaceAll('-', '_').replaceAll(' ', '_');
    return aliases[normalized] ?? normalized;
  }, z.nativeEnum(values));

const routeIdsSchema = z
  .array(z.string().uuid())
  .min(1)
  .max(100)
  .transform((routeIds) => [...new Set(routeIds)]);

export const roadAlertQuerySchema = paginationSchema.extend({
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  routeId: z.string().uuid().optional(),
  category: enumValue(RoadAlertCategory).optional(),
  severity: enumValue(AlertSeverity, { LOW: AlertSeverity.MINOR, MEDIUM: AlertSeverity.MODERATE, HIGH: AlertSeverity.MAJOR, SEVERE: AlertSeverity.MAJOR }).optional(),
  status: enumValue(RoadAlertStatus, { SCHEDULED: RoadAlertStatus.DRAFT }).optional(),
  active: z
    .preprocess((value) => (value === 'true' ? true : value === 'false' ? false : value), z.boolean())
    .optional(),
});

export const createRoadAlertSchema = z
  .object({
    routeId: z.string().uuid().optional(),
    routeIds: routeIdsSchema.optional(),
    category: enumValue(RoadAlertCategory),
    severity: enumValue(AlertSeverity, { LOW: AlertSeverity.MINOR, MEDIUM: AlertSeverity.MODERATE, HIGH: AlertSeverity.MAJOR, SEVERE: AlertSeverity.MAJOR }),
    status: enumValue(RoadAlertStatus, { SCHEDULED: RoadAlertStatus.DRAFT }).default(RoadAlertStatus.ACTIVE),
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().min(3).max(5_000),
    locationText: z.string().trim().min(2).max(1_000).optional(),
    location: z.string().trim().min(2).max(1_000).optional(),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    startsAt: z.coerce.date().default(() => new Date()),
    endsAt: z.coerce.date().optional(),
    notifyAffectedStudents: z.boolean().default(true),
  })
  .superRefine((value, context) => {
    if (!value.routeId && !value.routeIds?.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['routeIds'], message: 'At least one affected route is required' });
    }
    if (value.endsAt && value.endsAt <= value.startsAt) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['endsAt'], message: 'End time must be after start time' });
    }
    if ((value.latitude === undefined) !== (value.longitude === undefined)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['latitude'], message: 'Latitude and longitude must be provided together' });
    }
  });

export const updateRoadAlertSchema = z
  .object({
    routeId: z.string().uuid().optional(),
    routeIds: routeIdsSchema.optional(),
    category: enumValue(RoadAlertCategory).optional(),
    severity: enumValue(AlertSeverity, { LOW: AlertSeverity.MINOR, MEDIUM: AlertSeverity.MODERATE, HIGH: AlertSeverity.MAJOR, SEVERE: AlertSeverity.MAJOR }).optional(),
    status: enumValue(RoadAlertStatus, { SCHEDULED: RoadAlertStatus.DRAFT }).optional(),
    title: z.string().trim().min(3).max(200).optional(),
    description: z.string().trim().min(3).max(5_000).optional(),
    locationText: z.string().trim().min(2).max(1_000).nullable().optional(),
    location: z.string().trim().min(2).max(1_000).nullable().optional(),
    latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
    longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().nullable().optional(),
    notifyAffectedStudents: z.boolean().default(true),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

