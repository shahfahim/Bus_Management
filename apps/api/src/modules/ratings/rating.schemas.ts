import { z } from 'zod';
import { paginationSchema } from '../../lib/pagination.js';

export const ratingQuerySchema = paginationSchema.extend({
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  driverId: z.string().uuid().optional(),
  tripId: z.string().uuid().optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  score: z.coerce.number().int().min(1).max(5).optional(),
  status: z.enum(['published', 'hidden', 'flagged', 'PUBLISHED', 'HIDDEN', 'FLAGGED']).optional(),
});

export const createRatingSchema = z
  .object({
    bookingId: z.string().uuid().optional(),
    tripId: z.string().uuid().optional(),
    driverId: z.string().uuid().optional(),
    score: z.coerce.number().int().min(1).max(5),
    comment: z.string().trim().max(2_000).optional(),
  })
  .refine((value) => value.bookingId || value.tripId, { path: ['bookingId'], message: 'Booking or trip is required' });

export const updateRatingSchema = z
  .object({
    score: z.coerce.number().int().min(1).max(5).optional(),
    comment: z.string().trim().max(2_000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const moderateRatingSchema = z.object({
  status: z.preprocess(
    (value) => (typeof value === 'string' ? value.toUpperCase() : value),
    z.enum(['PUBLISHED', 'HIDDEN', 'FLAGGED']),
  ),
  reason: z.string().trim().min(3).max(1_000).optional(),
});

