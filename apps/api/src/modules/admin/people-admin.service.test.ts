import { DriverStatus, Role, UserStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
  updateUser: vi.fn(),
  updateDriver: vi.fn(),
  createAudit: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}));

vi.mock('../../realtime/hub.js', () => ({
  disconnectUserSockets: vi.fn(),
}));

import { updateAdminUser } from './people-admin.service.js';

const pendingDriver = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Pending Driver',
  email: 'driver@example.com',
  phone: null,
  avatarUrl: null,
  role: Role.DRIVER,
  status: UserStatus.PENDING_VERIFICATION,
  passwordHash: 'unused',
  emailVerifiedAt: null,
  lastLoginAt: null,
  failedLoginAttempts: 0,
  lockedUntil: null,
  passwordChangedAt: new Date(),
  createdAt: new Date('2026-08-25T00:00:00.000Z'),
  updatedAt: new Date('2026-08-25T00:00:00.000Z'),
  deletedAt: null,
  studentProfile: null,
  driverProfile: {
    userId: '00000000-0000-4000-8000-000000000001',
    employeeNumber: 'DRV-100',
    licenseNumber: 'LIC-100',
    licenseExpiresAt: new Date('2035-01-01T00:00:00.000Z'),
    status: DriverStatus.INACTIVE,
    averageRating: 0,
    ratingCount: 0,
    hiredAt: null,
    createdAt: new Date('2026-08-25T00:00:00.000Z'),
    updatedAt: new Date('2026-08-25T00:00:00.000Z'),
  },
  _count: { payments: 0, notifications: 0, sessions: 0 },
};

describe('driver account verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUser.mockResolvedValue(pendingDriver);
    mocks.updateDriver.mockResolvedValue({ ...pendingDriver.driverProfile, status: DriverStatus.ACTIVE });
    mocks.updateUser.mockResolvedValue({
      ...pendingDriver,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      driverProfile: { ...pendingDriver.driverProfile, status: DriverStatus.ACTIVE },
    });
    mocks.createAudit.mockResolvedValue({});
    mocks.transaction.mockImplementation((operation: (client: unknown) => unknown) => operation({
      user: { findFirst: mocks.findUser, update: mocks.updateUser },
      driverProfile: { update: mocks.updateDriver },
      auditLog: { create: mocks.createAudit },
    }));
  });

  it('activates both the user and driver profile in one transaction', async () => {
    const result = await updateAdminUser(
      pendingDriver.id,
      { status: UserStatus.ACTIVE },
      { actorId: '00000000-0000-4000-8000-000000000099' },
    );

    const driverUpdate = mocks.updateDriver.mock.calls[0]?.[0] as unknown as {
      where: { userId: string };
      data: { status: DriverStatus };
    };
    const userUpdate = mocks.updateUser.mock.calls[0]?.[0] as unknown as {
      where: { id: string };
      data: { status: UserStatus };
    };
    expect(driverUpdate).toMatchObject({ where: { userId: pendingDriver.id }, data: { status: DriverStatus.ACTIVE } });
    expect(userUpdate).toMatchObject({ where: { id: pendingDriver.id }, data: { status: UserStatus.ACTIVE } });
    expect(result).toMatchObject({ status: 'active', driverProfile: { status: 'active' } });
  });
});
