import {
  BookingStatus,
  BusStatus,
  CreditTransactionType,
  NotificationType,
  PaymentStatus,
  PaymentTransactionStatus,
  PaymentTransactionType,
  Prisma,
  SeatAllocationStatus,
  SubscriptionStatus,
  TripStatus,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AppError } from '../../lib/errors.js';
import { lockBooking } from '../../lib/booking-lock.js';
import { assertBusHasNoMaintenanceConflict } from '../../lib/maintenance-window.js';
import { paginated, toPagination } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import { emitToTrip, emitToUser } from '../../realtime/hub.js';
import { CREDIT_PROVIDER, applyCreditChange, chargeCredits, formatCredits } from '../credits/credit.service.js';
import { notifyUser } from '../notifications/notification.service.js';

const subscriptionNumber = (): string =>
  `SUB-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(5).toString('hex').toUpperCase()}`;

const bookableTripStatuses: TripStatus[] = [TripStatus.SCHEDULED, TripStatus.BOARDING, TripStatus.DELAYED];

/**
 * Confirms a booking that is awaiting payment by charging the student's credits, inside the
 * caller's transaction. The booking must still hold its seat on a bookable trip.
 */
export const payBookingWithCredits = async (
  tx: Prisma.TransactionClient,
  bookingId: string,
  studentId: string,
  idempotencyKey?: string,
) => {
  const now = new Date();
  const booking = await tx.booking.findFirst({
    where: { id: bookingId, studentId },
    include: {
      seatAllocations: true,
      trip: { include: { bus: { select: { status: true } } } },
      payments: { where: { status: PaymentStatus.SUCCEEDED }, select: { id: true } },
    },
  });
  if (!booking) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
  if (booking.payments.length) throw new AppError(409, 'ALREADY_PAID', 'This booking has already been paid');
  if (
    !([BookingStatus.HELD, BookingStatus.PENDING_PAYMENT] as BookingStatus[]).includes(booking.status) ||
    (booking.holdExpiresAt && booking.holdExpiresAt <= now)
  ) {
    throw new AppError(409, 'BOOKING_NOT_PAYABLE', 'The seat hold has expired or the booking is not awaiting payment');
  }
  if (!bookableTripStatuses.includes(booking.trip.status) || (booking.trip.bookingClosesAt && booking.trip.bookingClosesAt <= now)) {
    throw new AppError(409, 'BOOKING_CLOSED', 'Booking has closed for this trip');
  }
  if (booking.trip.bus.status !== BusStatus.ACTIVE) throw new AppError(409, 'BUS_UNAVAILABLE', 'The assigned bus is not currently active');
  await assertBusHasNoMaintenanceConflict(tx, {
    busId: booking.trip.busId,
    startsAt: booking.trip.scheduledStartAt,
    endsAt: booking.trip.scheduledEndAt,
  });
  const heldAllocation = booking.seatAllocations.find((allocation) => allocation.status === SeatAllocationStatus.HELD);
  if (!heldAllocation) throw new AppError(409, 'SEAT_HOLD_EXPIRED', 'The seat hold is no longer active');

  const charge = Number(booking.fareAmount) > 0
    ? await chargeCredits(tx, {
        studentId,
        amount: booking.fareAmount,
        currency: booking.currency,
        bookingId: booking.id,
        description: `Bus booking ${booking.bookingNumber}`,
        idempotencyKey,
      })
    : null;
  await tx.seatAllocation.update({ where: { id: heldAllocation.id }, data: { status: SeatAllocationStatus.CONFIRMED } });
  await tx.booking.update({
    where: { id: booking.id },
    data: { status: BookingStatus.CONFIRMED, confirmedAt: now, holdExpiresAt: null, version: { increment: 1 } },
  });
  return { bookingId: booking.id, tripId: booking.tripId, payment: charge?.payment ?? null, balance: charge?.balance };
};

