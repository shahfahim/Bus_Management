import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { AppError, errorHandler, notFoundHandler } from './lib/errors.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { attachProductionWebAssets } from './lib/web-assets.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { bookingRouter } from './modules/bookings/booking.routes.js';
import { catalogRouter } from './modules/catalog/catalog.routes.js';
import { lostFoundRouter } from './modules/lost-found/lost-found.routes.js';
import { maintenanceRouter } from './modules/maintenance/maintenance.routes.js';
import { notificationRouter } from './modules/notifications/notification.routes.js';
import { paymentRouter, stripeWebhookRouter } from './modules/payments/payment.routes.js';
import { bookingQrRouter, driverCheckInRouter } from './modules/qr/qr.routes.js';
import { ratingRouter } from './modules/ratings/rating.routes.js';
import { roadAlertRouter } from './modules/road-alerts/road-alert.routes.js';
import { subscriptionRouter } from './modules/subscriptions/subscription.routes.js';
import { driverRouter } from './modules/tracking/tracking.routes.js';
import { dashboardRouter } from './modules/users/dashboard.routes.js';
import { userRouter } from './modules/users/user.routes.js';

const buildApiRouter = (): Router => {
  const api = Router();
  api.get('/', (_request, response) => {
    response.json({
      name: 'University Bus Management API',
      version: '1.0.0',
      health: { liveness: '/health/live', readiness: '/health/ready' },
    });
  });
  api.use('/auth', authRouter);
  api.use(catalogRouter);
  api.use('/users', userRouter);
  api.use('/dashboard', dashboardRouter);
  api.use('/bookings', bookingRouter);
  api.use('/bookings', bookingQrRouter);
  api.use('/payments', paymentRouter);
  api.use('/subscriptions', subscriptionRouter);
  api.use('/notifications', notificationRouter);
  api.use('/driver', driverRouter);
  api.use('/driver', driverCheckInRouter);
  api.use('/maintenance', maintenanceRouter);
  api.use('/road-alerts', roadAlertRouter);
  api.use('/lost-found', lostFoundRouter);
  api.use('/ratings', ratingRouter);
  api.use('/admin', adminRouter);
  return api;
};

export const createApp = () => {
  const app = express();
  app.disable('x-powered-by');
  if (env.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.set('json replacer', (_key: string, value: unknown) => (typeof value === 'bigint' ? value.toString() : value));

  app.use(
    pinoHttp<Request, Response>({
      logger,
      genReqId: (request, response) => {
        const incoming = request.headers['x-request-id'];
        const id = typeof incoming === 'string' && incoming.length <= 128 ? incoming : randomUUID();
        response.setHeader('x-request-id', id);
        return id;
      },
      customSuccessMessage: (request, response) => `${request.method} ${request.url} ${response.statusCode}`,
    }),
  );
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || origin === env.WEB_ORIGIN) callback(null, true);
        else callback(new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Request origin is not allowed'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
    }),
  );
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          connectSrc: ["'self'", 'https:', 'wss:'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'self'"],
        },
      },
    }),
  );
  app.use((_request, response, next) => {
    response.setHeader('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=()');
    next();
  });
  app.use(
    rateLimit({
      windowMs: 15 * 60_000,
      limit: 600,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      skip: (request) => request.path === '/health/live' || request.path === '/health/ready',
    }),
  );

  // Stripe must receive the exact signed bytes, before any JSON parser runs.
  app.use('/api/webhooks', stripeWebhookRouter);
  app.use('/api/v1/webhooks', stripeWebhookRouter);
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(cookieParser());
  app.get('/health/live', (_request, response) => response.json({ status: 'ok', time: new Date().toISOString() }));
  app.get('/health/ready', async (_request, response) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      response.json({ status: 'ready', database: 'connected' });
    } catch (error: unknown) {
      logger.error({ err: error }, 'Readiness check failed');
      response.status(503).json({ status: 'not_ready', database: 'unavailable' });
    }
  });

  app.use('/api', buildApiRouter());
  app.use('/api/v1', buildApiRouter());
  attachProductionWebAssets(app);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};
