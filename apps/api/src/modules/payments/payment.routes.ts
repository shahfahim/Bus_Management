import { Router } from 'express';
import { PaymentStatus, Role } from '@prisma/client';
import { z } from 'zod';
import { asyncRoute } from '../../lib/async-route.js';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';
import { payWithCreditsSchema, refundSchema } from './payment.schemas.js';
import { getReceipt, listPayments, payWithCredits, refundPayment } from './payment.service.js';

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

// Pays for a pending booking or buys a bus pass from the student's credits. /checkout is the
// path older clients used for card checkout.
paymentRouter.post(
  ['/pay', '/checkout'],
  requireRole(Role.STUDENT),
  asyncRoute(async (request, response) => {
    const input = payWithCreditsSchema.parse(request.body);
    response.status(201).json(
      await payWithCredits({
        userId: request.auth!.userId,
        bookingId: input.bookingId,
        subscriptionPlanId: input.subscriptionPlanId,
        idempotencyKey: request.get('idempotency-key'),
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
