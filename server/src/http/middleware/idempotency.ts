import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../../db/prisma.js';

/**
 * Offline-first safety net: the mobile app stamps every queued mutation with a
 * client request id. Replaying the same id returns the original response
 * instead of creating a second sale/purchase/payment.
 */
export function idempotent(endpoint: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key =
      (req.header('Idempotency-Key') ||
        (req.body as { clientRequestId?: string } | undefined)?.clientRequestId) ??
      null;
    const businessId = req.scope?.businessId;
    if (!key || !businessId) return next();

    const existing = await prisma.idempotencyKey.findUnique({
      where: { businessId_key: { businessId, key } },
    });
    if (existing) {
      res.setHeader('Idempotent-Replay', 'true');
      res.status(200).json(JSON.parse(existing.responseJson));
      return;
    }

    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        void prisma.idempotencyKey
          .create({
            data: { businessId, key, endpoint, responseJson: JSON.stringify(body) },
          })
          .catch(() => {
            // A racing duplicate insert means another replay already stored it.
          });
      }
      return originalJson(body);
    };
    next();
  };
}
