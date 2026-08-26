import { Router } from 'express';
import { Role, TripStatus } from '@prisma/client';
import { z } from 'zod';
import { asyncRoute } from '../../lib/async-route.js';
import { uploadRateLimit } from '../../lib/upload-rate-limit.js';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';
import { incidentSchema, locationUpdateSchema } from './tracking.schemas.js';
import {
  endTrip,
  getDriverProfile,
  getDriverTrip,
  listDriverTrips,
  listPassengers,
  recordLocation,
  reportIncident,
  startTrip,
} from './tracking.service.js';
import {
  incidentUpload,
  persistIncidentUpload,
  removeIncidentUpload,
  sendIncidentImage,
} from './tracking.upload.js';

export const driverRouter = Router();
driverRouter.use(requireAuth, requireRole(Role.DRIVER, Role.CONDUCTOR, Role.ADMIN));

driverRouter.get(
  '/profile',
  asyncRoute(async (request, response) => response.json(await getDriverProfile(request.auth!.userId))),
);
driverRouter.get(
  '/trips',
  asyncRoute(async (request, response) => {
    const query = z
      .object({
        page: z.coerce.number().int().positive().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
        status: z.nativeEnum(TripStatus).optional(),
      })
      .parse(request.query);
    response.json(await listDriverTrips(request.auth!, query));
  }),
);
driverRouter.get(
  '/trips/:id',
  asyncRoute(async (request, response) => response.json(await getDriverTrip(z.string().uuid().parse(request.params.id), request.auth!))),
);
driverRouter.post(
  '/trips/:id/start',
  asyncRoute(async (request, response) => response.json(await startTrip(z.string().uuid().parse(request.params.id), request.auth!))),
);
driverRouter.post(
  '/trips/:id/end',
  asyncRoute(async (request, response) => response.json(await endTrip(z.string().uuid().parse(request.params.id), request.auth!))),
);
driverRouter.get(
  '/trips/:id/passengers',
  asyncRoute(async (request, response) => response.json(await listPassengers(z.string().uuid().parse(request.params.id), request.auth!))),
);
driverRouter.get(
  '/passengers',
  asyncRoute(async (request, response) => {
    const { tripId } = z.object({ tripId: z.string().uuid() }).parse(request.query);
    response.json(await listPassengers(tripId, request.auth!));
  }),
);
driverRouter.post(
  '/location',
  asyncRoute(async (request, response) => response.status(202).json(await recordLocation(locationUpdateSchema.parse(request.body), request.auth!))),
);
driverRouter.post(
  '/trips/:id/location',
  asyncRoute(async (request, response) => {
    const payload = z.object({}).passthrough().parse(request.body);
    const body = { ...payload, tripId: z.string().uuid().parse(request.params.id) };
    response.status(202).json(await recordLocation(locationUpdateSchema.parse(body), request.auth!));
  }),
);
driverRouter.post(
  '/incidents',
  uploadRateLimit,
  incidentUpload,
  asyncRoute(async (request, response) => {
    const image = await persistIncidentUpload(request);
    try {
      response.status(201).json(await reportIncident(incidentSchema.parse(request.body), request.auth!, image));
    } catch (error: unknown) {
      await removeIncidentUpload(image);
      throw error;
    }
  }),
);
driverRouter.get('/incidents/images/:filename', sendIncidentImage);
