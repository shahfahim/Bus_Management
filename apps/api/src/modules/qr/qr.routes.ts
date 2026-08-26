import { Router } from 'express';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { asyncRoute } from '../../lib/async-route.js';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';
import { scanQrSchema } from './qr.schemas.js';
import { getBookingQr, rotateBookingQr, scanBookingQr } from './qr.service.js';

export const bookingQrRouter = Router();
bookingQrRouter.use(requireAuth, requireRole(Role.STUDENT, Role.TEACHER));
bookingQrRouter.get(
  '/:id/qr',
  asyncRoute(async (request, response) => {
    response.json(await getBookingQr(z.string().uuid().parse(request.params.id), request.auth!.userId));
  }),
);
bookingQrRouter.post(
  '/:id/qr',
  asyncRoute(async (request, response) => {
    response.json(await rotateBookingQr(z.string().uuid().parse(request.params.id), request.auth!.userId));
  }),
);

export const driverCheckInRouter = Router();
driverCheckInRouter.use(requireAuth, requireRole(Role.DRIVER, Role.CONDUCTOR, Role.ADMIN));
driverCheckInRouter.post(
  '/check-ins/scan',
  asyncRoute(async (request, response) => {
    const body = z.object({ token: z.unknown().optional(), qrToken: z.unknown().optional() }).passthrough().parse(request.body);
    const input = scanQrSchema.parse({ ...body, token: body.token ?? body.qrToken });
    response.json(
      await scanBookingQr({
        token: input.token,
        requestedTripId: input.tripId,
        scanner: { userId: request.auth!.userId, role: request.auth!.role },
      }),
    );
  }),
);
