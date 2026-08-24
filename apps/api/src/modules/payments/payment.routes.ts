import { Router, raw } from 'express';
import { PaymentStatus, Role } from '@prisma/client';
import { z } from 'zod';
import { asyncRoute } from '../../lib/async-route.js';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';
import { checkoutSchema, refundSchema } from './payment.schemas.js';
import { createCheckout, getReceipt, handleStripeWebhook, listPayments, refundPayment } from './payment.service.js';

export const stripeWebhookRouter = Router();
stripeWebhookRouter.post(
  '/stripe',
  raw({ type: 'application/json', limit: '1mb' }),
  asyncRoute(async (request, response) => {
    response.json(await handleStripeWebhook(request.body as Buffer, request.get('stripe-signature')));
  }),
);

export const paymentRouter = Router();
paymentRouter.use(requireAuth);

paymentRouter.get(
  '/',
  asyncRoute(async (request, response) => {
    const query = z
      .object({
        page: z.coerce.number().int().positive().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
        status: z.preprocess(
          (value) => (value === 'SUCCESS' ? PaymentStatus.SUCCEEDED : value),
          z.nativeEnum(PaymentStatus).optional(),
        ),
      })
      .parse(request.query);
    response.json(await listPayments(request.auth!.userId, query));
  }),
);

paymentRouter.post(
  '/checkout',
  requireRole(Role.STUDENT),
  asyncRoute(async (request, response) => {
    const input = checkoutSchema.parse(request.body);
    response.status(201).json(
      await createCheckout({
        userId: request.auth!.userId,
        bookingId: input.bookingId,
        subscriptionPlanId: input.subscriptionPlanId,
        idempotencyKey: request.get('idempotency-key'),
        successUrl: input.successUrl ?? input.returnUrl,
        cancelUrl: input.cancelUrl,
      }),
    );
  }),
);

paymentRouter.get(
  '/:id/receipt',
  asyncRoute(async (request, response) => {
    response.json(
      await getReceipt(z.string().uuid().parse(request.params.id), {
        userId: request.auth!.userId,
        isAdmin: request.auth!.role === Role.ADMIN,
      }),
    );
  }),
);

paymentRouter.post(
  '/:id/refund',
  requireRole(Role.ADMIN),
  asyncRoute(async (request, response) => {
    const { reason } = refundSchema.parse(request.body);
    response.status(202).json(await refundPayment(z.string().uuid().parse(request.params.id), reason));
  }),
);
