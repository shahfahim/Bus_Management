import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  const schedule = await prisma.tripSchedule.findFirst({
    orderBy: { createdAt: 'desc' },
    include: { trips: true, driver: { select: { userId: true } } }
  });
  console.log(JSON.stringify(schedule, null, 2));
}

run();
