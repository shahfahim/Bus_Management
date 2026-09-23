import { randomBytes } from 'node:crypto';
import {
  BookingStatus,
  BusStatus,
  NotificationType,
  PaymentStatus,
  PaymentTransactionStatus,
  PaymentTransactionType,
  SeatAllocationStatus,
  SubscriptionStatus,
  TripStatus,
} from '@prisma/client';
import Stripe from 'stripe';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { lockBooking } from '../../lib/booking-lock.js';
import { logger } from '../../lib/logger.js';
import { assertBusHasNoMaintenanceConflict } from '../../lib/maintenance-window.js';
import { paginated, toPagination } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import { sha256 } from '../../lib/security.js';
import { emitToTrip, emitToUser } from '../../realtime/hub.js';
import { notifyUser } from '../notifications/notification.service.js';

const stripe = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;
const replayablePaymentStatuses: PaymentStatus[] = [PaymentStatus.PENDING, PaymentStatus.PROCESSING];
const BOOKING_CHECKOUT_WINDOW_SECONDS = 31 * 60;

const requireStripe = (): Stripe => {
  if (!stripe) throw new AppError(503, 'PAYMENTS_NOT_CONFIGURED', 'Online payments are not configured');
  return stripe;
};

const paymentNumber = (): string =>
  `PAY-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(5).toString('hex').toUpperCase()}`;

const subscriptionNumber = (): string =>
  `SUB-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(5).toString('hex').toUpperCase()}`;

const receiptNumber = (): string =>
  `RCT-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(5).toString('hex').toUpperCase()}`;

const safeReturnUrl = (candidate: string | undefined, fallbackPath: string): string => {
  if (!candidate) return `${env.WEB_ORIGIN}${fallbackPath}`;
  const url = new URL(candidate);
  if (url.origin !== new URL(env.WEB_ORIGIN).origin) {
    throw new AppError(400, 'INVALID_RETURN_URL', 'Payment return URLs must use the configured web origin');
  }
  return url.toString();
};

