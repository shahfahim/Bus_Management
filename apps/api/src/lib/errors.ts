import type { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { logger } from './logger.js';
import { normalizeRequestId } from './request-context.js';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFoundHandler: RequestHandler = (request, _response, next) => {
  next(new AppError(404, 'NOT_FOUND', `No route for ${request.method} ${request.path}`));
};

export const errorHandler: ErrorRequestHandler = (error: unknown, request, response, _next) => {
  const requestId = normalizeRequestId(request.id);
  let normalized: AppError;

  if (error instanceof AppError) {
    normalized = error;
  } else if (error instanceof ZodError) {
    normalized = new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', error.flatten());
  } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    normalized = new AppError(409, 'CONFLICT', 'A record with those values already exists', error.meta);
  } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
    normalized = new AppError(404, 'NOT_FOUND', 'The requested record does not exist');
  } else {
    normalized = new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  }

  const log = normalized.statusCode >= 500 ? logger.error.bind(logger) : logger.warn.bind(logger);
  log(
    {
      err: error,
      requestId,
      method: request.method,
      path: request.path,
      userId: request.auth?.userId,
    },
    normalized.message,
  );

  response.status(normalized.statusCode).json({
    error: {
      code: normalized.code,
      message: normalized.message,
      ...(normalized.details === undefined ? {} : { details: normalized.details }),
      requestId,
    },
  });
};
