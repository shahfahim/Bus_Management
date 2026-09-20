import { PrismaClient } from '@prisma/client';

const p = new PrismaClient({ log: ['query'] });

async function run() {
  const start = Date.now();
  try {
      // Warm up
      await p.trip.findFirst({ select: { id: true } });
      
      const b2 = await p.booking.findFirst({ select: { id: true }});
      if (b2) {
        const bookingInclude = {
          seatAllocations: { include: { seat: true } },
          boardingStop: { include: { routeStop: { include: { stop: true } } } },
          dropoffStop: { include: { routeStop: { include: { stop: true } } } },
          trip: {
            include: {
              route: true,
              bus: true,
              driver: { include: { user: { select: { id: true, name: true, phone: true } } } },
            },
          },
          payments: { orderBy: { createdAt: 'desc' as const }, take: 1 },
          checkIns: { where: { result: 'ACCEPTED' as const }, orderBy: { checkedInAt: 'desc' as const }, take: 1 },
        };
        console.time('bookingInclude_query');
        await p.booking.findUnique({ where: { id: b2.id }, include: bookingInclude });
        console.timeEnd('bookingInclude_query');
      }
    console.log('Transaction finished successfully:', Date.now() - start);
  } catch (e: any) {
    console.error('Error:', e.message, Date.now() - start);
  } finally {
    await p.$disconnect();
  }
}

run().catch(console.error);