export const createCheckout = async ({
  userId,
  bookingId,
  subscriptionPlanId,
  idempotencyKey,
  successUrl,
  cancelUrl,
}: {
  userId: string;
  bookingId?: string;
  subscriptionPlanId?: string;
  idempotencyKey?: string;
  successUrl?: string;
  cancelUrl?: string;
}) => {
  const gateway = requireStripe();
  const requestedKey = idempotencyKey?.trim() || undefined;
  if (requestedKey && requestedKey.length > 128) {
    throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'The idempotency key must be at most 128 characters');
  }
  const resourceKey = bookingId ? `booking:${bookingId}` : `subscription-plan:${userId}:${subscriptionPlanId!}`;

  const prepared = await prisma.$transaction(async (tx) => {
    // Serializes attempts for the same payable resource, including clients that omit
    // an idempotency header. Stripe receives a second deterministic key below.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${resourceKey}))`;

    if (requestedKey) {
      const keyedPayment = await tx.payment.findUnique({
        where: { idempotencyKey: requestedKey },
        include: { subscription: { select: { planId: true } } },
      });
      if (keyedPayment) {
        const sameResource = bookingId
          ? keyedPayment.bookingId === bookingId
          : keyedPayment.subscription?.planId === subscriptionPlanId;
        if (keyedPayment.payerId !== userId || !sameResource) {
          throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'That idempotency key is already in use');
        }
        if (!replayablePaymentStatuses.includes(keyedPayment.status)) {
          throw new AppError(409, 'PAYMENT_ATTEMPT_FINISHED', 'That payment attempt has already finished');
        }
      }
    }

    if (bookingId) {
      const booking = await tx.booking.findFirst({
        where: { id: bookingId, studentId: userId },
        include: { payments: { where: { status: { in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING, PaymentStatus.SUCCEEDED] } } } },
      });
      if (!booking) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
      if (booking.status !== BookingStatus.PENDING_PAYMENT || !booking.holdExpiresAt || booking.holdExpiresAt <= new Date()) {
        throw new AppError(409, 'BOOKING_NOT_PAYABLE', 'The booking hold has expired or is not awaiting payment');
      }
      if (booking.payments.some((payment) => payment.status === PaymentStatus.SUCCEEDED)) {
        throw new AppError(409, 'ALREADY_PAID', 'This booking has already been paid');
      }
      const pending = booking.payments.find((payment) =>
        ([PaymentStatus.PENDING, PaymentStatus.PROCESSING] as PaymentStatus[]).includes(payment.status),
      );
      if (pending) return { payment: pending, description: `Bus booking ${booking.bookingNumber}` };
      const payment = await tx.payment.create({
        data: {
          paymentNumber: paymentNumber(),
          payerId: userId,
          bookingId: booking.id,
          idempotencyKey: requestedKey ?? `checkout:${userId}:${bookingId}:${randomBytes(12).toString('hex')}`,
          provider: 'stripe',
          status: PaymentStatus.PENDING,
          amount: booking.fareAmount,
          currency: booking.currency,
          metadata: { bookingNumber: booking.bookingNumber },
        },
      });
      return { payment, description: `Bus booking ${booking.bookingNumber}` };
    }

    const plan = await tx.subscriptionPlan.findFirst({ where: { id: subscriptionPlanId!, isActive: true } });
    if (!plan) throw new AppError(404, 'SUBSCRIPTION_PLAN_NOT_FOUND', 'Subscription plan not found');
    const activeSubscription = await tx.studentSubscription.findFirst({
      where: { studentId: userId, planId: plan.id, status: SubscriptionStatus.ACTIVE, endsAt: { gt: new Date() } },
      select: { id: true },
    });
    if (activeSubscription) {
      throw new AppError(409, 'SUBSCRIPTION_ALREADY_ACTIVE', 'This subscription plan is already active');
    }
    const pending = await tx.payment.findFirst({
      where: {
        payerId: userId,
        status: { in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING] },
        subscription: { is: { studentId: userId, planId: plan.id, status: SubscriptionStatus.PENDING_PAYMENT } },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (pending) return { payment: pending, description: `Bus subscription: ${plan.name}` };
    const subscription = await tx.studentSubscription.create({
      data: {
        subscriptionNumber: subscriptionNumber(),
        studentId: userId,
        planId: plan.id,
        status: SubscriptionStatus.PENDING_PAYMENT,
        remainingTrips: plan.tripLimit,
      },
    });
    const payment = await tx.payment.create({
      data: {
        paymentNumber: paymentNumber(),
        payerId: userId,
        subscriptionId: subscription.id,
        idempotencyKey: requestedKey ?? `checkout:${userId}:${plan.id}:${randomBytes(12).toString('hex')}`,
        provider: 'stripe',
        status: PaymentStatus.PENDING,
        amount: plan.price,
        currency: plan.currency,
        metadata: { subscriptionNumber: subscription.subscriptionNumber, planCode: plan.code },
      },
    });
    return { payment, description: `Bus subscription: ${plan.name}` };
  });

  if (prepared.payment.providerPaymentReference?.startsWith('cs_')) {
    try {
      const existingSession = await gateway.checkout.sessions.retrieve(prepared.payment.providerPaymentReference);
      if (existingSession.status === 'open' && existingSession.url) {
        return {
          paymentId: prepared.payment.id,
          checkoutUrl: existingSession.url,
          expiresAt: new Date(existingSession.expires_at * 1000),
          status: prepared.payment.status,
        };
      }
      if (existingSession.status === 'complete') {
        throw new AppError(409, 'PAYMENT_CONFIRMATION_PENDING', 'Payment was submitted and is awaiting server confirmation');
      }
    } catch (error: unknown) {
      if (error instanceof AppError) throw error;
      throw new AppError(502, 'PAYMENT_GATEWAY_ERROR', 'The payment gateway could not resume this checkout');
    }
  }

  try {
    const sessionAttemptKey = prepared.payment.providerPaymentReference
      ? `checkout:${prepared.payment.id}:${prepared.payment.providerPaymentReference}`
      : `checkout:${prepared.payment.id}:initial`;
    // Stripe keeps sessions open for 24 hours by default, far beyond the seat hold. Close
    // booking checkouts shortly after Stripe's 30-minute minimum instead of accepting
    // payments that would only be refunded.
    const bookingCheckoutExpiresAt = prepared.payment.bookingId
      ? Math.floor(Date.now() / 1000) + BOOKING_CHECKOUT_WINDOW_SECONDS
      : undefined;
    const session = await gateway.checkout.sessions.create(
      {
        mode: 'payment',
        ...(bookingCheckoutExpiresAt ? { expires_at: bookingCheckoutExpiresAt } : {}),
        client_reference_id: prepared.payment.id,
        customer_email: (await prisma.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: prepared.payment.currency.toLowerCase(),
              unit_amount: Math.round(Number(prepared.payment.amount) * 100),
              product_data: { name: prepared.description },
            },
          },
        ],
        metadata: { paymentId: prepared.payment.id, userId },
        payment_intent_data: { metadata: { paymentId: prepared.payment.id, userId } },
        success_url: safeReturnUrl(successUrl, '/student/payments?checkout=success&session_id={CHECKOUT_SESSION_ID}'),
        cancel_url: safeReturnUrl(cancelUrl, '/student/payments?checkout=cancelled'),
      },
      { idempotencyKey: sessionAttemptKey },
    );
    await prisma.payment.update({
      where: { id: prepared.payment.id },
      data: { providerPaymentReference: session.id, status: PaymentStatus.PROCESSING },
    });
    if (prepared.payment.bookingId) {
      // Keep the seat for as long as the rider can still complete this checkout. A hold is
      // only extended while it is still live, and once it ends a new checkout cannot start.
      const sessionExpiresAt = new Date(session.expires_at * 1000);
      await prisma.booking.updateMany({
        where: {
          id: prepared.payment.bookingId,
          status: BookingStatus.PENDING_PAYMENT,
          holdExpiresAt: { gt: new Date(), lt: sessionExpiresAt },
        },
        data: { holdExpiresAt: sessionExpiresAt },
      });
    }
    return { paymentId: prepared.payment.id, checkoutUrl: session.url, expiresAt: new Date(session.expires_at * 1000), status: PaymentStatus.PROCESSING };
  } catch (error: unknown) {
    await prisma.payment.update({
      where: { id: prepared.payment.id },
      data: { status: PaymentStatus.FAILED, failedAt: new Date(), failureMessage: error instanceof Error ? error.message : 'Checkout creation failed' },
    });
    throw new AppError(502, 'PAYMENT_GATEWAY_ERROR', 'The payment gateway could not create a checkout session');
  }
};

