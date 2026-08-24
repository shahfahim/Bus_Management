import type { Prisma } from '@prisma/client';

/**
 * Serializes financial and lifecycle transitions for a booking across modules.
 * Call only from inside a database transaction.
 */
export const lockBooking = async (tx: Prisma.TransactionClient, bookingId: string): Promise<void> => {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'booking:' + bookingId}))`;
};

export const lockBookings = async (tx: Prisma.TransactionClient, bookingIds: string[]): Promise<void> => {
  const orderedIds = [...new Set(bookingIds)].sort();
  for (const bookingId of orderedIds) await lockBooking(tx, bookingId);
};
