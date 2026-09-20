import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { TripStatus } from '@prisma/client';

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

export const generateTrips = async () => {
  logger.info({ module: 'TripGenerator' }, 'Generating trips for active schedules...');
  const schedules = await prisma.tripSchedule.findMany({
    where: { isActive: true },
    include: { route: { include: { stops: { orderBy: { sequence: 'asc' } } } } }
  });

  let createdCount = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const schedule of schedules) {
    // Generate for the next 7 days
    for (let i = 0; i < 7; i++) {
      const targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() + i);

      // Check validFrom and validTo
      if (targetDate < schedule.validFrom) continue;
      if (schedule.validTo && targetDate > schedule.validTo) continue;

      // Check days of week (0 = Sunday, 1 = Monday, ...)
      const dayOfWeek = targetDate.getDay();
      if (!schedule.daysOfWeek.includes(dayOfWeek)) continue;

      // Parse departureTime "HH:mm"
      const [hours, minutes] = schedule.departureTime.split(':').map(Number);
      const scheduledStart = new Date(targetDate);
      scheduledStart.setHours(hours ?? 0, minutes ?? 0, 0, 0);
      
      const scheduledEnd = new Date(scheduledStart);
      scheduledEnd.setMinutes(scheduledEnd.getMinutes() + (schedule.route.estimatedDurationMinutes ?? 60));

      // Avoid duplicates
      const existingTrip = await prisma.trip.findFirst({
        where: {
          scheduleId: schedule.id,
          scheduledStartAt: {
            gte: new Date(scheduledStart.getTime() - 60000), // within 1 minute
            lte: new Date(scheduledStart.getTime() + 60000),
          }
        }
      });

      if (!existingTrip) {
        await prisma.$transaction(async (tx) => {
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
              fareAmount: 0,
              publicCode: `TRIP-${Date.now()}-${Math.floor(Math.random()*1000)}`,
            }
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
            })
          });
        });
        createdCount++;
      }
    }
  }

  logger.info({ module: 'TripGenerator', createdCount }, 'Finished generating trips');
};
