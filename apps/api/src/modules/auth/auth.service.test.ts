import { Role, UserStatus } from '@prisma/client';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  comparePassword: vi.fn(),
  findUser: vi.fn(),
  updateUser: vi.fn(),
  createSession: vi.fn(),
  updateSession: vi.fn(),
}));

vi.mock('bcryptjs', () => ({
  default: {
    compare: mocks.comparePassword,
    hash: vi.fn(),
  },
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: mocks.findUser,
      update: mocks.updateUser,
    },
    session: {
      create: mocks.createSession,
      update: mocks.updateSession,
    },
  },
}));

import { login } from './auth.service.js';

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
    'records a brute-force lockout without replacing a %s status',
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
      expect(update.data.lockedUntil).toBeInstanceOf(Date);
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
