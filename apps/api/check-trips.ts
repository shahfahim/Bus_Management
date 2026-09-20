import { PrismaClient, TripStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.trip.updateMany({
    where: {
      scheduleId: null,
      status: 'SCHEDULED'
    },
    data: {
      status: TripStatus.CANCELLED,
      cancellationReason: 'Schedule was deleted by administrator'
    }
  });
  
  console.log(`Cancelled ${result.count} orphan scheduled trips.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