/** Pays for a pending booking, or buys a travel pass, with the student's credits. */
export const payWithCredits = async ({
  userId,
  bookingId,
  subscriptionPlanId,
  idempotencyKey,
}: {
  userId: string;
  bookingId?: string;
  subscriptionPlanId?: string;
  idempotencyKey?: string;
}) => {
  const requestedKey = idempotencyKey?.trim() || undefined;
  if (requestedKey && requestedKey.length > 128) {
    throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'The idempotency key must be at most 128 characters');
  }
  if (requestedKey) {
    // A retried request (for example after a dropped connection) returns the original result
    // instead of charging twice.
    const replay = await prisma.payment.findUnique({ where: { idempotencyKey: requestedKey }, include: { subscription: true } });
    if (replay) {
      const sameResource = bookingId ? replay.bookingId === bookingId : replay.subscription?.planId === subscriptionPlanId;
      if (replay.payerId !== userId || !sameResource) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'That idempotency key is already in use');
      const profile = await prisma.studentProfile.findUnique({ where: { userId }, select: { creditBalance: true } });
      return {
        paymentId: replay.id,
        status: replay.status === PaymentStatus.SUCCEEDED ? 'SUCCESS' : replay.status,
        bookingId: replay.bookingId,
        subscriptionId: replay.subscriptionId,
        balance: Number(profile?.creditBalance ?? 0),
      };
    }
  }

  if (bookingId) {
    const paid = await prisma.$transaction(
      async (tx) => {
        await lockBooking(tx, bookingId);
        return payBookingWithCredits(tx, bookingId, userId, requestedKey);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 },
    );
    await notifyUser({
      userId,
      type: NotificationType.BOOKING_CONFIRMED,
      title: 'Booking confirmed',
      body: paid.payment
        ? `Paid ${formatCredits(paid.payment.amount)} from your credits. Balance: ${formatCredits(paid.balance!)}.`
        : 'Your booking is confirmed.',
      data: { bookingId: paid.bookingId, paymentId: paid.payment?.id },
      dedupeKey: `booking-paid:${paid.bookingId}`,
    });
    emitToUser(userId, 'booking:updated', { id: paid.bookingId, status: BookingStatus.CONFIRMED });
    emitToUser(userId, 'credits:updated', { balance: Number(paid.balance ?? 0) });
    emitToTrip(paid.tripId, 'trip:seats', { tripId: paid.tripId, changedAt: new Date() });
    return { paymentId: paid.payment?.id ?? null, status: 'SUCCESS', bookingId: paid.bookingId, subscriptionId: null, balance: Number(paid.balance ?? 0) };
  }

  const bought = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pass:${userId}:${subscriptionPlanId!}`}))`;
    const plan = await tx.subscriptionPlan.findFirst({
      where: { id: subscriptionPlanId!, isActive: true },
      include: { _count: { select: { routes: true } } },
    });
    if (!plan) throw new AppError(404, 'SUBSCRIPTION_PLAN_NOT_FOUND', 'Subscription plan not found');
    if (!plan._count.routes) throw new AppError(409, 'SUBSCRIPTION_PLAN_UNAVAILABLE', 'This pass does not cover any route yet');
    const now = new Date();
    const active = await tx.studentSubscription.findFirst({
      where: { studentId: userId, planId: plan.id, status: SubscriptionStatus.ACTIVE, endsAt: { gt: now } },
      select: { id: true },
    });
    if (active) throw new AppError(409, 'SUBSCRIPTION_ALREADY_ACTIVE', 'This pass is already active');
    // Checkouts that were never paid under the old card flow cannot be completed any more.
    await tx.studentSubscription.updateMany({
      where: { studentId: userId, planId: plan.id, status: SubscriptionStatus.PENDING_PAYMENT },
      data: { status: SubscriptionStatus.CANCELLED, cancelledAt: now },
    });
    const subscription = await tx.studentSubscription.create({
      data: {
        subscriptionNumber: subscriptionNumber(),
        studentId: userId,
        planId: plan.id,
        status: SubscriptionStatus.ACTIVE,
        startsAt: now,
        endsAt: new Date(now.getTime() + plan.durationDays * 86_400_000),
        remainingTrips: plan.tripLimit,
      },
    });
    const charge = Number(plan.price) > 0
      ? await chargeCredits(tx, {
          studentId: userId,
          amount: plan.price,
          currency: plan.currency,
          subscriptionId: subscription.id,
          description: `Bus pass: ${plan.name}`,
          idempotencyKey: requestedKey,
        })
      : null;
    return { subscription, plan, payment: charge?.payment ?? null, balance: charge?.balance };
  });
  await notifyUser({
    userId,
    type: NotificationType.PAYMENT_SUCCEEDED,
    title: 'Bus pass active',
    body: bought.payment
      ? `${bought.plan.name} is active. Paid ${formatCredits(bought.payment.amount)}; balance ${formatCredits(bought.balance!)}.`
      : `${bought.plan.name} is active.`,
    data: { subscriptionId: bought.subscription.id, paymentId: bought.payment?.id },
    dedupeKey: `pass-bought:${bought.subscription.id}`,
  });
  emitToUser(userId, 'credits:updated', { balance: Number(bought.balance ?? 0) });
  return {
    paymentId: bought.payment?.id ?? null,
    status: 'SUCCESS',
    bookingId: null,
    subscriptionId: bought.subscription.id,
    balance: Number(bought.balance ?? 0),
  };
};

