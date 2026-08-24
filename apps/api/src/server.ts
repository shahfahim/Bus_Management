import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { startBookingHoldMonitor } from './modules/bookings/booking.monitor.js';
import { startMaintenanceMonitor } from './modules/maintenance/maintenance.monitor.js';
import { startNotificationRetryMonitor } from './modules/notifications/notification.monitor.js';
import { startTrackingMonitor } from './modules/tracking/tracking.monitor.js';
import { initializeRealtime } from './realtime/hub.js';

let shuttingDown = false;
let server: ReturnType<typeof createServer> | undefined;
let stopMonitors: Array<() => void> = [];

const shutdown = (signal: string): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Graceful shutdown started');
  stopMonitors.forEach((stop) => stop());
  const finish = async (error?: Error) => {
    if (error) logger.error({ err: error }, 'HTTP server shutdown failed');
    await prisma.$disconnect();
    process.exit(error ? 1 : 0);
  };
  if (server?.listening) server.close((error) => void finish(error ?? undefined));
  else void finish();
  setTimeout(() => {
    logger.fatal('Graceful shutdown timed out');
    process.exit(1);
  }, 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception');
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (error) => {
  logger.fatal({ err: error }, 'Unhandled promise rejection');
  shutdown('unhandledRejection');
});

const bootstrap = async (): Promise<void> => {
  await prisma.$queryRaw`SELECT 1`;
  const app = createApp();
  server = createServer(app);
  initializeRealtime(server);
  stopMonitors = [
    startBookingHoldMonitor(),
    startMaintenanceMonitor(),
    startNotificationRetryMonitor(),
    startTrackingMonitor(),
  ];
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server!.once('error', onError);
    server!.listen(env.PORT, () => {
      server!.off('error', onError);
      resolve();
    });
  });
  logger.info({ port: env.PORT, environment: env.NODE_ENV }, 'University bus API listening');
};

void bootstrap().catch(async (error: unknown) => {
  logger.fatal({ err: error }, 'API startup failed');
  stopMonitors.forEach((stop) => stop());
  await prisma.$disconnect();
  process.exit(1);
});
