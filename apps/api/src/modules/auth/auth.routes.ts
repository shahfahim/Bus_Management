import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncRoute } from '../../lib/async-route.js';
import { AppError } from '../../lib/errors.js';
import { readCookie, requireAuth } from './auth.middleware.js';
import { changePasswordSchema, loginSchema, registerSchema } from './auth.schemas.js';
import {
  changePassword,
  clearAuthCookies,
  getCurrentUser,
  login,
  registerStudent,
  revokeSession,
  rotateRefreshToken,
  setAuthCookies,
} from './auth.service.js';

export const authRouter = Router();

const authenticationLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many authentication attempts; please try again later' } },
});

const sessionLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many session refresh attempts; please try again later' } },
});

authRouter.post(
  '/register',
  authenticationLimiter,
  asyncRoute(async (request, response) => {
    const result = await registerStudent(registerSchema.parse(request.body), request);
    setAuthCookies(response, result);
    response.status(201).json(result);
  }),
);

authRouter.post(
  '/login',
  authenticationLimiter,
  asyncRoute(async (request, response) => {
    const result = await login(loginSchema.parse(request.body), request);
    setAuthCookies(response, result);
    response.json(result);
  }),
);

authRouter.post(
  '/refresh',
  sessionLimiter,
  asyncRoute(async (request, response) => {
    const token = readCookie(request, 'refresh_token');
    if (!token) throw new AppError(401, 'REFRESH_TOKEN_REQUIRED', 'No refresh token was supplied');
    const result = await rotateRefreshToken(token, request);
    setAuthCookies(response, result);
    response.json(result);
  }),
);

authRouter.post(
  '/logout',
  requireAuth,
  asyncRoute(async (request, response) => {
    await revokeSession(request.auth!.sessionId);
    clearAuthCookies(response);
    response.status(204).send();
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncRoute(async (request, response) => {
    response.json(await getCurrentUser(request.auth!.userId));
  }),
);

authRouter.post(
  '/change-password',
  requireAuth,
  authenticationLimiter,
  asyncRoute(async (request, response) => {
    response.json(
      await changePassword(
        request.auth!.userId,
        request.auth!.sessionId,
        changePasswordSchema.parse(request.body),
      ),
    );
  }),
);