const confirmSuccessfulPayment = async (paymentId: string, providerReference: string, providerEventId: string) => {
  const scope = await prisma.payment.findUnique({ where: { id: paymentId }, select: { bookingId: true } });
  if (!scope) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
  const now = new Date();
  const outcome = await prisma.$transaction(async (tx) => {
    if (scope.bookingId) await lockBooking(tx, scope.bookingId);
    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      include: {
        booking: { include: { seatAllocations: true, trip: { include: { bus: { select: { status: true } } } } } },
        subscription: { include: { plan: true } },
      },
    });
    if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
    if (([PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED] as PaymentStatus[]).includes(payment.status)) {
      return { payment, notify: false, refundRequired: false, tripId: payment.booking?.tripId };
    }
    if (([PaymentStatus.SUCCEEDED, PaymentStatus.REFUND_PENDING] as PaymentStatus[]).includes(payment.status) && payment.paidAt) {
      return {
        payment,
        notify: false,
        refundRequired: payment.status === PaymentStatus.REFUND_PENDING,
        tripId: payment.booking?.tripId,
      };
    }
    let refundRequired = false;
    if (payment.booking) {
      let maintenanceAvailable = true;
      try {
        await assertBusHasNoMaintenanceConflict(tx, {
          busId: payment.booking.trip.busId,
          startsAt: payment.booking.trip.scheduledStartAt,
          endsAt: payment.booking.trip.scheduledEndAt,
        });
      } catch (error: unknown) {
        if (error instanceof AppError && error.code === 'BUS_MAINTENANCE_CONFLICT') maintenanceAvailable = false;
        else throw error;
      }
      const validHold =
        maintenanceAvailable &&
        payment.booking.status === BookingStatus.PENDING_PAYMENT &&
        Boolean(payment.booking.holdExpiresAt && payment.booking.holdExpiresAt > now) &&
        payment.booking.seatAllocations.some((allocation) => allocation.status === SeatAllocationStatus.HELD) &&
        ([TripStatus.SCHEDULED, TripStatus.BOARDING, TripStatus.DELAYED] as TripStatus[]).includes(
          payment.booking.trip.status,
        ) &&
        (!payment.booking.trip.bookingClosesAt || payment.booking.trip.bookingClosesAt > now) &&
        payment.booking.trip.bus.status === BusStatus.ACTIVE;
      if (validHold) {
        const heldAllocation = payment.booking.seatAllocations.find(
          (allocation) => allocation.status === SeatAllocationStatus.HELD,
        );
        const allocationTransition = heldAllocation
          ? await tx.seatAllocation.updateMany({
              where: { id: heldAllocation.id, status: SeatAllocationStatus.HELD },
              data: { status: SeatAllocationStatus.CONFIRMED },
            })
          : { count: 0 };
        const bookingTransition = allocationTransition.count === 1
          ? await tx.booking.updateMany({
              where: {
                id: payment.booking.id,
                status: BookingStatus.PENDING_PAYMENT,
                holdExpiresAt: { gt: now },
              },
              data: { status: BookingStatus.CONFIRMED, confirmedAt: now, holdExpiresAt: null, version: { increment: 1 } },
            })
          : { count: 0 };
        if (allocationTransition.count !== 1 || bookingTransition.count !== 1) {
          refundRequired = true;
          if (heldAllocation && allocationTransition.count === 1) {
            await tx.seatAllocation.updateMany({
              where: { id: heldAllocation.id, status: SeatAllocationStatus.CONFIRMED },
              data: {
                status: SeatAllocationStatus.RELEASED,
                releasedAt: now,
                releaseReason: 'Booking changed while payment was being confirmed',
              },
            });
          }
          await tx.booking.updateMany({
            where: { id: payment.booking.id, status: { in: [BookingStatus.HELD, BookingStatus.PENDING_PAYMENT] } },
            data: { status: BookingStatus.EXPIRED, holdExpiresAt: null, version: { increment: 1 } },
          });
        }
      } else {
        refundRequired = true;
        await tx.seatAllocation.updateMany({
          where: { bookingId: payment.booking.id, status: SeatAllocationStatus.HELD },
          data: {
            status: SeatAllocationStatus.RELEASED,
            releasedAt: now,
            releaseReason: 'Payment confirmed after the booking became invalid',
          },
        });
        if (([BookingStatus.HELD, BookingStatus.PENDING_PAYMENT] as BookingStatus[]).includes(payment.booking.status)) {
          await tx.booking.update({
            where: { id: payment.booking.id },
            data: { status: BookingStatus.EXPIRED, holdExpiresAt: null, version: { increment: 1 } },
          });
        }
      }
    } else if (payment.subscription) {
      await tx.studentSubscription.update({
        where: { id: payment.subscription.id },
        data: {
          status: SubscriptionStatus.ACTIVE,
          startsAt: now,
          endsAt: new Date(now.getTime() + payment.subscription.plan.durationDays * 86_400_000),
        },
      });
    }
    const updated = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: refundRequired ? PaymentStatus.REFUND_PENDING : PaymentStatus.SUCCEEDED,
        providerPaymentReference: providerReference,
        paidAt: now,
      },
    });
    await tx.paymentTransaction.create({
      data: {
        paymentId: payment.id,
        provider: 'stripe',
        providerTransactionId: providerEventId,
        type: PaymentTransactionType.CHARGE,
        status: PaymentTransactionStatus.SUCCEEDED,
        amount: payment.amount,
        currency: payment.currency,
        processedAt: now,
      },
    });
    await tx.paymentReceipt.upsert({
      where: { paymentId: payment.id },
      create: {
        paymentId: payment.id,
        receiptNumber: receiptNumber(),
        breakdown: { subtotal: Number(payment.amount), total: Number(payment.amount), currency: payment.currency },
      },
      update: {},
    });
    return { payment: updated, notify: true, refundRequired, tripId: payment.booking?.tripId };
  });

  if (outcome.notify) {
    await notifyUser({
      userId: outcome.payment.payerId,
      type: NotificationType.PAYMENT_SUCCEEDED,
      title: outcome.refundRequired ? 'Payment received after hold expiry' : 'Payment successful',
      body: outcome.refundRequired
        ? `Payment ${outcome.payment.paymentNumber} was received after the seat hold expired and will be refunded.`
        : `Payment ${outcome.payment.paymentNumber} was successful.`,
      data: { paymentId: outcome.payment.id, bookingId: outcome.payment.bookingId, subscriptionId: outcome.payment.subscriptionId },
      dedupeKey: `payment-success:${outcome.payment.id}`,
    });
    if (outcome.payment.bookingId) {
      emitToUser(outcome.payment.payerId, 'booking:updated', {
        id: outcome.payment.bookingId,
        status: outcome.refundRequired ? 'EXPIRED' : 'CONFIRMED',
      });
      if (outcome.tripId) emitToTrip(outcome.tripId, 'trip:seats', { tripId: outcome.tripId, changedAt: now });
    }
  }
  if (outcome.refundRequired) await refundPayment(outcome.payment.id, 'Seat hold expired before payment confirmation');
};

