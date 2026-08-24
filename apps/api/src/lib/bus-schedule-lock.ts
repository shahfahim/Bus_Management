import type { Prisma } from '@prisma/client';

/** Serializes trip and maintenance window changes for one bus. */
export const lockBusSchedule = async (tx: Prisma.TransactionClient, busId: string): Promise<void> => {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'bus-schedule:' + busId}))`;
};
