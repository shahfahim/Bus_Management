import type { Request, RequestHandler } from 'express';
import { UserStatus } from '@prisma/client';
import type { Role } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { verifyAccessToken } from './auth.tokens.js';

const readBearer = (authorization: string | undefined): string | undefined => {
  if (!authorization) return undefined;
  const [scheme, token] = authorization.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
};

export const readCookie = (request: Request, name: string): string | undefined => {
  const cookies: unknown = request.cookies;
  if (!cookies || typeof cookies !== 'object') return undefined;
  const value = (cookies as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : undefined;
};

const authenticate = async (token: string) => {
  const claims = verifyAccessToken(token);
  const session = await prisma.session.findFirst({
    where: {
      id: claims.sid,
      userId: claims.sub,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      user: { status: UserStatus.ACTIVE, deletedAt: null },
    },
    select: { user: { select: { role: true, passwordChangedAt: true } } },
  });
  if (!session || session.user.role !== claims.role) {
    throw new AppError(401, 'SESSION_REVOKED', 'This session is no longer active');
  }
  return {
    auth: { userId: claims.sub, role: session.user.role, sessionId: claims.sid },
    mustChangePassword: session.user.passwordChangedAt === null,
  };
};

const permitsTemporaryPassword = (request: Request): boolean =>
  /\/auth\/(?:me|logout|change-password)$/.test(request.originalUrl.split('?')[0] ?? '');

export const optionalAuth: RequestHandler = async (request, _response, next) => {
  const token = readBearer(request.headers.authorization) ?? readCookie(request, 'access_token');
  if (!token) return next();

  try {
    const result = await authenticate(token);
    if (!result.mustChangePassword || permitsTemporaryPassword(request)) request.auth = result.auth;
    next();
  } catch {
    next();
  }
};

export const requireAuth: RequestHandler = async (request, _response, next) => {
  const token = readBearer(request.headers.authorization) ?? readCookie(request, 'access_token');
  if (!token) return next(new AppError(401, 'AUTHENTICATION_REQUIRED', 'Please sign in to continue'));

  try {
    const result = await authenticate(token);
    if (result.mustChangePassword && !permitsTemporaryPassword(request)) {
      throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Change the temporary password before continuing');
    }
    request.auth = result.auth;
    next();
  } catch (error) {
    next(error);
  }
};

export const requireRole = (...roles: Role[]): RequestHandler => (request, _response, next) => {
  if (!request.auth) return next(new AppError(401, 'AUTHENTICATION_REQUIRED', 'Please sign in to continue'));
  if (!roles.includes(request.auth.role)) {
    return next(new AppError(403, 'FORBIDDEN', 'You are not permitted to perform this action'));
  }
  next();
};
