import { Router } from 'express';
import { BookingStatus, BusStatus, PaymentStatus, Role, SeatAllocationStatus, TripStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { asyncRoute } from '../../lib/async-route.js';
import { campusDayEnd, campusDayStart } from '../../lib/campus-time.js';
import { prisma } from '../../lib/prisma.js';
import { requireAuth } from '../auth/auth.middleware.js';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);


const dashboardTripInclude = {
  route: { include: { stops: { include: { stop: true }, orderBy: { sequence: 'asc' } } } },
  bus: true,
  _count: {
    select: {
      seatAllocations: {
        where: {
          status: {
            in: [SeatAllocationStatus.HELD, SeatAllocationStatus.CONFIRMED, SeatAllocationStatus.CHECKED_IN],
          },
        },
      },
    },
  },
} satisfies Prisma.TripInclude;

type DashboardTrip = Prisma.TripGetPayload<{ include: typeof dashboardTripInclude }>;

const nextTripDto = (trip: DashboardTrip | null) =>
  trip
    ? {
        id: trip.id,
        routeId: trip.routeId,
        route: {
          id: trip.route.id,
          code: trip.route.code,
          name: trip.route.name,
          origin: trip.route.stops[0]?.stop.name ?? '',
          destination: trip.route.stops.at(-1)?.stop.name ?? '',
          stops: trip.route.stops.map((item) => ({
            id: item.stop.id,
            name: item.stop.name,
            sequence: item.sequence,
            latitude: Number(item.stop.latitude),
            longitude: Number(item.stop.longitude),
          })),
        },
        busId: trip.busId,
        bus: {
          id: trip.bus.id,
          registrationNumber: trip.bus.registrationNumber,
          label: trip.bus.fleetNumber,
          capacity: trip.bus.capacity,
          status: trip.bus.status,
        },
        departureTime: trip.scheduledStartAt,
        estimatedArrivalTime: trip.scheduledEndAt,
        availableSeats: Math.max(0, trip.bus.capacity - trip._count.seatAllocations),
        totalSeats: trip.bus.capacity,
        fare: Number(trip.fareAmount),
        currency: trip.currency,
        status: trip.status,
      }
    : undefined;

dashboardRouter.get(
  '/summary',
  asyncRoute(async (request, response) => {
    const userId = request.auth!.userId;
    const role = request.auth!.role;
    // "Today" is the campus day in Dhaka, not the server's (UTC) calendar day.
    const today = campusDayStart();
    const tomorrow = campusDayEnd();
    if (role === Role.STUDENT) {
      const [upcomingBookings, unreadNotifications, completedTrips] = await prisma.$transaction([
        prisma.booking.count({
          where: {
            studentId: userId,
            status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] },
            trip: { scheduledStartAt: { gte: new Date() } },
          },
        }),
        prisma.notification.count({ where: { userId, readAt: null } }),
        prisma.booking.count({ where: { studentId: userId, status: BookingStatus.COMPLETED } }),
      ]);
      response.json({ upcomingBookings, unreadNotifications, completedTrips });
      return;
    }
    if (role === Role.DRIVER || role === Role.CONDUCTOR) {
      const actorWhere = role === Role.DRIVER ? { driverId: userId } : { conductorId: userId };
      const [assignedTrips, activeTrips, passengersToday, nextTrip] = await Promise.all([
        prisma.trip.count({ where: { ...actorWhere, scheduledStartAt: { gte: today, lt: tomorrow } } }),
        prisma.trip.count({ where: { ...actorWhere, status: { in: [TripStatus.IN_PROGRESS, TripStatus.DELAYED] } } }),
        prisma.booking.count({
          where: {
            trip: { ...actorWhere, scheduledStartAt: { gte: today, lt: tomorrow } },
            status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN, BookingStatus.COMPLETED] },
          },
        }),
        prisma.trip.findFirst({
          where: {
            ...actorWhere,
            status: { in: [TripStatus.SCHEDULED, TripStatus.BOARDING, TripStatus.IN_PROGRESS, TripStatus.DELAYED] },
            scheduledStartAt: { gte: new Date(today.getTime() - 4 * 60 * 60_000) },
          },
          include: dashboardTripInclude,
          orderBy: { scheduledStartAt: 'asc' },
        }),
      ]);
      response.json({ assignedTrips, activeTrips, passengersToday, nextTrip: nextTripDto(nextTrip) });
      return;
    }

    const [activeBuses, activeTrips, bookingsToday, revenue, totalStudents, driversOnDuty] = await Promise.all([
      prisma.bus.count({ where: { status: BusStatus.ACTIVE } }),
      prisma.trip.count({ where: { status: { in: [TripStatus.BOARDING, TripStatus.IN_PROGRESS, TripStatus.DELAYED] } } }),
      prisma.booking.count({ where: { createdAt: { gte: today, lt: tomorrow } } }),
      prisma.payment.aggregate({
        where: { status: PaymentStatus.SUCCEEDED, paidAt: { gte: today, lt: tomorrow } },
        _sum: { amount: true },
      }),
      prisma.user.count({ where: { role: Role.STUDENT, deletedAt: null } }),
      prisma.trip.count({
        where: { status: { in: [TripStatus.BOARDING, TripStatus.IN_PROGRESS, TripStatus.DELAYED] }, driver: { status: 'ACTIVE' } },
      }),
    ]);
    response.json({
      activeBuses,
      activeTrips,
      bookingsToday,
      revenueToday: Number(revenue._sum.amount ?? 0),
      totalStudents,
      driversOnDuty,
    });
  }),
);
