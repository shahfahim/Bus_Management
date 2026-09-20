import type { NotificationChannel, Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';

export type NotificationPayload = {
  id: string;
  type: string;
  title: string;
  body: string;
  message: string;
  data: Prisma.JsonValue;
  actionUrl?: string;
  tag: string;
  createdAt: Date;
};

// Assuming this type is available by importing Prisma types
type NotificationWithDeliveries = Prisma.NotificationGetPayload<{
  include: { user: { include: { pushSubscriptions: { where: { revokedAt: null } } } }, deliveries: true };
}>;

export interface NotificationStrategy {
  readonly channel: NotificationChannel;
  deliver(notification: NotificationWithDeliveries, payload: NotificationPayload): Promise<void>;
}

export class NotificationDispatcher {
  private strategies: Map<NotificationChannel, NotificationStrategy> = new Map();

  registerStrategy(strategy: NotificationStrategy) {
    this.strategies.set(strategy.channel, strategy);
  }

  async dispatch(notificationId: string): Promise<void> {
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
      include: { user: { include: { pushSubscriptions: { where: { revokedAt: null } } } }, deliveries: true },
    });

    if (!notification) return;

    const payload: NotificationPayload = {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      message: notification.body,
      data: notification.data,
      actionUrl:
        notification.data && typeof notification.data === 'object' && !Array.isArray(notification.data)
          ? ((notification.data as Record<string, unknown>).actionUrl as string)
          : undefined,
      tag: notification.id,
      createdAt: notification.createdAt,
    };

    for (const delivery of notification.deliveries) {
      const strategy = this.strategies.get(delivery.channel);
      if (strategy) {
        await strategy.deliver(notification, payload).catch((err) => {
          console.error(`Failed to execute strategy for channel ${delivery.channel}:`, err);
        });
      }
    }
  }
}
