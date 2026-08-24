import { z } from 'zod';

export const checkoutSchema = z
  .object({
    bookingId: z.string().trim().min(5).max(100).optional(),
    subscriptionPlanId: z.string().trim().min(5).max(100).optional(),
    successUrl: z.string().url().optional(),
    cancelUrl: z.string().url().optional(),
    returnUrl: z.string().url().optional(),
  })
  .refine((value) => Number(Boolean(value.bookingId)) + Number(Boolean(value.subscriptionPlanId)) === 1, {
    message: 'Supply exactly one of bookingId or subscriptionPlanId',
  });

export const refundSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
