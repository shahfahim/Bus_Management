import { NotificationType, TrackingStatus, TripStatus } from '@prisma/client';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { notifyUser } from '../notifications/notification.service.js';

let timer: NodeJS.Timeout | undefined;

const monitor = async (): Promise<void> => {
  const now = new Date();
  const active = await prisma.trip.findMany({
    // DELAYED also covers trips that have not departed yet; those are not expected to send GPS.
    where: { status: { in: [TripStatus.IN_PROGRESS, TripStatus.DELAYED] }, actualStartAt: { not: null } },
    select: { id: true, publicCode: true, lastLocationAt: true, locationIntervalSeconds: true, trackingStatus: true, driverId: true },
  });
  for (const trip of active) {
    const silenceMs = trip.lastLocationAt ? now.getTime() - trip.lastLocationAt.getTime() : Number.POSITIVE_INFINITY;
    const offlineAfterMs = Math.max(10 * 60_000, trip.locationIntervalSeconds * 20 * 1000);
    const degradedAfterMs = Math.max(2 * 60_000, trip.locationIntervalSeconds * 5 * 1000);
    const next = silenceMs >= offlineAfterMs ? TrackingStatus.OFFLINE : silenceMs >= degradedAfterMs ? TrackingStatus.DEGRADED : TrackingStatus.ACTIVE;
    if (next === trip.trackingStatus) continue;
    await prisma.trip.update({ where: { id: trip.id }, data: { trackingStatus: next } });
    if (next === TrackingStatus.OFFLINE) {
      await notifyUser({
        userId: trip.driverId,
        type: NotificationType.SYSTEM,
        title: 'GPS updates paused',
        body: `Location updates for ${trip.publicCode} are offline. The app will retry when the network returns.`,
        data: { tripId: trip.id },
        dedupeKey: `tracking-offline:${trip.id}:${Math.floor(now.getTime() / 3_600_000)}`,
      });
    }
  }
};

export const startTrackingMonitor = (): (() => void) => {
  if (timer) return () => undefined;
  timer = setInterval(() => {
    void monitor().catch((error: unknown) => logger.error({ err: error }, 'Tracking health monitor failed'));
  }, 60_000);
  timer.unref();
  return () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };
};
