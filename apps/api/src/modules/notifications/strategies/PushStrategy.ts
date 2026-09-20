import webPush from 'web-push';
import { DeliveryStatus, NotificationChannel, NotificationType } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { env } from '../../../config/env.js';
import type { NotificationStrategy, NotificationPayload } from './NotificationStrategy.js';
import type { Prisma } from '@prisma/client';

type NotificationWithDeliveries = Prisma.NotificationGetPayload<{
  include: { user: { include: { pushSubscriptions: { where: { revokedAt: null } } } }, deliveries: true };
}>;

const pushEnabled = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
if (pushEnabled) {
  webPush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
}

export class PushStrategy implements NotificationStrategy {
  readonly channel = NotificationChannel.PUSH;

  async deliver(notification: NotificationWithDeliveries, payload: NotificationPayload): Promise<void> {
    const pushDelivery = notification.deliveries.find((delivery) => delivery.channel === this.channel);
    
    if (
      !pushDelivery ||
      ([DeliveryStatus.SKIPPED, DeliveryStatus.SENT, DeliveryStatus.DELIVERED] as DeliveryStatus[]).includes(
        pushDelivery.status,
      ) ||
      !pushEnabled
    ) {
      return;
    }
    
    const pushClaim = await prisma.notificationDelivery.updateMany({
      where: {
        id: pushDelivery.id,
        status: { in: [DeliveryStatus.PENDING, DeliveryStatus.FAILED] },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      data: { attemptCount: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 60_000) },
    });
    
    if (pushClaim.count !== 1) return;
    
    if (notification.user.pushSubscriptions.length === 0) {
      await prisma.notificationDelivery.update({
        where: { id: pushDelivery.id },
        data: { status: DeliveryStatus.SKIPPED, lastError: 'No active push subscription' },
      });
      return;
    }

    let delivered = 0;
    const errors: string[] = [];
    
    await Promise.all(
      notification.user.pushSubscriptions.map(async (subscription) => {
        try {
          await webPush.sendNotification(
            { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
            JSON.stringify(payload),
            { TTL: 300, urgency: notification.type === NotificationType.EMERGENCY ? 'high' : 'normal' },
          );
          delivered += 1;
          await prisma.pushSubscription.update({ where: { id: subscription.id }, data: { lastUsedAt: new Date() } });
        } catch (error: unknown) {
          const statusCode = typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 0;
          if (statusCode === 404 || statusCode === 410) {
            await prisma.pushSubscription.update({ where: { id: subscription.id }, data: { revokedAt: new Date() } });
          }
          errors.push(error instanceof Error ? error.message : 'Push delivery failed');
        }
      }),
    );

    await prisma.notificationDelivery.update({
      where: { id: pushDelivery.id },
      data: {
        status: delivered > 0 ? DeliveryStatus.SENT : DeliveryStatus.FAILED,
        sentAt: delivered > 0 ? new Date() : undefined,
        nextAttemptAt: delivered > 0 ? null : new Date(Date.now() + 5 * 60_000),
        lastError: errors.length ? errors.join('; ').slice(0, 2_000) : null,
      },
    });
  }
}
