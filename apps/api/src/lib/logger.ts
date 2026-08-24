import pino, { type DestinationStream, type LoggerOptions } from 'pino';
import { env } from '../config/env.js';

const options: LoggerOptions = {
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'password',
      '*.password',
      'token',
      '*.token',
      'accessToken',
      'refreshToken',
    ],
    censor: '[REDACTED]',
  },
};

export const createLogger = (destination?: DestinationStream) => pino(options, destination);

export const logger = createLogger();
