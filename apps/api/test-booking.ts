import { prisma } from './src/lib/prisma.js';
import { createSeatHold, finalizeSeatHold } from './src/modules/bookings/booking.service.js';

async function run() {
  const trip = await prisma.trip.findFirst({
    where: { status: 'SCHEDULED' },
    include: { stops: { include: { routeStop: true } } }
  });

  if (!trip) return console.log('No trip found');

  const student = await prisma.user.findFirst({ where: { role: 'STUDENT' } });
  if (!student) return console.log('No student found');
  
  const seat = await prisma.busSeat.findFirst({ where: { busId: trip.busId } });

  console.log(`Testing with trip ${trip.id} and student ${student.id}`);
  
  // 1. Create a hold
  const hold = await createSeatHold(trip.id, seat!.seatNumber, student.id);

  console.log(`Created hold ${hold.id} for seat ${hold.seatNumber}`);

  // 2. Finalize
  try {
    await finalizeSeatHold(student.id, {
      seatHoldId: hold.id,
      tripId: trip.id,
      seatNumber: hold.seatNumber,
      boardingStopId: trip.stops[0].routeStop.stopId,
      destinationStopId: trip.stops[1].routeStop.stopId,
    });
    console.log('Finalize succeeded!');
  } catch (e: any) {
    console.error('Finalize failed:', e.message, e.stack);
  }
}

run().catch(console.error);
