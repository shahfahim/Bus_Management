import { randomUUID } from 'node:crypto';
import type {
  Prisma} from '@prisma/client';
import {
  BookingStatus,
  DeliveryStatus,
  NotificationChannel,
  NotificationType,
  PaymentStatus,
  Role,
  TripStatus,
  UserStatus,
} from '@prisma/client';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { dispatchNotification, notifyUsers } from '../notifications/notification.service.js';
import { refundPayment } from '../payments/payment.service.js';
import type { AuditContext } from './audit.service.js';
import { writeAuditLog } from './audit.service.js';
import type {
  createAdminNotificationSchema,
  notificationQuerySchema,
  paymentQuerySchema,
} from './admin.schemas.js';

type PaymentQuery = z.infer<typeof paymentQuerySchema>;
type NotificationQuery = z.infer<typeof notificationQuerySchema>;
type CreateNotification = z.infer<typeof createAdminNotificationSchema>;

const pageResult = <T>(items: T[], total: number, page: number, pageSize: number) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    items,
    pagination: { page, pageSize, total, pages: totalPages, totalPages },
    meta: { page, pageSize, total, totalPages },
  };
};

const paymentInclude = {
  payer: { select: { id: true, name: true, email: true, role: true } },
  booking: { select: { id: true, bookingNumber: true } },
  subscription: { select: { id: true, subscriptionNumber: true } },
  receipt: true,
  transactions: { orderBy: { createdAt: 'desc' as const }, take: 10 },
} as const;

type PaymentRecord = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

const paymentStatusDto = (status: PaymentStatus): string =>
  status === PaymentStatus.SUCCEEDED ? 'success' : status.toLowerCase();

const paymentDto = (payment: PaymentRecord) => ({
  ...payment,
  transactionId: payment.providerPaymentReference ?? payment.paymentNumber,
  gateway: payment.provider,
  status: paymentStatusDto(payment.status),
  amount: Number(payment.amount),
  refundedAmount: Number(payment.refundedAmount),
  payer: { ...payment.payer, role: payment.payer.role.toLowerCase() },
  user: { ...payment.payer, role: payment.payer.role.toLowerCase() },
  transactions: payment.transactions.map((transaction) => ({
    ...transaction,
    type: transaction.type.toLowerCase(),
    status: transaction.status.toLowerCase(),
    amount: Number(transaction.amount),
  })),
});

