import { Role, UserStatus } from '@prisma/client';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  comparePassword: vi.fn(),
  hashPassword: vi.fn(),
  findUser: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  createSession: vi.fn(),
  updateSession: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('bcryptjs', () => ({
  default: {
    compare: mocks.comparePassword,
    hash: mocks.hashPassword,
  },
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: mocks.findUser,
      create: mocks.createUser,
      update: mocks.updateUser,
    },
    session: {
      create: mocks.createSession,
      update: mocks.updateSession,
    },
    $transaction: mocks.transaction,
  },
}));

import { login, registerAccount } from './auth.service.js';

const request = {
  get: vi.fn(),
  ip: '127.0.0.1',
} as unknown as Request;

const account = (status: UserStatus, overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  email: 'student@example.edu',
  name: 'Test Student',
  phone: null,
  role: Role.STUDENT,
  status,
  avatarUrl: null,
  studentProfile: null,
  driverProfile: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  passwordHash: '$2b$12$test-hash',
  failedLoginAttempts: 4,
  lockedUntil: null,
  ...overrides,
});

describe('login account-state regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([UserStatus.SUSPENDED, UserStatus.DEACTIVATED])(
    'records a failed attempt without globally locking a %s account',
    async (status) => {
      mocks.findUser.mockResolvedValue(account(status));
      mocks.comparePassword.mockResolvedValue(false);
      mocks.updateUser.mockResolvedValue({});

      await expect(login({ email: 'student@example.edu', password: 'wrong-password' }, request)).rejects.toMatchObject({
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
      });

      expect(mocks.updateUser).toHaveBeenCalledOnce();
      const update = mocks.updateUser.mock.calls[0]?.[0] as { data: Record<string, unknown> };
      expect(update.data.failedLoginAttempts).toBe(5);
      expect(update.data).not.toHaveProperty('lockedUntil');
      expect(update.data).not.toHaveProperty('status');
      expect(mocks.createSession).not.toHaveBeenCalled();
    },
  );

  it('does not auto-reactivate an explicitly LOCKED account after its timed lock has expired', async () => {
    mocks.findUser.mockResolvedValue(
      account(UserStatus.LOCKED, {
        failedLoginAttempts: 0,
        lockedUntil: new Date(Date.now() - 60_000),
      }),
    );
    mocks.comparePassword.mockResolvedValue(true);

    await expect(login({ email: 'student@example.edu', password: 'correct-password' }, request)).rejects.toMatchObject({
      statusCode: 403,
      code: 'ACCOUNT_DISABLED',
    });

    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});

describe('role-aware self-registration approval controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hashPassword.mockResolvedValue('hashed-password');
    mocks.transaction.mockImplementation((operation: (client: unknown) => unknown) =>
      Promise.resolve(operation({ user: { findUnique: mocks.findUser, create: mocks.createUser } })),
    );
  });

  it('accepts any valid email and creates an unverified pending student account', async () => {
    mocks.findUser.mockResolvedValue(null);
    mocks.createUser.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({
      ...account(UserStatus.PENDING_VERIFICATION, {
        email: 'student@gmail.com',
        passwordChangedAt: new Date(),
      }),
      status: data.status,
    }));

    const result = await registerAccount(
      {
        email: 'student@gmail.com',
        password: 'StrongPassword1',
        name: 'Test Student',
        role: Role.STUDENT,
        studentId: '2026-001',
        department: 'Computer Science',
      },
      request,
    );

    expect(result.approvalRequired).toBe(true);
    expect(result.user.status).toBe(UserStatus.PENDING_VERIFICATION);
    const createInput = mocks.createUser.mock.calls[0]?.[0] as unknown as {
      data: { status: UserStatus; emailVerifiedAt: Date | null };
    };
    expect(createInput.data.status).toBe(UserStatus.PENDING_VERIFICATION);
    expect(createInput.data.emailVerifiedAt).toBeNull();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it.each([

    {
      role: Role.DRIVER,
      email: 'driver@example.com',
      employeeNumber: 'DRV-100',
      licenseNumber: 'LIC-100',
      licenseExpiresAt: new Date('2035-01-01'),
    },
  ])('creates a pending $role account without requiring a student ID', async (registration) => {
    mocks.findUser.mockResolvedValue(null);
    mocks.createUser.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({
      ...account(UserStatus.PENDING_VERIFICATION, {
        email: registration.email,
        role: registration.role,
        passwordChangedAt: new Date(),
      }),
      status: data.status,
      role: data.role,
    }));

    const result = await registerAccount(
      {
        ...registration,
        password: 'StrongPassword1',
        name: `Test ${registration.role}`,
      },
      request,
    );

    expect(result.approvalRequired).toBe(true);
    expect(result.user.role).toBe(registration.role);
    const createInput = mocks.createUser.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(createInput.data).not.toHaveProperty('studentId');
  });
});
