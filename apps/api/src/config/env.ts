import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotEnv } from 'dotenv';
import { z } from 'zod';

for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
  if (existsSync(candidate)) {
    loadDotEnv({ path: candidate, quiet: true });
    break;
  }
}

const blankToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
    PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
    DATABASE_URL: z.string().min(1),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    QR_SIGNING_SECRET: z.string().min(32),
    ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().min(5).max(60).default(15),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    BOOKING_HOLD_MINUTES: z.coerce.number().int().min(5).max(60).default(15),
    STRIPE_SECRET_KEY: z.preprocess(blankToUndefined, z.string().min(1).optional()),
    STRIPE_WEBHOOK_SECRET: z.preprocess(blankToUndefined, z.string().min(1).optional()),
    STRIPE_CURRENCY: z.string().length(3).default('bdt'),
    VAPID_PUBLIC_KEY: z.preprocess(blankToUndefined, z.string().optional()),
    VAPID_PRIVATE_KEY: z.preprocess(blankToUndefined, z.string().optional()),
    VAPID_SUBJECT: z.string().default('mailto:transport@example.edu'),
    UPLOAD_DIR: z.string().default('uploads'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    SEED_ADMIN_EMAIL: z.string().email().default('admin@example.edu'),
    SEED_ADMIN_PASSWORD: z.string().min(10).default('ChangeMe123!'),
    SEED_DRIVER_PASSWORD: z.string().min(10).default('ChangeMe123!'),
    SEED_STUDENT_PASSWORD: z.string().min(10).default('ChangeMe123!'),
  })
  .superRefine((value, context) => {
    if ((value.STRIPE_SECRET_KEY && !value.STRIPE_WEBHOOK_SECRET) || (!value.STRIPE_SECRET_KEY && value.STRIPE_WEBHOOK_SECRET)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STRIPE_SECRET_KEY'],
        message: 'STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be configured together',
      });
    }
    if ((value.VAPID_PUBLIC_KEY && !value.VAPID_PRIVATE_KEY) || (!value.VAPID_PUBLIC_KEY && value.VAPID_PRIVATE_KEY)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['VAPID_PUBLIC_KEY'],
        message: 'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be configured together',
      });
    }
    if (new Set([value.JWT_ACCESS_SECRET, value.JWT_REFRESH_SECRET, value.QR_SIGNING_SECRET]).size !== 3) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_ACCESS_SECRET'],
        message: 'Access, refresh, and QR signing secrets must be distinct',
      });
    }
    if (value.NODE_ENV === 'production') {
      const insecure = ['ChangeMe', 'replace-with', 'CHANGE_THIS'];
      for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'QR_SIGNING_SECRET'] as const) {
        if (insecure.some((fragment) => value[key].includes(fragment))) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} must be rotated in production` });
        }
      }
      for (const key of ['SEED_ADMIN_PASSWORD', 'SEED_DRIVER_PASSWORD', 'SEED_STUDENT_PASSWORD'] as const) {
        if (insecure.some((fragment) => value[key].includes(fragment))) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} must not use a default value in production` });
        }
      }
      if (new Set([value.SEED_ADMIN_PASSWORD, value.SEED_DRIVER_PASSWORD, value.SEED_STUDENT_PASSWORD]).size !== 3) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SEED_ADMIN_PASSWORD'],
          message: 'Production seed accounts must use distinct passwords',
        });
      }
      for (const key of ['WEB_ORIGIN', 'PUBLIC_API_URL'] as const) {
        if (new URL(value[key]).protocol !== 'https:') {
          context.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} must use HTTPS in production` });
        }
      }
    }
  });

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  throw new Error(`Invalid environment configuration: ${details}`);
}

export const env = parsed.data;