const failPayment = async (paymentId: string, code: string, message: string) => {
  const scope = await prisma.payment.findUnique({ where: { id: paymentId }, select: { bookingId: true } });
  if (!scope) return;
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    if (scope.bookingId) await lockBooking(tx, scope.bookingId);
    const payment = await tx.payment.findUnique({ where: { id: paymentId }, include: { booking: true, subscription: true } });
    if (
      !payment ||
      ([
        PaymentStatus.SUCCEEDED,
        PaymentStatus.REFUND_PENDING,
        PaymentStatus.PARTIALLY_REFUNDED,
        PaymentStatus.REFUNDED,
      ] as PaymentStatus[]).includes(payment.status)
    ) {
      return null;
    }
    const updated = await tx.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.FAILED, failedAt: now, failureCode: code, failureMessage: message },
    });
    if (payment.booking && ([BookingStatus.HELD, BookingStatus.PENDING_PAYMENT] as BookingStatus[]).includes(payment.booking.status)) {
      await tx.booking.update({ where: { id: payment.booking.id }, data: { status: BookingStatus.EXPIRED, version: { increment: 1 } } });
      await tx.seatAllocation.updateMany({
        where: { bookingId: payment.booking.id, status: SeatAllocationStatus.HELD },
        data: { status: SeatAllocationStatus.RELEASED, releasedAt: now, releaseReason: 'Payment failed' },
      });
    }
    if (payment.subscription) {
      await tx.studentSubscription.update({ where: { id: payment.subscription.id }, data: { status: SubscriptionStatus.CANCELLED, cancelledAt: now } });
    }
    return updated;
  });
  if (result) {
    await notifyUser({
      userId: result.payerId,
      type: NotificationType.PAYMENT_FAILED,
      title: 'Payment failed',
      body: `Payment ${result.paymentNumber} failed. Your card information was not stored.`,
      data: { paymentId: result.id, bookingId: result.bookingId },
      dedupeKey: `payment-failed:${result.id}`,
    });
  }
};

