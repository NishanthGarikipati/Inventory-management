import { PrismaClient, Prisma } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG === 'query' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;

/**
 * SQLite serialises writes, so a long-running transaction can trip the default
 * 5s limit when several POS terminals sync at once. 15s keeps offline batch
 * replays comfortable without masking real deadlocks.
 */
export const txOptions = { timeout: 15_000, maxWait: 10_000 };
