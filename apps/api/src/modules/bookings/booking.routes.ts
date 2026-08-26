import { Router } from 'express';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { asyncRoute } from '../../lib/async-route.js';
import { AppError } from '../../lib/errors.js';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';
import { bookingListSchema, createBookingSchema, finalizeSeatHoldSchema } from './booking.schemas.js';
import { cancelBooking, createBooking, finalizeSeatHold, getBooking, listBookings } from './booking.service.js';

export const bookingRouter = Router();
bookingRouter.use(requireAuth);

bookingRouter.get(
  '/',
  requireRole(Role.STUDENT, Role.TEACHER),
  asyncRoute(async (request, response) => {
    response.json(await listBookings(request.auth!.userId, bookingListSchema.parse(request.query)));
  }),
);

bookingRouter.post(
  '/',
  requireRole(Role.STUDENT, Role.TEACHER),
  asyncRoute(async (request, response) => {
    const key = request.get('idempotency-key')?.trim();
    if (key && (key.length < 8 || key.length > 128)) {
      throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must contain 8 to 128 characters');
    }
    const body = z.object({ seatHoldId: z.unknown().optional() }).passthrough().parse(request.body);
    const booking = body.seatHoldId !== undefined
      ? await finalizeSeatHold(request.auth!.userId, finalizeSeatHoldSchema.parse(request.body), key)
      : await createBooking({
          studentId: request.auth!.userId,
          input: createBookingSchema.parse(request.body),
          idempotencyKey: key,
        });
    response.status(201).json(booking);
  }),
);

bookingRouter.get(
  '/:id',
  asyncRoute(async (request, response) => {
    response.json(
      await getBooking(z.string().uuid().parse(request.params.id), {
        userId: request.auth!.userId,
        isAdmin: request.auth!.role === Role.ADMIN,
      }),
    );
  }),
);

const cancellationSchema = z.object({ reason: z.string().trim().min(3).max(500).default('Cancelled by rider') });
const cancelHandler = asyncRoute(async (request, response) => {
  if (request.auth!.role !== Role.STUDENT && request.auth!.role !== Role.TEACHER) {
    throw new AppError(403, 'FORBIDDEN', 'Only the rider may cancel this booking');
  }
  const { reason } = cancellationSchema.parse(request.body ?? {});
  response.json(await cancelBooking({ bookingId: z.string().uuid().parse(request.params.id), studentId: request.auth!.userId, reason }));
});

bookingRouter.post('/:id/cancel', cancelHandler);
bookingRouter.delete('/:id', cancelHandler);
