import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodSchema } from 'zod';

/** Wraps an async handler so rejected promises reach the error middleware. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export const validateBody =
  <T>(schema: ZodSchema<T>): RequestHandler =>
  (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) return next(result.error);
    req.body = result.data as never;
    next();
  };

export const validateQuery =
  <T>(schema: ZodSchema<T>): RequestHandler =>
  (req, _res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) return next(result.error);
    // Express 5 makes req.query a getter; assign to a side channel instead.
    (req as Request & { validQuery?: unknown }).validQuery = result.data;
    next();
  };

export function queryOf<T>(req: Request): T {
  return (req as Request & { validQuery?: T }).validQuery as T;
}
