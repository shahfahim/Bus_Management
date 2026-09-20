import { NotificationChannel } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { emitToUser } from '../../../realtime/hub.js';
import type { NotificationStrategy, NotificationPayload } from './NotificationStrategy.js';
import type { Prisma } from '@prisma/client';

type NotificationWithDeliveries = Prisma.NotificationGetPayload<{
  include: { user: { include: { pushSubscriptions: { where: { revokedAt: null } } } }, deliveries: true };
}>;

export class InAppStrategy implements NotificationStrategy {
  readonly channel = NotificationChannel.IN_APP;

  async deliver(notification: NotificationWithDeliveries, payload: NotificationPayload): Promise<void> {
    const inAppDelivery = notification.deliveries.find((delivery) => delivery.channel === this.channel);
    if (!inAppDelivery) return;

    const socketClaim = await prisma.notificationDelivery.updateMany({
      where: { id: inAppDelivery.id, attemptCount: 0 },
      data: { attemptCount: { increment: 1 } },
    });
    
    if (socketClaim.count === 1) {
      emitToUser(notification.userId, 'notification:new', payload);
    }
  }
}
