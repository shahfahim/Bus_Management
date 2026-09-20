import { prisma } from './src/lib/prisma.js';

async function main() {
  const trips = await prisma.trip.findMany({
    include: {
      route: {
        select: {
          name: true,
        }
      }
    }
  });
  console.log("ALL TRIPS:");
  trips.forEach(t => {
    console.log(`- ID: ${t.id} | Route: ${t.route.name} | Status: ${t.status} | Start: ${t.scheduledStartAt.toISOString()} | End: ${t.scheduledEndAt?.toISOString()}`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