const refundPaymentSelect = {
  id: true,
  payerId: true,
  bookingId: true,
  subscriptionId: true,
  paymentNumber: true,
  providerPaymentReference: true,
  amount: true,
  currency: true,
} as const;

const stripeObjectId = (value: string | { id: string } | null): string | undefined =>
  typeof value === 'string' ? value : value?.id;

const resolvePaymentForPaymentIntent = async (
  gateway: Stripe,
  paymentIntent: string | Stripe.PaymentIntent | null,
  metadataPaymentId?: string,
) => {
  const paymentIntentId = stripeObjectId(paymentIntent);
  let paymentId = metadataPaymentId ?? (typeof paymentIntent === 'object' && paymentIntent ? paymentIntent.metadata.paymentId : undefined);
  if (!paymentId && paymentIntentId) {
    const intent = await gateway.paymentIntents.retrieve(paymentIntentId);
    paymentId = intent.metadata.paymentId;
  }
  const payment = paymentId
    ? await prisma.payment.findUnique({ where: { id: paymentId }, select: refundPaymentSelect })
    : paymentIntentId
      ? await prisma.payment.findFirst({ where: { providerPaymentReference: paymentIntentId }, select: refundPaymentSelect })
      : null;
  if (!payment || !paymentIntentId) {
    throw new AppError(503, 'PAYMENT_RECONCILIATION_PENDING', 'The refunded payment could not yet be resolved');
  }

  let referenceMatches = payment.providerPaymentReference === paymentIntentId;
  if (!referenceMatches && payment.providerPaymentReference?.startsWith('cs_')) {
    const session = await gateway.checkout.sessions.retrieve(payment.providerPaymentReference);
    referenceMatches =
      stripeObjectId(session.payment_intent) === paymentIntentId &&
      session.client_reference_id === payment.id &&
      session.metadata?.paymentId === payment.id;
  }
  if (!referenceMatches) {
    throw new AppError(400, 'PAYMENT_VERIFICATION_FAILED', 'The refund did not belong to the current payment attempt');
  }
  return payment;
};

const refundTransactionStatus = (status: Stripe.Refund['status']): PaymentTransactionStatus =>
  status === 'succeeded'
    ? PaymentTransactionStatus.SUCCEEDED
    : status === 'failed' || status === 'canceled'
      ? PaymentTransactionStatus.FAILED
      : PaymentTransactionStatus.PENDING;

