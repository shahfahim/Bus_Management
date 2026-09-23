import { Router, text, type Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { asyncRoute } from '../../lib/async-route.js';
import { sha256 } from '../../lib/security.js';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';
import {
  BoardingRejection,
  authenticateDoorReader,
  checkInWithBoardingCode,
  getBoardingCard,
  reissueBoardingCard,
} from './boarding.service.js';

export const boardingRouter = Router();

// Readers and forms send the scanned value as JSON ({ "code": … }), form data or plain text.
const scanSchema = z.union([
  z.string().trim().min(1).max(128).transform((code) => ({ code })),
  z.object({
    code: z.string().trim().min(1).max(128).optional(),
    barcode: z.string().trim().min(1).max(128).optional(),
  })
    .refine((value) => value.code ?? value.barcode, { message: 'A scanned code is required' })
    .transform((value) => ({ code: (value.code ?? value.barcode)! })),
]);

// A refused scan answers with a flat body a door device can act on (red light / buzzer).
const sendScanResult = async (response: Response, scan: () => Promise<unknown>) => {
  try {
    response.json(await scan());
  } catch (error: unknown) {
    if (!(error instanceof BoardingRejection)) throw error;
    response.status(error.statusCode).json({ accepted: false, code: error.code, message: error.message, passenger: error.passenger });
  }
};

const readerLimiter = rateLimit({
  windowMs: 60_000,
  limit: 240,
  keyGenerator: (request) => {
    const key = request.get('x-door-reader-key');
    return key ? sha256(key) : ipKeyGenerator(request.ip ?? 'unknown');
  },
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { accepted: false, code: 'RATE_LIMITED', message: 'Too many scans; slow down' },
});

/** Bus door reader: authenticates with its own key and checks the scanned rider in. */
boardingRouter.post(
  '/check-ins',
  readerLimiter,
  text({ type: 'text/plain', limit: '1kb' }),
  asyncRoute(async (request, response) => {
    const reader = await authenticateDoorReader(request.get('x-door-reader-key')?.trim());
    const { code } = scanSchema.parse(request.body);
    await sendScanResult(response, () => checkInWithBoardingCode(code, reader));
  }),
);

/** Fallback when a reader is down: the assigned driver or conductor types the rider's code. */
boardingRouter.post(
  '/trips/:tripId/check-ins',
  requireAuth,
  requireRole(Role.DRIVER, Role.CONDUCTOR, Role.ADMIN),
  asyncRoute(async (request, response) => {
    const tripId = z.string().uuid().parse(request.params.tripId);
    const { code } = scanSchema.parse(request.body);
    await sendScanResult(response, () =>
      checkInWithBoardingCode(code, { userId: request.auth!.userId, role: request.auth!.role, tripId }),
    );
  }),
);

const reissueLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 5,
  keyGenerator: (request) => request.auth?.userId ?? ipKeyGenerator(request.ip ?? 'unknown'),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many reissue requests; please try again later' } },
});

boardingRouter.get(
  '/card',
  requireAuth,
  requireRole(Role.STUDENT),
  asyncRoute(async (request, response) => response.json(await getBoardingCard(request.auth!.userId))),
);

boardingRouter.post(
  '/card/reissue',
  requireAuth,
  requireRole(Role.STUDENT),
  reissueLimiter,
  asyncRoute(async (request, response) => response.json(await reissueBoardingCard(request.auth!.userId))),
);
