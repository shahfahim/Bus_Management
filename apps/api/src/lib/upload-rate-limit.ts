import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

export const uploadRateLimit = rateLimit({
  windowMs: 60 * 60_000,
  limit: 10,
  keyGenerator: (request) => request.auth?.userId ?? ipKeyGenerator(request.ip ?? 'unknown'),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    error: {
      code: 'UPLOAD_RATE_LIMITED',
      message: 'Too many file uploads; please try again later',
    },
  },
});
