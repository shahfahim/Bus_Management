/* eslint-disable */
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

import { notificationDispatcher } from './strategies/index.js';

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
  await notificationDispatcher.dispatch(notificationId);
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
