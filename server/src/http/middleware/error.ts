import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { AppError } from '../../domain/errors.js';
import { logger } from '../../utils/logger.js';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'That page does not exist.' } });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res
      .status(err.status)
      .json({ error: { code: err.code, message: err.message, actions: err.actions, details: err.details } });
    return;
  }

  if (err instanceof ZodError) {
    const first = err.errors[0];
    res.status(422).json({
      error: {
        code: 'VALIDATION_FAILED',
        message: first ? `${humanField(first.path)}: ${first.message}` : 'Please check the details you entered.',
        details: err.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
      },
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = (err.meta?.target as string[] | string | undefined) ?? 'value';
      res.status(409).json({
        error: {
          code: 'DUPLICATE',
          message: `This ${humanTarget(target)} is already used. Please use a different one.`,
        },
      });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'That record was not found.' } });
      return;
    }
  }

  logger.error({ err }, 'unhandled error');
  res.status(500).json({
    error: { code: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' },
  });
}

function humanField(path: (string | number)[]): string {
  const field = String(path[path.length - 1] ?? 'value');
  return field.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

function humanTarget(target: string[] | string): string {
  const raw = Array.isArray(target) ? target[target.length - 1] : target;
  return String(raw).replace(/_/g, ' ').replace('businessId ', '');
}
