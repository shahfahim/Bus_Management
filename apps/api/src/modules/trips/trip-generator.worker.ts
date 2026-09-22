import { randomBytes } from 'node:crypto';
import { BusStatus, DriverStatus, TripStatus, UserStatus, type Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';

/**
 * Runs daily at midnight to generate Trip records for active schedules for the next 7 days.
 * 
 * NOTE: For production, this should ideally be invoked by an external cron trigger (e.g., Render Cron)
 * calling an internal endpoint, but for this implementation we will run a setInterval loop in the Node process.
 */
export const startTripGeneratorWorker = () => {
  logger.info({ module: 'TripGenerator' }, 'Starting Trip Generator Worker...');
  
  // Run once on startup
  generateTrips().catch(err => {
    logger.error({ module: 'TripGenerator', err }, 'Failed to generate trips on startup');
  });

  const interval = setInterval(() => {
    generateTrips().catch(err => {
      logger.error({ module: 'TripGenerator', err }, 'Failed to generate trips during interval');
    });
  }, 12 * 60 * 60 * 1000);

  return () => clearInterval(interval);
};

const DAY_MS = 24 * 60 * 60 * 1000;
const dhakaDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' });
const dhakaTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Trips cancelled because their schedule changed may be recreated when the schedule matches them again. */
export const SCHEDULE_CHANGE_CANCELLATION_REASON = 'Schedule configuration changed by administrator';

/** Calendar date (YYYY-MM-DD), weekday (0 = Sunday) and HH:mm of an instant in Dhaka time. */
export const dhakaSlot = (instant: Date) => {
  const isoDate = dhakaDate.format(instant);
  // Dhaka midnight is 18:00 UTC the previous day, so read the weekday at noon UTC of the Dhaka date.
  return { isoDate, weekday: new Date(`${isoDate}T12:00:00Z`).getUTCDay(), time: dhakaTime.format(instant) };
};

const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

/** Whether an existing trip still belongs to the schedule's route, bus, days, validity window and departure time. */
export const tripMatchesSchedule = (
  trip: { routeId: string; busId: string; scheduledStartAt: Date },
  schedule: { routeId: string; busId: string; departureTime: string; daysOfWeek: number[]; validFrom: Date; validTo: Date | null },
): boolean => {
  const slot = dhakaSlot(trip.scheduledStartAt);
  return (
    trip.routeId === schedule.routeId &&
    trip.busId === schedule.busId &&
    slot.time === schedule.departureTime &&
    schedule.daysOfWeek.includes(slot.weekday) &&
    slot.isoDate >= isoDay(schedule.validFrom) &&
    (!schedule.validTo || slot.isoDate <= isoDay(schedule.validTo))
  );
};

export const generateTrips = async () => {
  logger.info({ module: 'TripGenerator' }, 'Generating trips for active schedules...');
  // Skip schedules whose driver or bus can no longer operate; admins reassign them first.
  const schedules = await prisma.tripSchedule.findMany({
    where: {
      isActive: true,
      bus: { status: { notIn: [BusStatus.INACTIVE, BusStatus.RETIRED] } },
      driver: { status: DriverStatus.ACTIVE, user: { status: UserStatus.ACTIVE, deletedAt: null } },
    },
    include: { route: { include: { stops: { orderBy: { sequence: 'asc' } } } } },
  });

  let createdCount = 0;
  const now = new Date();
  const baseDate = new Date(`${dhakaDate.format(now)}T00:00:00+06:00`);

  for (const schedule of schedules) {
    try {
      createdCount += await generateForSchedule(schedule, baseDate, now);
    } catch (err: unknown) {
      // One broken schedule must not stop trips being generated for the others.
      logger.error({ module: 'TripGenerator', err, scheduleId: schedule.id }, 'Failed to generate trips for schedule');
    }
  }

  logger.info({ module: 'TripGenerator', createdCount }, 'Finished generating trips');
};

type ScheduleWithRoute = Prisma.TripScheduleGetPayload<{ include: { route: { include: { stops: true } } } }>;

const generateForSchedule = async (schedule: ScheduleWithRoute, baseDate: Date, now: Date): Promise<number> => {
  let createdCount = 0;
  // Generate for the next 7 days
  for (let i = 0; i < 7; i++) {
    const { isoDate, weekday } = dhakaSlot(new Date(baseDate.getTime() + i * DAY_MS));
    // Compare YYYY-MM-DD strings to avoid time-zone shifts.
    if (isoDate < isoDay(schedule.validFrom)) continue;
    if (schedule.validTo && isoDate > isoDay(schedule.validTo)) continue;
    if (!schedule.daysOfWeek.includes(weekday)) continue;

    const scheduledStart = new Date(`${isoDate}T${schedule.departureTime}:00+06:00`);
    // A departure that has already passed today would sit in SCHEDULED forever.
    if (scheduledStart <= now) continue;
    const scheduledEnd = new Date(scheduledStart.getTime() + (schedule.route.estimatedDurationMinutes ?? 60) * 60_000);

    const created = await prisma.$transaction(async (tx) => {
      // Serialize per schedule so overlapping runs (startup + interval, or a second
      // instance) cannot both pass the duplicate check and insert the same trip.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('trip-generator'), hashtext(${schedule.id})) IS NULL AS locked`;
      const existingTrip = await tx.trip.findFirst({
        where: {
          scheduleId: schedule.id,
          scheduledStartAt: {
            gte: new Date(scheduledStart.getTime() - 60000), // within 1 minute
            lte: new Date(scheduledStart.getTime() + 60000),
          },
          // A trip an admin cancelled (e.g. a holiday) stays cancelled; one cancelled only
          // because the schedule changed is recreated once the schedule covers it again.
          OR: [
            { status: { not: TripStatus.CANCELLED } },
            { cancellationReason: null },
            { cancellationReason: { not: SCHEDULE_CHANGE_CANCELLATION_REASON } },
          ],
        },
        select: { id: true },
      });
      if (existingTrip) return false;

      const trip = await tx.trip.create({
        data: {
          scheduleId: schedule.id,
          routeId: schedule.routeId,
          busId: schedule.busId,
          driverId: schedule.driverId,
          scheduledStartAt: scheduledStart,
          scheduledEndAt: scheduledEnd,
          status: TripStatus.SCHEDULED,
          bookingClosesAt: scheduledStart,
          fareAmount: schedule.fareAmount,
          // The random suffix keeps codes unique when a date is regenerated after a cancellation.
          publicCode: `TRIP-${isoDate.replace(/-/g, '')}-${schedule.id.slice(0, 8).toUpperCase()}-${randomBytes(2).toString('hex').toUpperCase()}`,
        },
      });

      const duration = scheduledEnd.getTime() - scheduledStart.getTime();
      const routeDistance = schedule.route.distanceMeters ?? schedule.route.stops.at(-1)?.distanceFromStartMeters ?? 0;

      await tx.tripStop.createMany({
        data: schedule.route.stops.map((routeStop, index) => {
          const ratio =
            routeStop.plannedOffsetMinutes !== null
              ? Math.min(1, Math.max(0, (routeStop.plannedOffsetMinutes * 60_000) / duration))
              : routeDistance > 0 && routeStop.distanceFromStartMeters !== null
                ? Math.min(1, Math.max(0, routeStop.distanceFromStartMeters / routeDistance))
                : index / Math.max(1, schedule.route.stops.length - 1);
          return {
            tripId: trip.id,
            routeStopId: routeStop.id,
            sequence: routeStop.sequence,
            scheduledArrivalAt: new Date(scheduledStart.getTime() + duration * ratio),
          };
        }),
      });
      return true;
    });
    if (created) createdCount++;
  }
  return createdCount;
};
