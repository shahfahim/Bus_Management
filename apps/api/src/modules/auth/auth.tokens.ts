import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';

export interface AccessClaims {
  sub: string;
  role: Role;
  sid: string;
  type: 'access';
  exp?: number;
}

export interface RefreshClaims {
  sub: string;
  role: Role;
  sid: string;
  type: 'refresh';
  jti?: string;
  exp?: number;
}

export const signAccessToken = (claims: Omit<AccessClaims, 'type'>): string =>
  jwt.sign({ ...claims, type: 'access' }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.ACCESS_TOKEN_TTL_MINUTES * 60,
    issuer: 'university-bus-api',
    audience: 'university-bus-web',
  });

export const signRefreshToken = (claims: Omit<RefreshClaims, 'type'>): string =>
  jwt.sign({ ...claims, type: 'refresh' }, env.JWT_REFRESH_SECRET, {
    algorithm: 'HS256',
    jwtid: randomUUID(),
    expiresIn: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
    issuer: 'university-bus-api',
    audience: 'university-bus-web',
  });

const verify = <T extends AccessClaims | RefreshClaims>(token: string, secret: string, type: T['type']): T => {
  try {
    const decoded = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      issuer: 'university-bus-api',
      audience: 'university-bus-web',
    });
    if (typeof decoded === 'string' || decoded.type !== type || !decoded.sub || !decoded.sid || !decoded.role) {
      throw new Error('Invalid token claims');
    }
    return decoded as unknown as T;
  } catch {
    throw new AppError(401, 'INVALID_TOKEN', 'The authentication token is invalid or expired');
  }
};

export const verifyAccessToken = (token: string): AccessClaims =>
  verify<AccessClaims>(token, env.JWT_ACCESS_SECRET, 'access');

export const verifyRefreshToken = (token: string): RefreshClaims =>
  verify<RefreshClaims>(token, env.JWT_REFRESH_SECRET, 'refresh');
