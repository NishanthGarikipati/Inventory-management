import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { prisma } from './db/prisma.js';
import { startBackgroundJobs } from './jobs/scheduler.js';

const app = createApp();

const server = app.listen(config.port, '0.0.0.0', () => {
  logger.info({ port: config.port, env: config.env, aiProvider: config.aiProvider }, 'Dukaan API started');
});

const stopJobs = startBackgroundJobs();

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'shutting down');
  stopJobs();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
