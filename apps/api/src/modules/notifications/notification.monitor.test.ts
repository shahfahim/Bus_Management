import { DeliveryStatus, NotificationChannel } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findDeliveries: vi.fn(),
  dispatchNotification: vi.fn(),
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    notificationDelivery: {
      findMany: mocks.findDeliveries,
    },
  },
}));

vi.mock('./notification.service.js', () => ({
  dispatchNotification: mocks.dispatchNotification,
  isPushDeliveryEnabled: () => true,
}));

import {
  MAX_NOTIFICATION_DELIVERY_ATTEMPTS,
  NOTIFICATION_RETRY_BATCH_SIZE,
  processNotificationRetries,
} from './notification.monitor.js';

describe('notification retry processing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('selects one bounded page of due retryable push deliveries', async () => {
    const now = new Date('2026-08-22T10:00:00.000Z');
    mocks.findDeliveries.mockResolvedValue([
      { notificationId: 'notification-1' },
      { notificationId: 'notification-2' },
    ]);
    mocks.dispatchNotification.mockResolvedValue(undefined);

    await expect(processNotificationRetries({ now })).resolves.toEqual({ selected: 2, dispatched: 2, failed: 0 });

    expect(mocks.findDeliveries).toHaveBeenCalledWith({
      where: {
        channel: NotificationChannel.PUSH,
        status: { in: [DeliveryStatus.PENDING, DeliveryStatus.FAILED] },
        attemptCount: { lt: MAX_NOTIFICATION_DELIVERY_ATTEMPTS },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      select: { notificationId: true },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      take: NOTIFICATION_RETRY_BATCH_SIZE,
    });
    expect(mocks.dispatchNotification).toHaveBeenCalledTimes(2);
  });

  it('isolates a failed dispatch and continues the rest of the batch', async () => {
    mocks.findDeliveries.mockResolvedValue([
      { notificationId: 'notification-1' },
      { notificationId: 'notification-2' },
      { notificationId: 'notification-3' },
    ]);
    mocks.dispatchNotification
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('temporary provider error'))
      .mockResolvedValueOnce(undefined);

    await expect(processNotificationRetries({ concurrency: 2 })).resolves.toEqual({
      selected: 3,
      dispatched: 2,
      failed: 1,
    });
    expect(mocks.dispatchNotification).toHaveBeenCalledTimes(3);
  });

  it('clamps caller-provided batch and concurrency limits', async () => {
    mocks.findDeliveries.mockResolvedValue([]);

    await processNotificationRetries({ batchSize: 500, concurrency: 500 });

    expect(mocks.findDeliveries).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });
});
