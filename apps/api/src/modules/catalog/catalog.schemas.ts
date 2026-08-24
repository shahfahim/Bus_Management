import { z } from 'zod';

export const tripQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  routeId: z.string().trim().min(5).max(100).optional(),
  stopId: z.string().trim().min(5).max(100).optional(),
  originStopId: z.string().uuid().optional(),
  destinationStopId: z.string().uuid().optional(),
  date: z.string().date().optional(),
  status: z
    .preprocess(
      (value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]),
      z.array(z.enum(['SCHEDULED', 'BOARDING', 'IN_PROGRESS', 'DELAYED', 'CANCELLED', 'COMPLETED'])).max(6),
    )
    .optional(),
});

export const routeQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  stopId: z.string().trim().min(5).max(100).optional(),
});