const reconcileStripeRefunds = async (paymentId: string, refunds: Stripe.Refund[]) => {
  if (!refunds.length) throw new AppError(503, 'REFUND_DETAILS_PENDING', 'Stripe has not supplied refund details yet');
  const scope = await prisma.payment.findUnique({ where: { id: paymentId }, select: { bookingId: true } });
  if (!scope) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    if (scope.bookingId) await lockBooking(tx, scope.bookingId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'refund:' + paymentId}))`;
    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      include: { booking: { select: { tripId: true } }, subscription: { select: { id: true } } },
    });
    if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');

    for (const refund of refunds) {
      const transactionStatus = refundTransactionStatus(refund.status);
      const amount = refund.amount / 100;
      const data = {
        status: transactionStatus,
        amount,
        processedAt: transactionStatus === PaymentTransactionStatus.SUCCEEDED ? now : null,
        failureCode: refund.failure_reason,
        failureMessage: refund.failure_reason,
      };
      const existing = await tx.paymentTransaction.findUnique({
        where: { provider_providerTransactionId: { provider: 'stripe', providerTransactionId: refund.id } },
      });
      if (existing) {
        if (existing.paymentId !== payment.id) {
          throw new AppError(409, 'REFUND_REFERENCE_CONFLICT', 'The Stripe refund is linked to another payment');
        }
        await tx.paymentTransaction.update({ where: { id: existing.id }, data });
        continue;
      }
      const pending = await tx.paymentTransaction.findFirst({
        where: {
          paymentId: payment.id,
          type: PaymentTransactionType.REFUND,
          providerTransactionId: null,
          status: { in: [PaymentTransactionStatus.PENDING, PaymentTransactionStatus.FAILED] },
          amount,
        },
        orderBy: { createdAt: 'asc' },
      });
      if (pending) {
        await tx.paymentTransaction.update({
          where: { id: pending.id },
          data: { ...data, providerTransactionId: refund.id },
        });
      } else {
        await tx.paymentTransaction.create({
          data: {
            paymentId: payment.id,
            provider: 'stripe',
            providerTransactionId: refund.id,
            type: PaymentTransactionType.REFUND,
            currency: payment.currency,
            ...data,
          },
        });
      }
    }

    const totals = await tx.paymentTransaction.aggregate({
      where: {
        paymentId: payment.id,
        type: PaymentTransactionType.REFUND,
        status: PaymentTransactionStatus.SUCCEEDED,
      },
      _sum: { amount: true },
    });
    const refundedAmount = Math.min(Number(payment.amount), Number(totals._sum.amount ?? 0));
    const fullyRefunded = refundedAmount >= Number(payment.amount);
    const paymentStatus = fullyRefunded
      ? PaymentStatus.REFUNDED
      : refundedAmount > 0
        ? PaymentStatus.PARTIALLY_REFUNDED
        : PaymentStatus.REFUND_PENDING;
    const updated = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: paymentStatus,
        refundedAmount,
        paidAt:
          payment.paidAt ??
          (refundedAmount > 0
            ? new Date(Math.min(...refunds.map((refund) => refund.created * 1_000)))
            : undefined),
      },
    });
    if (refundedAmount > 0) {
      await tx.paymentReceipt.upsert({
        where: { paymentId: payment.id },
        create: {
          paymentId: payment.id,
          receiptNumber: receiptNumber(),
          breakdown: {
            subtotal: Number(payment.amount),
            refunded: refundedAmount,
            total: Number(payment.amount) - refundedAmount,
            currency: payment.currency,
          },
        },
        update: {
          breakdown: {
            subtotal: Number(payment.amount),
            refunded: refundedAmount,
            total: Number(payment.amount) - refundedAmount,
            currency: payment.currency,
          },
        },
      });
    }
    if (fullyRefunded && payment.bookingId) {
      await tx.booking.updateMany({
        where: { id: payment.bookingId, status: { not: BookingStatus.REFUNDED } },
        data: { status: BookingStatus.REFUNDED, holdExpiresAt: null, version: { increment: 1 } },
      });
      await tx.seatAllocation.updateMany({
        where: {
          bookingId: payment.bookingId,
          status: { in: [SeatAllocationStatus.HELD, SeatAllocationStatus.CONFIRMED] },
        },
        data: { status: SeatAllocationStatus.RELEASED, releasedAt: now, releaseReason: 'Payment fully refunded' },
      });
    }
    if (fullyRefunded && payment.subscriptionId) {
      await tx.studentSubscription.updateMany({
        where: { id: payment.subscriptionId, status: { not: SubscriptionStatus.CANCELLED } },
        data: { status: SubscriptionStatus.CANCELLED, cancelledAt: now },
      });
    }
    return {
      payment: updated,
      refundedAmount,
      fullyRefunded,
      tripId: payment.booking?.tripId,
      failed: refunds.some((refund) => refundTransactionStatus(refund.status) === PaymentTransactionStatus.FAILED),
      pending: refunds.some((refund) => refundTransactionStatus(refund.status) === PaymentTransactionStatus.PENDING),
    };
  });

  const refundKey = refunds
    .map((refund) => `${refund.id}:${refund.status ?? 'pending'}`)
    .sort()
    .join(',');
  await notifyUser({
    userId: result.payment.payerId,
    type: NotificationType.SYSTEM,
    title: result.failed
      ? 'Refund needs attention'
      : result.pending
        ? 'Refund processing'
        : result.fullyRefunded
          ? 'Payment refunded'
          : 'Payment partially refunded',
    body: result.failed
      ? `The refund for payment ${result.payment.paymentNumber} was not completed. Transport support will retry it.`
      : result.pending
        ? `The refund for payment ${result.payment.paymentNumber} is processing.`
        : `${result.refundedAmount.toFixed(2)} ${result.payment.currency} was refunded for payment ${result.payment.paymentNumber}.`,
    data: { paymentId: result.payment.id, refundedAmount: result.refundedAmount, fullyRefunded: result.fullyRefunded },
    dedupeKey: `payment-refund:${result.payment.id}:${refundKey}`,
  });
  if (result.fullyRefunded && result.payment.bookingId) {
    emitToUser(result.payment.payerId, 'booking:updated', { id: result.payment.bookingId, status: BookingStatus.REFUNDED });
    if (result.tripId) emitToTrip(result.tripId, 'trip:seats', { tripId: result.tripId, changedAt: now });
  }
  return result;
};

export const handleStripeWebhook = async (body: Buffer, signature: string | undefined) => {
  const gateway = requireStripe();
  if (!env.STRIPE_WEBHOOK_SECRET) throw new AppError(503, 'WEBHOOK_NOT_CONFIGURED', 'Stripe webhook verification is not configured');
  if (!signature) throw new AppError(400, 'MISSING_SIGNATURE', 'Stripe signature is required');
  let event: Stripe.Event;
  try {
    event = gateway.webhooks.constructEvent(body, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    throw new AppError(400, 'INVALID_WEBHOOK_SIGNATURE', 'Stripe webhook signature verification failed');
  }

  const gatewayEvent = await prisma.paymentGatewayEvent.upsert({
    where: { provider_providerEventId: { provider: 'stripe', providerEventId: event.id } },
    create: {
      provider: 'stripe',
      providerEventId: event.id,
      eventType: event.type,
      payloadHash: sha256(body.toString('utf8')),
      signatureVerified: true,
    },
    update: {},
  });
  if (gatewayEvent.processedAt) return { received: true, duplicate: true };

  let reconciledPaymentId: string | undefined;
  try {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object;
      const paymentId = session.metadata?.paymentId ?? session.client_reference_id;
      if (paymentId && session.payment_status === 'paid') {
        const expected = await prisma.payment.findUnique({
          where: { id: paymentId },
          select: { amount: true, currency: true, providerPaymentReference: true },
        });
        const validSession =
          expected &&
          session.client_reference_id === paymentId &&
          session.metadata?.paymentId === paymentId &&
          session.amount_total === Math.round(Number(expected.amount) * 100) &&
          session.currency?.toLowerCase() === expected.currency.toLowerCase() &&
          expected.providerPaymentReference === session.id;
        if (!validSession) {
          throw new AppError(400, 'PAYMENT_VERIFICATION_FAILED', 'Checkout amount, currency, or reference did not match');
        }
        const reference = typeof session.payment_intent === 'string' ? session.payment_intent : session.id;
        await confirmSuccessfulPayment(paymentId, reference, event.id);
        reconciledPaymentId = paymentId;
      }
    } else if (event.type === 'checkout.session.async_payment_failed' || event.type === 'checkout.session.expired') {
      const session = event.data.object;
      const paymentId = session.metadata?.paymentId ?? session.client_reference_id;
      if (paymentId) {
        const expected = await prisma.payment.findUnique({
          where: { id: paymentId },
          select: { amount: true, currency: true, providerPaymentReference: true },
        });
        const isCurrentSession =
          expected &&
          expected.providerPaymentReference === session.id &&
          session.client_reference_id === paymentId &&
          session.metadata?.paymentId === paymentId &&
          (session.amount_total === null || session.amount_total === Math.round(Number(expected.amount) * 100)) &&
          (!session.currency || session.currency.toLowerCase() === expected.currency.toLowerCase());
        if (isCurrentSession) {
          await failPayment(paymentId, event.type, 'Checkout was not completed');
          reconciledPaymentId = paymentId;
        }
      }
    } else if (event.type === 'payment_intent.payment_failed') {
      const intent = event.data.object;
      const paymentId = intent.metadata.paymentId;
      if (paymentId) {
        const expected = await prisma.payment.findUnique({
          where: { id: paymentId },
          select: { providerPaymentReference: true },
        });
        // Checkout remains retryable after many card-level failures. Only a
        // directly tracked PaymentIntent may terminally fail here; Checkout
        // attempts are finalized by their validated session event above.
        if (expected?.providerPaymentReference === intent.id) {
          await failPayment(
            paymentId,
            intent.last_payment_error?.code ?? 'payment_failed',
            intent.last_payment_error?.message ?? 'Payment failed',
          );
          reconciledPaymentId = paymentId;
        }
      }
    } else if (event.type === 'charge.refunded') {
      const charge = event.data.object;
      const payment = await resolvePaymentForPaymentIntent(gateway, charge.payment_intent);
      if (
        charge.amount !== Math.round(Number(payment.amount) * 100) ||
        charge.currency.toLowerCase() !== payment.currency.toLowerCase()
      ) {
        throw new AppError(400, 'PAYMENT_VERIFICATION_FAILED', 'The refunded charge amount or currency did not match');
      }
      const refunds = charge.refunds?.has_more
        ? (await gateway.refunds.list({ charge: charge.id, limit: 100 })).data
        : charge.refunds?.data ?? [];
      await reconcileStripeRefunds(payment.id, refunds);
      reconciledPaymentId = payment.id;
    } else if (event.type === 'refund.updated' || event.type === 'refund.failed') {
      const refund = event.data.object;
      const payment = await resolvePaymentForPaymentIntent(
        gateway,
        refund.payment_intent,
        refund.metadata?.paymentId,
      );
      await reconcileStripeRefunds(payment.id, [refund]);
      reconciledPaymentId = payment.id;
    }
    await prisma.paymentGatewayEvent.update({
      where: { id: gatewayEvent.id },
      data: { processedAt: new Date(), processingError: null, paymentId: reconciledPaymentId },
    });
  } catch (error: unknown) {
    await prisma.paymentGatewayEvent.update({
      where: { id: gatewayEvent.id },
      data: { processingError: (error instanceof Error ? error.message : 'Webhook processing failed').slice(0, 2_000) },
    });
    throw error;
  }
  return { received: true };
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

export const refundPayment = async (paymentId: string, reason: string) => {
  const gateway = requireStripe();
  const prepared = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'refund:' + paymentId}))`;
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
    if (
      !([PaymentStatus.SUCCEEDED, PaymentStatus.REFUND_PENDING, PaymentStatus.PARTIALLY_REFUNDED] as PaymentStatus[]).includes(
        payment.status,
      )
    ) {
      throw new AppError(409, 'PAYMENT_NOT_REFUNDABLE', 'This payment cannot be refunded');
    }
    if (!payment.providerPaymentReference?.startsWith('pi_')) {
      throw new AppError(409, 'PAYMENT_REFERENCE_MISSING', 'The gateway payment reference is not available');
    }
    const remainingAmount = Number(payment.amount) - Number(payment.refundedAmount);
    if (remainingAmount <= 0) throw new AppError(409, 'PAYMENT_ALREADY_REFUNDED', 'The payment is already fully refunded');
    const inFlight = await tx.paymentTransaction.findFirst({
      where: {
        paymentId: payment.id,
        type: PaymentTransactionType.REFUND,
        status: PaymentTransactionStatus.PENDING,
        providerTransactionId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (inFlight?.providerTransactionId) {
      return {
        payment,
        transactionId: inFlight.id,
        providerRefundId: inFlight.providerTransactionId,
      };
    }
    await tx.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.REFUND_PENDING } });
    const existingAttempt = await tx.paymentTransaction.findFirst({
      where: {
        paymentId: payment.id,
        type: PaymentTransactionType.REFUND,
        providerTransactionId: null,
        status: { in: [PaymentTransactionStatus.PENDING, PaymentTransactionStatus.FAILED] },
      },
      orderBy: { createdAt: 'desc' },
    });
    const transaction = existingAttempt
      ? await tx.paymentTransaction.update({
          where: { id: existingAttempt.id },
          data: { status: PaymentTransactionStatus.PENDING, amount: remainingAmount, failureCode: null, failureMessage: null },
        })
      : await tx.paymentTransaction.create({
          data: {
            paymentId: payment.id,
            provider: 'stripe',
            type: PaymentTransactionType.REFUND,
            status: PaymentTransactionStatus.PENDING,
            amount: remainingAmount,
            currency: payment.currency,
            metadata: { reason: reason.slice(0, 450) },
          },
        });
    return { payment, transactionId: transaction.id, providerRefundId: undefined };
  });

  let refund: Stripe.Refund;
  try {
    refund = prepared.providerRefundId
      ? await gateway.refunds.retrieve(prepared.providerRefundId)
      : await gateway.refunds.create(
          {
            payment_intent: prepared.payment.providerPaymentReference!,
            reason: 'requested_by_customer',
            metadata: { paymentId, reason: reason.slice(0, 450) },
          },
          { idempotencyKey: `refund:${prepared.payment.id}:${prepared.transactionId}` },
        );
  } catch (error: unknown) {
    if (!prepared.providerRefundId) {
      await prisma.paymentTransaction.update({
        where: { id: prepared.transactionId },
        data: {
          status: PaymentTransactionStatus.FAILED,
          failureMessage: (error instanceof Error ? error.message : 'Refund request failed').slice(0, 2_000),
        },
      });
    }
    throw new AppError(502, 'REFUND_GATEWAY_ERROR', 'The payment gateway could not start the refund');
  }

  try {
    await prisma.paymentTransaction.update({
      where: { id: prepared.transactionId },
      data: {
        providerTransactionId: refund.id,
        status: refund.status === 'succeeded' ? PaymentTransactionStatus.SUCCEEDED : PaymentTransactionStatus.PENDING,
        processedAt: refund.status === 'succeeded' ? new Date() : null,
      },
    });
  } catch (error: unknown) {
    // Stripe is authoritative once the external call succeeds. The verified
    // charge.refunded webhook reconciles this pending row if this write fails.
    logger.error({ err: error, paymentId, refundId: refund.id }, 'Refund started but local transaction reconciliation failed');
  }
  try {
    await reconcileStripeRefunds(paymentId, [refund]);
  } catch (error: unknown) {
    logger.error({ err: error, paymentId, refundId: refund.id }, 'Refund is awaiting webhook reconciliation');
  }
  return { paymentId, refundId: refund.id, status: refund.status };
};

export const refundBookingPayments = async (bookingId: string, reason: string): Promise<void> => {
  const payments = await prisma.payment.findMany({ where: { bookingId, status: PaymentStatus.REFUND_PENDING } });
  for (const payment of payments) await refundPayment(payment.id, reason);
};
