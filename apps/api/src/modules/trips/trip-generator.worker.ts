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
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' });
  const dhakaDateStr = formatter.format(now);
  const baseDate = new Date(`${dhakaDateStr}T00:00:00+06:00`);

  for (const schedule of schedules) {
    // Generate for the next 7 days
    for (let i = 0; i < 7; i++) {
      const targetDate = new Date(baseDate.getTime() + i * 24 * 60 * 60 * 1000);

      // Check validFrom and validTo by comparing YYYY-MM-DD strings to avoid TZ shift bugs
      const targetDateStr = formatter.format(targetDate);
      const validFromStr = schedule.validFrom.toISOString().split('T')[0] as string;
      if (targetDateStr < validFromStr) continue;
      
      if (schedule.validTo) {
        const validToStr = schedule.validTo.toISOString().split('T')[0] as string;
        if (targetDateStr > validToStr) continue;
      }

      // Check days of week (0 = Sunday, 1 = Monday, ...)
      // We must get the day of the week in Dhaka time
      // The easiest way is to use getUTCDay() since baseDate is Midnight UTC-6 (so 18:00 UTC previous day).
      // Wait, 00:00+06:00 is 18:00 UTC previous day. So getUTCDay() would be wrong by 1 day!
      // Since it's exactly midnight in Dhaka time, we can parse the isoDate:
      const isoDate = formatter.format(targetDate);
      const localDayOfWeek = new Date(`${isoDate}T12:00:00Z`).getUTCDay(); // safe noon UTC
      
      if (!schedule.daysOfWeek.includes(localDayOfWeek)) continue;

      // Parse departureTime "HH:mm"
      const [hours, minutes] = schedule.departureTime.split(':');
      const scheduledStart = new Date(`${isoDate}T${hours}:${minutes}:00+06:00`);
      
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
              publicCode: `TRIP-${isoDate.replace(/-/g, '')}-${schedule.id.slice(0, 8).toUpperCase()}`,
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