export const listPayments = async (userId: string, query: { page: number; pageSize: number; status?: PaymentStatus }) => {
  const where = { payerId: userId, ...(query.status ? { status: query.status } : {}) };
  const [items, total] = await prisma.$transaction([
    prisma.payment.findMany({
      where,
      include: { receipt: true, booking: { select: { bookingNumber: true } }, subscription: { select: { subscriptionNumber: true } } },
      ...toPagination(query),
      orderBy: { createdAt: 'desc' },
    }),
    prisma.payment.count({ where }),
  ]);
  return paginated(
    items.map((payment) => ({
      ...payment,
      booking: payment.booking
        ? { reference: payment.booking.bookingNumber, bookingNumber: payment.booking.bookingNumber }
        : null,
      amount: Number(payment.amount),
      refundedAmount: Number(payment.refundedAmount),
      status: payment.status === PaymentStatus.SUCCEEDED ? 'SUCCESS' : payment.status,
      transactionId: payment.providerPaymentReference,
      receiptUrl: payment.receipt ? `/api/payments/${payment.id}/receipt` : null,
    })),
    total,
    query.page,
    query.pageSize,
  );
};

export const getReceipt = async (paymentId: string, requester: { userId: string; isAdmin: boolean }) => {
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, ...(requester.isAdmin ? {} : { payerId: requester.userId }) },
    include: {
      receipt: true,
      payer: { select: { name: true, email: true } },
      booking: { select: { bookingNumber: true } },
      subscription: { select: { subscriptionNumber: true } },
    },
  });
  if (!payment?.receipt) throw new AppError(404, 'RECEIPT_NOT_FOUND', 'Receipt not found');
  return {
    receiptNumber: payment.receipt.receiptNumber,
    issuedAt: payment.receipt.issuedAt,
    paymentNumber: payment.paymentNumber,
    payer: payment.payer,
    bookingNumber: payment.booking?.bookingNumber,
    subscriptionNumber: payment.subscription?.subscriptionNumber,
    amount: Number(payment.amount),
    refundedAmount: Number(payment.refundedAmount),
    currency: payment.currency,
    status: payment.status,
    method: payment.methodType,
    card: payment.cardBrand && payment.cardLast4 ? `${payment.cardBrand} •••• ${payment.cardLast4}` : null,
    paidAt: payment.paidAt,
    breakdown: payment.receipt.breakdown,
  };
};

/**
 * Refunds whatever is left of a payment by returning it to the student's credit balance.
 * Refunds are instant, and older card payments are also refunded as credits.
 */
