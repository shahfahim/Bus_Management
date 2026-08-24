import { SubscriptionStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

export const listStudentSubscriptions = async (
  studentId: string,
  query: { status?: SubscriptionStatus; routeId?: string },
) => {
  const now = new Date();
  await prisma.studentSubscription.updateMany({
    where: { studentId, status: SubscriptionStatus.ACTIVE, endsAt: { lte: now } },
    data: { status: SubscriptionStatus.EXPIRED },
  });
  const items = await prisma.studentSubscription.findMany({
    where: {
      studentId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.routeId ? { plan: { routes: { some: { routeId: query.routeId } } } } : {}),
    },
    include: {
      plan: {
        include: { routes: { include: { route: { select: { id: true, code: true, name: true } } } } },
      },
      payments: {
        select: { id: true, status: true, paymentNumber: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  return {
    items: items.map((subscription) => ({
      id: subscription.id,
      reference: subscription.subscriptionNumber,
      status: subscription.status,
      startsAt: subscription.startsAt,
      endsAt: subscription.endsAt,
      remainingTrips: subscription.remainingTrips,
      createdAt: subscription.createdAt,
      payment: subscription.payments[0],
      plan: {
        id: subscription.plan.id,
        code: subscription.plan.code,
        name: subscription.plan.name,
        description: subscription.plan.description,
        price: Number(subscription.plan.price),
        currency: subscription.plan.currency,
        durationDays: subscription.plan.durationDays,
        tripLimit: subscription.plan.tripLimit,
        routes: subscription.plan.routes.map(({ route }) => route),
      },
    })),
  };
};
