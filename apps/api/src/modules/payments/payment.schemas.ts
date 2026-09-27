import { z } from 'zod';

export const payWithCreditsSchema = z
  .object({
    bookingId: z.string().trim().uuid().optional(),
    subscriptionPlanId: z.string().trim().uuid().optional(),
  })
  .refine((value) => Number(Boolean(value.bookingId)) + Number(Boolean(value.subscriptionPlanId)) === 1, {
    message: 'Supply exactly one of bookingId or subscriptionPlanId',
  });

export const refundSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
