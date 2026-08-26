import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute } from '../../lib/async-route.js';
import { optionalAuth, requireAuth } from '../auth/auth.middleware.js';
import { requireRole } from '../auth/auth.middleware.js';
import { Role } from '@prisma/client';
import { createSeatHoldSchema } from '../bookings/booking.schemas.js';
import { createSeatHold, releaseSeatHold } from '../bookings/booking.service.js';
import { routeQuerySchema, tripQuerySchema } from './catalog.schemas.js';
import {
  getRoute,
  getTrip,
  getTripLocation,
  getTripSeats,
  listBuses,
  listRoutes,
  listStops,
  listSubscriptionPlans,
  listTrips,
} from './catalog.service.js';

export const catalogRouter = Router();

catalogRouter.get('/buses', asyncRoute(async (_request, response) => response.json(await listBuses())));
catalogRouter.get('/routes', asyncRoute(async (request, response) => response.json(await listRoutes(routeQuerySchema.parse(request.query)))));
catalogRouter.get('/routes/:id', asyncRoute(async (request, response) => response.json(await getRoute(z.string().uuid().parse(request.params.id)))));
catalogRouter.get(
  '/stops',
  asyncRoute(async (request, response) => {
    const { search } = z.object({ search: z.string().trim().max(100).optional() }).parse(request.query);
    response.json(await listStops(search));
  }),
);
catalogRouter.post(
  '/trips/:id/seat-holds',
  requireAuth,
  requireRole(Role.STUDENT, Role.TEACHER),
  asyncRoute(async (request, response) => {
    const tripId = z.string().uuid().parse(request.params.id);
    const { seatNumber } = createSeatHoldSchema.parse(request.body);
    response.status(201).json(await createSeatHold(tripId, seatNumber, request.auth!.userId));
  }),
);
catalogRouter.delete(
  '/trips/:id/seat-holds/:holdId',
  requireAuth,
  requireRole(Role.STUDENT, Role.TEACHER),
  asyncRoute(async (request, response) => {
    response.json(
      await releaseSeatHold(
        z.string().uuid().parse(request.params.id),
        z.string().uuid().parse(request.params.holdId),
        request.auth!.userId,
      ),
    );
  }),
);
catalogRouter.get('/trips', asyncRoute(async (request, response) => response.json(await listTrips(tripQuerySchema.parse(request.query)))));
catalogRouter.get('/trips/:id', asyncRoute(async (request, response) => response.json(await getTrip(z.string().uuid().parse(request.params.id)))));
catalogRouter.get(
  '/trips/:id/seats',
  optionalAuth,
  asyncRoute(async (request, response) => response.json(await getTripSeats(z.string().uuid().parse(request.params.id), request.auth?.userId))),
);
catalogRouter.get(
  '/trips/:id/location',
  requireAuth,
  asyncRoute(async (request, response) => {
    response.json(await getTripLocation(z.string().uuid().parse(request.params.id)));
  }),
);
catalogRouter.get('/subscription-plans', asyncRoute(async (_request, response) => response.json(await listSubscriptionPlans())));
