import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

declare global {
  var __busPrisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__busPrisma ??
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (env.NODE_ENV !== 'production') globalThis.__busPrisma = prisma;
