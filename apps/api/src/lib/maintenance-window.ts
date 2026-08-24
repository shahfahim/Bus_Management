import { MaintenanceStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { AppError } from './errors.js';

export const assertBusHasNoMaintenanceConflict = async (
  tx: Prisma.TransactionClient,
  input: { busId: string; startsAt: Date; endsAt: Date | null },
): Promise<void> => {
  const maintenance = await tx.maintenanceRecord.findFirst({
    where: {
      busId: input.busId,
      status: { in: [MaintenanceStatus.SCHEDULED, MaintenanceStatus.IN_PROGRESS] },
      ...(input.endsAt ? { startsAt: { lt: input.endsAt } } : {}),
      OR: [{ expectedReturnAt: null }, { expectedReturnAt: { gt: input.startsAt } }],
    },
    select: { id: true, title: true, startsAt: true, expectedReturnAt: true },
  });
  if (maintenance) {
    throw new AppError(
      409,
      'BUS_MAINTENANCE_CONFLICT',
      `The assigned bus is unavailable during scheduled maintenance: ${maintenance.title}`,
    );
  }
};
