import cookieParser from 'cookie-parser';
import express, { type Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, errorHandler } from '../../lib/errors.js';

const mocks = vi.hoisted(() => ({
  registerAccount: vi.fn(),
  login: vi.fn(),
  rotateRefreshToken: vi.fn(),
}));

vi.mock('./auth.service.js', () => ({
  registerAccount: mocks.registerAccount,
  login: mocks.login,
  rotateRefreshToken: mocks.rotateRefreshToken,
  setAuthCookies: (response: Response, tokens: { accessToken: string; refreshToken: string }) => {
    response.cookie('access_token', tokens.accessToken, { httpOnly: true, path: '/' });
    response.cookie('refresh_token', tokens.refreshToken, { httpOnly: true, path: '/api' });
  },
  clearAuthCookies: vi.fn(),
  revokeSession: vi.fn(),
  getCurrentUser: vi.fn(),
  changePassword: vi.fn(),
}));

vi.mock('./auth.middleware.js', () => ({
  readCookie: (request: express.Request, name: string) => {
    const cookies = request.cookies as Record<string, unknown> | undefined;
    return typeof cookies?.[name] === 'string' ? cookies[name] : undefined;
  },
  requireAuth: vi.fn(),
  requireRole: vi.fn(() => vi.fn()),
}));

import { authRouter } from './auth.routes.js';

const user = { id: 'user-1', email: 'student@baust.edu.bd', role: 'STUDENT', status: 'ACTIVE' };
const tokens = { accessToken: 'access-secret', refreshToken: 'refresh-secret', expiresIn: 900 };

const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/auth', authRouter);
  app.use(errorHandler);
  return app;
};

describe('authentication response credential isolation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps login tokens in HttpOnly cookies and out of the JSON body', async () => {
    mocks.login.mockResolvedValue({ user, ...tokens });

    const response = await request(createTestApp())
      .post('/auth/login')
      .send({ email: user.email, password: 'StrongPassword1' })
      .expect(200);

    expect(response.body).toEqual({ user, expiresIn: 900 });
    expect(JSON.stringify(response.body)).not.toContain('access-secret');
    expect(JSON.stringify(response.body)).not.toContain('refresh-secret');
    expect(response.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('HttpOnly')]),
    );
  });

  it('does not return rotated tokens from refresh', async () => {
    mocks.rotateRefreshToken.mockResolvedValue(tokens);

    const response = await request(createTestApp())
      .post('/auth/refresh')
      .set('Cookie', 'refresh_token=old-refresh-token')
      .expect(200);

    expect(response.body).toEqual({ expiresIn: 900 });
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });

  it('throttles repeated failures without setting a global account lock', async () => {
    mocks.login.mockRejectedValue(new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect'));
    const app = createTestApp();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app)
        .post('/auth/login')
        .send({ email: 'rate-limited@baust.edu.bd', password: 'WrongPassword1' })
        .expect(401);
    }
    const response = await request(app)
      .post('/auth/login')
      .send({ email: 'rate-limited@baust.edu.bd', password: 'WrongPassword1' })
      .expect(429);

    expect((response.body as unknown as { error: { code: string } }).error.code).toBe('RATE_LIMITED');
  });
});