export const listAdminPayments = async (query: PaymentQuery) => {
  const pageSize = query.pageSize ?? query.limit;
  const where: Prisma.PaymentWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.search
      ? {
          OR: [
            { paymentNumber: { contains: query.search, mode: 'insensitive' } },
            { providerPaymentReference: { contains: query.search, mode: 'insensitive' } },
            { receipt: { receiptNumber: { contains: query.search, mode: 'insensitive' } } },
            { payer: { name: { contains: query.search, mode: 'insensitive' } } },
            { payer: { email: { contains: query.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
  const sortMap: Record<string, Prisma.PaymentOrderByWithRelationInput> = {
    paymentNumber: { paymentNumber: query.order },
    amount: { amount: query.order },
    paidAt: { paidAt: query.order },
    status: { status: query.order },
  };
  const orderBy = (query.sort ? sortMap[query.sort] : undefined) ?? { createdAt: 'desc' as const };
  const [items, total] = await prisma.$transaction([
    prisma.payment.findMany({
      where,
      include: paymentInclude,
      skip: (query.page - 1) * pageSize,
      take: pageSize,
      orderBy,
    }),
    prisma.payment.count({ where }),
  ]);
  return pageResult(items.map((item) => paymentDto(item)), total, query.page, pageSize);
};

export const getAdminPayment = async (id: string) => {
  const payment = await prisma.payment.findUnique({ where: { id }, include: paymentInclude });
  if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
  return paymentDto(payment);
};

export const refundAdminPayment = async (id: string, reason: string, context: AuditContext) => {
  const before = await prisma.payment.findUnique({ where: { id }, include: paymentInclude });
  if (!before) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
  const gatewayResult = await refundPayment(id, reason);
  const after = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUniqueOrThrow({ where: { id }, include: paymentInclude });
    await writeAuditLog({
      context,
      action: 'payment.refund',
      entityType: 'Payment',
      entityId: id,
      before: paymentDto(before),
      after: paymentDto(payment),
      metadata: { reason, gatewayResult },
      client: tx,
    });
    return payment;
  });
  return { ...paymentDto(after), refund: gatewayResult };
};

const notificationInclude = {
  user: { select: { id: true, name: true, email: true, role: true } },
  deliveries: true,
} as const;

type NotificationRecord = Prisma.NotificationGetPayload<{ include: typeof notificationInclude }>;

const notificationTypeDto = (type: NotificationType): string => {
  if (type === NotificationType.SYSTEM) return 'announcement';
  if (type === NotificationType.TRIP_DELAYED) return 'delay';
  if (type === NotificationType.TRIP_CANCELLED) return 'cancellation';
  if (type === NotificationType.BUS_MAINTENANCE) return 'maintenance';
  return type.toLowerCase();
};

const notificationDto = (notification: NotificationRecord) => {
  const deliveredCount = notification.deliveries.filter(({ status }) =>
    ([DeliveryStatus.SENT, DeliveryStatus.DELIVERED] as DeliveryStatus[]).includes(status),
  ).length;
  const failedCount = notification.deliveries.filter(({ status }) => status === DeliveryStatus.FAILED).length;
  return {
    ...notification,
    type: notificationTypeDto(notification.type),
    message: notification.body,
    audience: `${notification.user.role.toLowerCase()}: ${notification.user.name}`,
    deliveredCount,
    failedCount,
    sentAt: notification.createdAt,
    user: { ...notification.user, role: notification.user.role.toLowerCase() },
    deliveries: notification.deliveries.map((delivery) => ({
      ...delivery,
      channel: delivery.channel.toLowerCase(),
      status: delivery.status.toLowerCase(),
    })),
  };
};

export const listAdminNotifications = async (query: NotificationQuery) => {
  const pageSize = query.pageSize ?? query.limit;
  const deliveryWhere: Prisma.NotificationWhereInput =
    query.delivery === 'failed'
      ? { deliveries: { some: { status: DeliveryStatus.FAILED } } }
      : query.delivery === 'delivered'
        ? {
            deliveries: { some: { status: { in: [DeliveryStatus.SENT, DeliveryStatus.DELIVERED] } } },
            NOT: { deliveries: { some: { status: DeliveryStatus.FAILED } } },
          }
        : query.delivery === 'partial'
          ? {
              AND: [
                { deliveries: { some: { status: DeliveryStatus.FAILED } } },
                { deliveries: { some: { status: { in: [DeliveryStatus.SENT, DeliveryStatus.DELIVERED] } } } },
              ],
            }
          : {};
  const where: Prisma.NotificationWhereInput = {
    ...deliveryWhere,
    ...(query.type ? { type: query.type } : {}),
    ...(query.search
      ? {
          OR: [
            { title: { contains: query.search, mode: 'insensitive' } },
            { body: { contains: query.search, mode: 'insensitive' } },
            { user: { name: { contains: query.search, mode: 'insensitive' } } },
            { user: { email: { contains: query.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
  const sortMap: Record<string, Prisma.NotificationOrderByWithRelationInput> = {
    title: { title: query.order },
    sentAt: { createdAt: query.order },
    createdAt: { createdAt: query.order },
  };
  const orderBy = (query.sort ? sortMap[query.sort] : undefined) ?? { createdAt: 'desc' as const };
  const [items, total] = await prisma.$transaction([
    prisma.notification.findMany({
      where,
      include: notificationInclude,
      skip: (query.page - 1) * pageSize,
      take: pageSize,
      orderBy,
    }),
    prisma.notification.count({ where }),
  ]);
  return pageResult(items.map((item) => notificationDto(item)), total, query.page, pageSize);
};

export const getAdminNotification = async (id: string) => {
  const notification = await prisma.notification.findUnique({ where: { id }, include: notificationInclude });
  if (!notification) throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
  return notificationDto(notification);
};

const resolveAudience = async (input: CreateNotification): Promise<string[]> => {
  if (input.audience === 'all_students' || input.audience === 'all_drivers') {
    const users = await prisma.user.findMany({
      where: {
        role: input.audience === 'all_students' ? { in: [Role.STUDENT, Role.TEACHER] } : Role.DRIVER,
        status: UserStatus.ACTIVE,
        deletedAt: null,
      },
      select: { id: true },
    });
    return users.map(({ id }) => id);
  }
  if (input.audience === 'trip') {
    const trip = await prisma.trip.findUnique({ where: { id: input.tripId! }, select: { id: true } });
    if (!trip) throw new AppError(404, 'TRIP_NOT_FOUND', 'Trip not found');
    const bookings = await prisma.booking.findMany({
      where: {
        tripId: input.tripId,
        status: { in: [BookingStatus.HELD, BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] },
      },
      select: { studentId: true },
      distinct: ['studentId'],
    });
    return bookings.map(({ studentId }) => studentId);
  }
  const route = await prisma.route.findUnique({ where: { id: input.routeId! }, select: { id: true } });
  if (!route) throw new AppError(404, 'ROUTE_NOT_FOUND', 'Route not found');
  const now = new Date();
  const audienceStartsAt = new Date(now.getTime() - 24 * 60 * 60_000);
  const audienceEndsAt = new Date(now.getTime() + 30 * 24 * 60 * 60_000);
  const bookings = await prisma.booking.findMany({
    where: {
      trip: {
        routeId: input.routeId,
        status: { in: [TripStatus.SCHEDULED, TripStatus.BOARDING, TripStatus.IN_PROGRESS, TripStatus.DELAYED] },
        scheduledStartAt: { gte: audienceStartsAt, lte: audienceEndsAt },
      },
      status: { in: [BookingStatus.HELD, BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] },
    },
    select: { studentId: true },
    distinct: ['studentId'],
  });
  return bookings.map(({ studentId }) => studentId);
};

export const createAdminNotification = async (input: CreateNotification, context: AuditContext) => {
  const userIds = await resolveAudience(input);
  if (userIds.length === 0) throw new AppError(409, 'AUDIENCE_EMPTY', 'No active users match the selected audience');
  const batchId = randomUUID();
  const data = {
    batchId,
    audience: input.audience,
    routeId: input.routeId ?? null,
    tripId: input.tripId ?? null,
    requestedPush: input.sendPush,
  };
  const notifications = input.sendPush
    ? await notifyUsers(userIds, {
        type: input.type,
        title: input.title,
        body: input.message,
        data,
        dedupePrefix: `admin-notification:${batchId}`,
      })
    : await prisma.$transaction((tx) =>
        Promise.all(
          userIds.map((userId) =>
            tx.notification.create({
              data: {
                userId,
                type: input.type,
                title: input.title,
                body: input.message,
                data,
                dedupeKey: `admin-notification:${batchId}:${userId}`,
                deliveries: {
                  create: {
                    channel: NotificationChannel.IN_APP,
                    status: DeliveryStatus.SENT,
                    sentAt: new Date(),
                  },
                },
              },
            }),
          ),
        ),
      );
  if (!input.sendPush) await Promise.all(notifications.map(({ id }) => dispatchNotification(id)));
  await writeAuditLog({
    context,
    action: 'notification.send',
    entityType: 'NotificationBatch',
    entityId: batchId,
    after: { recipientCount: notifications.length, type: input.type, title: input.title },
    metadata: { audience: input.audience, routeId: input.routeId, tripId: input.tripId, sendPush: input.sendPush },
  });
  const first = await prisma.notification.findUnique({ where: { id: notifications[0]!.id }, include: notificationInclude });
  return {
    ...(first ? notificationDto(first) : { id: batchId, title: input.title, type: notificationTypeDto(input.type) }),
    batchId,
    audience: input.audience,
    recipientCount: notifications.length,
  };
};

export const resendAdminNotification = async (id: string, failedOnly: boolean, context: AuditContext) => {
  const notification = await prisma.notification.findUnique({ where: { id }, include: notificationInclude });
  if (!notification) throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
  const failed = notification.deliveries.filter(({ status }) => status === DeliveryStatus.FAILED);
  if (failedOnly && failed.length === 0) throw new AppError(409, 'NO_FAILED_DELIVERIES', 'This notification has no failed deliveries');
  await prisma.notificationDelivery.updateMany({
    where: { notificationId: id, ...(failedOnly ? { status: DeliveryStatus.FAILED } : {}) },
    data: { status: DeliveryStatus.PENDING, nextAttemptAt: new Date(), lastError: null },
  });
  await dispatchNotification(id);
  const updated = await prisma.notification.findUniqueOrThrow({ where: { id }, include: notificationInclude });
  await writeAuditLog({
    context,
    action: 'notification.resend',
    entityType: 'Notification',
    entityId: id,
    before: notificationDto(notification),
    after: notificationDto(updated),
    metadata: { failedOnly },
  });
  return notificationDto(updated);
};
