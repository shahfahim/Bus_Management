import { prisma } from './src/lib/prisma.js';

async function run() {
  const route = await prisma.route.findFirst({
    where: { code: 'CR-801088' },
    include: { stops: true }
  });
  console.log("Route Stops:", JSON.stringify(route?.stops, null, 2));

  if (route) {
    const trip = await prisma.trip.findFirst({
      where: { routeId: route.id },
      include: { stops: { include: { routeStop: true } } }
    });
    console.log("Trip Stops:", JSON.stringify(trip?.stops, null, 2));
  }
}

run().catch(console.error);
