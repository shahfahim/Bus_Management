import { timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { DriverStatus, Role, UserStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { normalizeEmail, randomToken, sha256 } from '../../lib/security.js';
import { disconnectSessionSockets } from '../../realtime/hub.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from './auth.tokens.js';
import type { z } from 'zod';
import type { changePasswordSchema, loginSchema, registerSchema } from './auth.schemas.js';

type RegisterInput = z.infer<typeof registerSchema>;
type LoginInput = z.infer<typeof loginSchema>;
type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

const publicUserSelect = {
  id: true,
  email: true,
  name: true,
  phone: true,
  role: true,
  status: true,
  avatarUrl: true,
  passwordChangedAt: true,
  studentProfile: true,
  driverProfile: true,
  createdAt: true,
} as const;

type PublicUser = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;

const serializeUser = (user: PublicUser) => {
  const { passwordChangedAt, ...safeUser } = user;
  return {
    ...safeUser,
    mustChangePassword: passwordChangedAt === null,
    studentId: user.studentProfile?.studentNumber,
    department: user.studentProfile?.department,
    employeeNumber: user.driverProfile?.employeeNumber,
    averageRating: user.driverProfile?.averageRating === undefined ? undefined : Number(user.driverProfile.averageRating),
  };
};

const sessionExpiry = (): Date => new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
const DUMMY_PASSWORD_HASH = '$2b$12$LRBfmRO2W4.66pD3ULAtaelYuDvUB01T5S8pAPdjpW2iiE55bC8eG';

const safeEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

const issueSession = async (user: { id: string; role: Role }, request: Request) => {
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: sha256(randomToken()),
      userAgent: request.get('user-agent')?.slice(0, 500),
      ipAddress: request.ip,
      expiresAt: sessionExpiry(),
    },
  });
  const accessToken = signAccessToken({ sub: user.id, role: user.role, sid: session.id });
  const refreshToken = signRefreshToken({ sub: user.id, role: user.role, sid: session.id });
  await prisma.session.update({ where: { id: session.id }, data: { refreshTokenHash: sha256(refreshToken) } });
  return { accessToken, refreshToken, expiresIn: env.ACCESS_TOKEN_TTL_MINUTES * 60 };
};

export const setAuthCookies = (response: Response, tokens: { accessToken: string; refreshToken: string }): void => {
  const common = {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
  };
  response.cookie('access_token', tokens.accessToken, {
    ...common,
    maxAge: env.ACCESS_TOKEN_TTL_MINUTES * 60_000,
    path: '/',
  });
  response.cookie('refresh_token', tokens.refreshToken, {
    ...common,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
    path: '/api',
  });
};

export const clearAuthCookies = (response: Response): void => {
  response.clearCookie('access_token', { path: '/' });
  response.clearCookie('refresh_token', { path: '/api' });
};

export const registerAccount = async (input: RegisterInput, request: Request, documentUrl?: string) => {
  const email = normalizeEmail(input.email);
  const passwordHash = await bcrypt.hash(input.password, 12);

  const user = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new AppError(409, 'EMAIL_IN_USE', 'An account already exists for that email');

    return tx.user.create({
      data: {
        email,
        passwordHash,
        passwordChangedAt: new Date(),
        name: input.name,
        phone: input.phone,
        role: input.role,
        status: UserStatus.PENDING_VERIFICATION,
        emailVerifiedAt: null,
        studentProfile: input.role === Role.STUDENT
          ? {
              create: {
                studentNumber: input.studentId,
                department: input.department,
                verificationDocumentUrl: documentUrl,
                emergencyContact: input.emergencyContact,
              },
            }
          : undefined,
      },
      select: publicUserSelect,
    });
  });

  return { user: serializeUser(user), approvalRequired: true as const };
};

