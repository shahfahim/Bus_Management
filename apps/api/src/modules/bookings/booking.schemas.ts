import { z } from 'zod';

export const bookingStatusSchema = z.enum([
  'PENDING_PAYMENT',
  'CONFIRMED',
  'CHECKED_IN',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
  'REFUNDED',
]);

export const bookingFilterStatusSchema = z.union([bookingStatusSchema, z.enum(['PENDING', 'UPCOMING', 'ALL'])]);

export const createBookingSchema = z.object({
  tripId: z.string().trim().min(5).max(100),
  seatId: z.string().trim().min(5).max(100),
  pickupStopId: z.string().trim().min(5).max(100),
  dropoffStopId: z.string().trim().min(5).max(100),
  subscriptionId: z.string().trim().min(5).max(100).optional(),
});

export const createSeatHoldSchema = z.object({
  seatNumber: z.string().trim().min(1).max(16),
});

export const finalizeSeatHoldSchema = z.object({
  tripId: z.string().uuid(),
  seatHoldId: z.string().uuid(),
  seatNumber: z.string().trim().min(1).max(16),
  boardingStopId: z.string().uuid(),
  destinationStopId: z.string().uuid(),
  subscriptionId: z.string().uuid().optional(),
});

// z.coerce.boolean() would read the query string "false" as true.
const queryFlag = z.enum(['true', 'false']).transform((value) => value === 'true').optional();

export const bookingListSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: bookingFilterStatusSchema.optional(),
  upcoming: queryFlag,
  unrated: queryFlag,
  limit: z.coerce.number().int().min(1).max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
