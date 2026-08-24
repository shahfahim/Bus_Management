import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

declare global {
  var __busPrisma: PrismaClient | undefined;
}

const databaseUrl = new URL(env.DATABASE_URL);
if (!databaseUrl.searchParams.has('connection_limit')) {
  databaseUrl.searchParams.set('connection_limit', String(env.DATABASE_CONNECTION_LIMIT));
}
if (!databaseUrl.searchParams.has('pool_timeout')) {
  databaseUrl.searchParams.set('pool_timeout', String(env.DATABASE_POOL_TIMEOUT_SECONDS));
}

export const prisma =
  globalThis.__busPrisma ??
  new PrismaClient({
    datasources: { db: { url: databaseUrl.toString() } },
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (env.NODE_ENV !== 'production') globalThis.__busPrisma = prisma;
