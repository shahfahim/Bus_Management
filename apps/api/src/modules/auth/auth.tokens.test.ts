import { Role } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../lib/errors.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from './auth.tokens.js';

describe('authentication tokens', () => {
  const claims = { sub: 'user-1', role: Role.STUDENT, sid: 'session-1' };

  it('round-trips an access token with its session and role', () => {
    const token = signAccessToken(claims);
    expect(verifyAccessToken(token)).toMatchObject({ ...claims, type: 'access' });
  });

  it('does not accept a refresh token as an access token', () => {
    const token = signRefreshToken(claims);
    expect(() => verifyAccessToken(token)).toThrow(AppError);
    expect(verifyRefreshToken(token)).toMatchObject({ ...claims, type: 'refresh' });
  });

  it('issues a unique refresh token for every rotation', () => {
    const first = signRefreshToken(claims);
    const second = signRefreshToken(claims);
    expect(first).not.toBe(second);
    expect(verifyRefreshToken(first).jti).toBeTruthy();
    expect(verifyRefreshToken(second).jti).toBeTruthy();
  });

  it('rejects a modified signature', () => {
    const token = signAccessToken(claims);
    expect(() => verifyAccessToken(`${token.slice(0, -1)}x`)).toThrowError(/invalid or expired/);
  });
});
