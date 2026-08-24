import { MaintenanceStatus, MaintenanceType } from '@prisma/client';
import { z } from 'zod';
import { paginationSchema } from '../../lib/pagination.js';

const enumValue = <T extends z.EnumLike>(values: T, aliases: Record<string, string> = {}) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const normalized = value.trim().toUpperCase().replaceAll('-', '_').replaceAll(' ', '_');
    return aliases[normalized] ?? normalized;
  }, z.nativeEnum(values));

const optionalDate = z.coerce.date().optional();

export const maintenanceQuerySchema = paginationSchema.extend({
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  busId: z.string().uuid().optional(),
  status: enumValue(MaintenanceStatus).optional(),
  active: z
    .preprocess((value) => (value === 'true' ? true : value === 'false' ? false : value), z.boolean())
    .optional(),
});

export const createMaintenanceSchema = z
  .object({
    busId: z.string().uuid(),
    type: enumValue(MaintenanceType, { SCHEDULED_SERVICE: MaintenanceType.PREVENTIVE, EMERGENCY: MaintenanceType.BREAKDOWN }),
    status: enumValue(MaintenanceStatus).default(MaintenanceStatus.SCHEDULED),
    title: z.string().trim().min(3).max(200).optional(),
    reason: z.string().trim().min(3).max(200).optional(),
    description: z.string().trim().min(3).max(5_000).optional(),
    startsAt: z.coerce.date(),
    expectedReturnAt: optionalDate,
    expectedAvailableAt: optionalDate,
    cost: z.coerce.number().nonnegative().max(100_000_000).optional(),
    notes: z.string().trim().max(5_000).optional(),
  })
  .superRefine((value, context) => {
    if (!value.title && !value.reason) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['title'], message: 'A title or reason is required' });
    }
    const expected = value.expectedReturnAt ?? value.expectedAvailableAt;
    if (expected && expected <= value.startsAt) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['expectedReturnAt'], message: 'Expected return must be after the start time' });
    }
  });

export const updateMaintenanceSchema = z
  .object({
    type: enumValue(MaintenanceType, { SCHEDULED_SERVICE: MaintenanceType.PREVENTIVE, EMERGENCY: MaintenanceType.BREAKDOWN }).optional(),
    status: enumValue(MaintenanceStatus).optional(),
    title: z.string().trim().min(3).max(200).optional(),
    reason: z.string().trim().min(3).max(200).optional(),
    description: z.string().trim().min(3).max(5_000).optional(),
    startsAt: optionalDate,
    expectedReturnAt: optionalDate.nullable(),
    expectedAvailableAt: optionalDate.nullable(),
    cost: z.coerce.number().nonnegative().max(100_000_000).nullable().optional(),
    notes: z.string().trim().max(5_000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

