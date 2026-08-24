import { DeliveryStatus, NotificationChannel } from '@prisma/client';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { dispatchNotification, isPushDeliveryEnabled } from './notification.service.js';

export const NOTIFICATION_RETRY_BATCH_SIZE = 25;
export const NOTIFICATION_RETRY_CONCURRENCY = 5;
export const MAX_NOTIFICATION_DELIVERY_ATTEMPTS = 5;
const NOTIFICATION_RETRY_INTERVAL_MS = 30_000;

interface RetryOptions {
  now?: Date;
  batchSize?: number;
  concurrency?: number;
  maxAttempts?: number;
}

export interface NotificationRetryResult {
  selected: number;
  dispatched: number;
  failed: number;
}

/**
 * Processes one bounded page. dispatchNotification performs the atomic delivery
 * claim, so overlapping processes cannot send the same due delivery twice.
 */
export const processNotificationRetries = async (
  options: RetryOptions = {},
): Promise<NotificationRetryResult> => {
  const now = options.now ?? new Date();
  const batchSize = Math.max(1, Math.min(options.batchSize ?? NOTIFICATION_RETRY_BATCH_SIZE, 100));
  const concurrency = Math.max(1, Math.min(options.concurrency ?? NOTIFICATION_RETRY_CONCURRENCY, batchSize));
  const maxAttempts = Math.max(1, options.maxAttempts ?? MAX_NOTIFICATION_DELIVERY_ATTEMPTS);
  const due = await prisma.notificationDelivery.findMany({
    where: {
      channel: NotificationChannel.PUSH,
      status: { in: [DeliveryStatus.PENDING, DeliveryStatus.FAILED] },
      attemptCount: { lt: maxAttempts },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    select: { notificationId: true },
    orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
    take: batchSize,
  });

  let dispatched = 0;
  let failed = 0;
  for (let offset = 0; offset < due.length; offset += concurrency) {
    const page = due.slice(offset, offset + concurrency);
    const outcomes = await Promise.all(
      page.map(async ({ notificationId }) => {
        try {
          await dispatchNotification(notificationId);
          return true;
        } catch (error: unknown) {
          logger.error({ err: error, notificationId }, 'Notification retry dispatch failed');
          return false;
        }
      }),
    );
    dispatched += outcomes.filter(Boolean).length;
    failed += outcomes.filter((outcome) => !outcome).length;
  }

  return { selected: due.length, dispatched, failed };
};

let timer: NodeJS.Timeout | undefined;
let running = false;

export const startNotificationRetryMonitor = (intervalMs = NOTIFICATION_RETRY_INTERVAL_MS): (() => void) => {
  if (!isPushDeliveryEnabled()) {
    logger.info('Notification retry monitor disabled because Web Push is not configured');
    return () => undefined;
  }
  if (timer) return () => undefined;

  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const result = await processNotificationRetries();
      if (result.selected > 0) logger.info(result, 'Notification retry batch processed');
    } catch (error: unknown) {
      logger.error({ err: error }, 'Notification retry monitor failed');
    } finally {
      running = false;
    }
  };

  void run();
  timer = setInterval(() => void run(), Math.max(intervalMs, 1_000));
  timer.unref();
  return () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };
};