export const login = async (input: LoginInput, request: Request) => {
  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(input.email) },
    select: { ...publicUserSelect, passwordHash: true, failedLoginAttempts: true, lockedUntil: true },
  });
  const valid = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || !valid) {
    if (user) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: Math.min(user.failedLoginAttempts + 1, 1_000_000),
        },
      });
    }
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(429, 'ACCOUNT_LOCKED', 'Too many failed login attempts. Please try again later.');
  }
  if (user.status === UserStatus.PENDING_VERIFICATION) {
    throw new AppError(403, 'ACCOUNT_PENDING_VERIFICATION', 'Your account is pending verification by an administrator');
  }
  if (user.status !== UserStatus.ACTIVE) {
    throw new AppError(403, 'ACCOUNT_DISABLED', 'This account is not active');
  }

  const safeUser: PublicUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    role: user.role,
    status: user.status,
    avatarUrl: user.avatarUrl,
    passwordChangedAt: user.passwordChangedAt,
    studentProfile: user.studentProfile,
    driverProfile: user.driverProfile,
    createdAt: user.createdAt,
  };
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  const tokens = await issueSession(user, request);
  return { user: serializeUser(safeUser), ...tokens };
};

export const rotateRefreshToken = async (token: string, request: Request) => {
  const claims = verifyRefreshToken(token);
  const session = await prisma.session.findUnique({ where: { id: claims.sid }, include: { user: true } });
  const suppliedHash = sha256(token);

  if (
    !session ||
    session.userId !== claims.sub ||
    session.revokedAt ||
    session.expiresAt <= new Date() ||
    !safeEqual(session.refreshTokenHash, suppliedHash)
  ) {
    if (session && !session.revokedAt) {
      await prisma.session.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: new Date() } });
      disconnectSessionSockets(session.id);
    }
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'The session is invalid or has expired');
  }
  if (session.user.status !== UserStatus.ACTIVE) {
    throw new AppError(403, 'ACCOUNT_DISABLED', 'This account is not active');
  }

  const accessToken = signAccessToken({ sub: session.userId, role: session.user.role, sid: session.id });
  const refreshToken = signRefreshToken({ sub: session.userId, role: session.user.role, sid: session.id });
  const updated = await prisma.session.updateMany({
    where: { id: session.id, refreshTokenHash: suppliedHash, revokedAt: null },
    data: {
      refreshTokenHash: sha256(refreshToken),
      expiresAt: sessionExpiry(),
      userAgent: request.get('user-agent')?.slice(0, 500),
      ipAddress: request.ip,
    },
  });
  if (updated.count !== 1) {
    await prisma.session.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: new Date() } });
    disconnectSessionSockets(session.id);
    throw new AppError(401, 'TOKEN_REUSE', 'Refresh-token reuse was detected; the session was revoked');
  }

  return { accessToken, refreshToken, expiresIn: env.ACCESS_TOKEN_TTL_MINUTES * 60 };
};

export const revokeSession = async (sessionId: string): Promise<void> => {
  await prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  disconnectSessionSockets(sessionId);
};

export const getCurrentUser = async (userId: string) =>
  serializeUser(await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: publicUserSelect }));

export const changePassword = async (
  userId: string,
  currentSessionId: string,
  input: ChangePasswordInput,
) => {
  const nextPasswordHash = await bcrypt.hash(input.newPassword, 12);
  const revokedSessionIds = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'password:' + userId}))`;
    const user = await tx.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!user || !(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
      throw new AppError(401, 'INVALID_CURRENT_PASSWORD', 'The current password is incorrect');
    }
    if (await bcrypt.compare(input.newPassword, user.passwordHash)) {
      throw new AppError(409, 'PASSWORD_REUSED', 'The new password must be different from the current password');
    }
    await tx.user.update({
      where: { id: userId },
      data: {
        passwordHash: nextPasswordHash,
        passwordChangedAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    const otherSessions = await tx.session.findMany({
      where: { userId, id: { not: currentSessionId }, revokedAt: null },
      select: { id: true },
    });
    if (otherSessions.length) {
      await tx.session.updateMany({
        where: { id: { in: otherSessions.map(({ id }) => id) } },
        data: { revokedAt: new Date() },
      });
    }
    return otherSessions.map(({ id }) => id);
  });
  revokedSessionIds.forEach(disconnectSessionSockets);
  return getCurrentUser(userId);
};
