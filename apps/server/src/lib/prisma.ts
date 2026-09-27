import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

/**
 * Singleton PrismaClient with an explicitly sized connection pool.
 * Reused by the API process and the background worker (same process here).
 */
const logLevels =
  env.NODE_ENV === 'development' ? ('warn' as const) : ('error' as const);

export const prisma = new PrismaClient({
  log: [logLevels],
  datasources: { db: { url: env.DATABASE_URL } },
});

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
