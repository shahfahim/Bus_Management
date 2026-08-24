import webPush from 'web-push';
import {
  DeliveryStatus,
  NotificationChannel,
  NotificationType,
  type Prisma,
} from '@prisma/client';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { emitToUser } from '../../realtime/hub.js';

const pushEnabled = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
  webPush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
}

export const isPushDeliveryEnabled = (): boolean => pushEnabled;

export interface NotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Prisma.InputJsonValue;
  dedupeKey?: string;
  expiresAt?: Date;
}

export const createNotificationRecord = async (
  client: Prisma.TransactionClient | typeof prisma,
  input: NotificationInput,
) =>
  client.notification.upsert({
    where: { dedupeKey: input.dedupeKey ?? `notification:${crypto.randomUUID()}` },
    create: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      data: input.data,
      dedupeKey: input.dedupeKey,
      expiresAt: input.expiresAt,
      deliveries: {
        create: [
          { channel: NotificationChannel.IN_APP, status: DeliveryStatus.SENT, sentAt: new Date() },
          {
            channel: NotificationChannel.PUSH,
            status: pushEnabled ? DeliveryStatus.PENDING : DeliveryStatus.SKIPPED,
            nextAttemptAt: pushEnabled ? new Date() : undefined,
          },
        ],
      },
    },
    update: {},
    include: { deliveries: true },
  });

export const dispatchNotification = async (notificationId: string): Promise<void> => {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
    include: { user: { include: { pushSubscriptions: { where: { revokedAt: null } } } }, deliveries: true },
  });
  if (!notification) return;

  const payload = {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    message: notification.body,
    data: notification.data,
    actionUrl:
      notification.data && typeof notification.data === 'object' && !Array.isArray(notification.data)
        ? (notification.data as Record<string, unknown>).actionUrl
        : undefined,
    tag: notification.id,
    createdAt: notification.createdAt,
  };
  const inAppDelivery = notification.deliveries.find((delivery) => delivery.channel === NotificationChannel.IN_APP);
  if (inAppDelivery) {
    const socketClaim = await prisma.notificationDelivery.updateMany({
      where: { id: inAppDelivery.id, attemptCount: 0 },
      data: { attemptCount: { increment: 1 } },
    });
    if (socketClaim.count === 1) emitToUser(notification.userId, 'notification:new', payload);
  }

  const pushDelivery = notification.deliveries.find((delivery) => delivery.channel === NotificationChannel.PUSH);
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
};

export const notifyUser = async (input: NotificationInput) => {
  const notification = await createNotificationRecord(prisma, input);
  void dispatchNotification(notification.id).catch((error: unknown) => {
    logger.error({ err: error, notificationId: notification.id }, 'Notification dispatch failed');
  });
  return notification;
};

export const notifyUsers = async (userIds: string[], input: Omit<NotificationInput, 'userId' | 'dedupeKey'> & { dedupePrefix: string }) => {
  const uniqueIds = [...new Set(userIds)];
  const notifications = await prisma.$transaction((tx) =>
    Promise.all(
      uniqueIds.map((userId) =>
        createNotificationRecord(tx, {
          ...input,
          userId,
          dedupeKey: `${input.dedupePrefix}:${userId}`,
        }),
      ),
    ),
  );
  for (const notification of notifications) {
    void dispatchNotification(notification.id).catch((error: unknown) =>
      logger.error({ err: error, notificationId: notification.id }, 'Notification dispatch failed'),
    );
  }
  return notifications;
};
