import { BusStatus, MaintenanceStatus, MaintenanceType, Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { publicMaintenanceDto } from './maintenance.service.js';

describe('public maintenance records', () => {
  it('omits internal cost, notes, and creator information', () => {
    const publicRecord = publicMaintenanceDto({
      id: 'maintenance-1',
      busId: 'bus-1',
      createdById: 'admin-1',
      type: MaintenanceType.REPAIR,
      status: MaintenanceStatus.IN_PROGRESS,
      title: 'Brake inspection',
      description: 'Temporarily unavailable',
      startsAt: new Date('2026-08-25T08:00:00Z'),
      expectedReturnAt: new Date('2026-08-26T08:00:00Z'),
      completedAt: null,
      cost: new Prisma.Decimal('5000.00'),
      notes: 'Internal supplier and invoice details',
      createdAt: new Date('2026-08-25T07:00:00Z'),
      updatedAt: new Date('2026-08-25T09:00:00Z'),
      bus: {
        id: 'bus-1',
        fleetNumber: 'BUS-01',
        registrationNumber: 'REG-01',
        status: BusStatus.UNDER_MAINTENANCE,
      },
      createdBy: { id: 'admin-1', name: 'Private Admin Name' },
    });

    expect(publicRecord).not.toHaveProperty('cost');
    expect(publicRecord).not.toHaveProperty('notes');
    expect(publicRecord).not.toHaveProperty('createdBy');
    expect(publicRecord).not.toHaveProperty('createdById');
    expect(publicRecord.id).toBe('maintenance-1');
    expect(publicRecord.expectedAvailableAt).toEqual(new Date('2026-08-26T08:00:00Z'));
  });
});