export const refundPayment = async (paymentId: string, reason: string) => {
  const scope = await prisma.payment.findUnique({ where: { id: paymentId }, select: { bookingId: true } });
  if (!scope) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    if (scope.bookingId) await lockBooking(tx, scope.bookingId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'refund:' + paymentId}))`;
    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { booking: { select: { tripId: true } }, receipt: true },
    });
    if (
      !([PaymentStatus.SUCCEEDED, PaymentStatus.REFUND_PENDING, PaymentStatus.PARTIALLY_REFUNDED] as PaymentStatus[]).includes(payment.status)
    ) {
      throw new AppError(409, 'PAYMENT_NOT_REFUNDABLE', 'This payment cannot be refunded');
    }
    const remaining = new Prisma.Decimal(payment.amount).minus(payment.refundedAmount);
    if (!remaining.isPositive()) throw new AppError(409, 'PAYMENT_ALREADY_REFUNDED', 'The payment is already fully refunded');
    const refund = await applyCreditChange(tx, {
      studentId: payment.payerId,
      type: CreditTransactionType.REFUND,
      amount: remaining,
      reference: payment.paymentNumber,
      note: reason.slice(0, 500),
      paymentId: payment.id,
    });
    await tx.paymentTransaction.create({
      data: {
        paymentId: payment.id,
        provider: CREDIT_PROVIDER,
        providerTransactionId: refund.transaction.id,
        type: PaymentTransactionType.REFUND,
        status: PaymentTransactionStatus.SUCCEEDED,
        amount: remaining,
        currency: payment.currency,
        processedAt: now,
        metadata: { reason: reason.slice(0, 450) },
      },
    });
    const updated = await tx.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.REFUNDED, refundedAmount: payment.amount },
    });
    if (payment.receipt) {
      await tx.paymentReceipt.update({
        where: { paymentId: payment.id },
        data: {
          breakdown: {
            subtotal: Number(payment.amount),
            refunded: Number(payment.amount),
            total: 0,
            currency: payment.currency,
            refundedAs: 'credits',
          },
        },
      });
    }
    if (payment.bookingId) {
      await tx.booking.updateMany({
        where: { id: payment.bookingId, status: { not: BookingStatus.REFUNDED } },
        data: { status: BookingStatus.REFUNDED, holdExpiresAt: null, version: { increment: 1 } },
      });
      await tx.seatAllocation.updateMany({
        where: { bookingId: payment.bookingId, status: { in: [SeatAllocationStatus.HELD, SeatAllocationStatus.CONFIRMED] } },
        data: { status: SeatAllocationStatus.RELEASED, releasedAt: now, releaseReason: 'Payment refunded' },
      });
    }
    if (payment.subscriptionId) {
      await tx.studentSubscription.updateMany({
        where: { id: payment.subscriptionId, status: { not: SubscriptionStatus.CANCELLED } },
        data: { status: SubscriptionStatus.CANCELLED, cancelledAt: now },
      });
    }
    return { payment: updated, refunded: remaining, balance: refund.balance, tripId: payment.booking?.tripId };
  });

  await notifyUser({
    userId: result.payment.payerId,
    type: NotificationType.SYSTEM,
    title: 'Refunded to your credits',
    body: `${formatCredits(result.refunded)} from payment ${result.payment.paymentNumber} were returned. Balance: ${formatCredits(result.balance)}.`,
    data: { paymentId: result.payment.id, refundedAmount: Number(result.refunded) },
    dedupeKey: `payment-refund:${result.payment.id}`,
  });
  emitToUser(result.payment.payerId, 'credits:updated', { balance: Number(result.balance) });
  if (result.payment.bookingId) {
    emitToUser(result.payment.payerId, 'booking:updated', { id: result.payment.bookingId, status: BookingStatus.REFUNDED });
    if (result.tripId) emitToTrip(result.tripId, 'trip:seats', { tripId: result.tripId, changedAt: now });
  }
  return { paymentId, status: 'succeeded', refundedAmount: Number(result.refunded), balance: Number(result.balance) };
};

export const refundBookingPayments = async (bookingId: string, reason: string): Promise<void> => {
  const payments = await prisma.payment.findMany({ where: { bookingId, status: PaymentStatus.REFUND_PENDING } });
  for (const payment of payments) await refundPayment(payment.id, reason);
};
