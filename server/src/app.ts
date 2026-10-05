import fs from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { apiRouter } from './http/routes/index.js';
import { errorHandler, notFoundHandler } from './http/middleware/error.js';

const mobileDist = path.resolve(process.cwd(), '../mobile/dist');

export function createApp(): Express {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  if (process.env.NODE_ENV !== 'test') {
    app.use(pinoHttp({ logger }));
  }

  // Brute-force protection on the PIN screen; the rest of the API is
  // authenticated and used heavily during billing, so it stays unthrottled.
  app.use(
    '/api/auth/login',
    rateLimit({
      windowMs: 15 * 60_000,
      limit: config.loginAttemptsPerWindow,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  app.use(
    '/api/auth/register',
    rateLimit({
      windowMs: 60 * 60_000,
      limit: config.registrationsPerHour,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  app.use('/api', apiRouter);

  if (fs.existsSync(path.join(mobileDist, 'index.html'))) {
    app.use(express.static(mobileDist, { index: false, maxAge: '1h' }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path === '/health') return next();
      res.sendFile(path.join(mobileDist, 'index.html'), (error) => {
        if (error) next(error);
      });
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
