import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../middleware/validate.js';
import { authenticate, requirePermission, scopeOf } from '../middleware/auth.js';
import { idempotent } from '../middleware/idempotency.js';
import {
  createPurchaseReturn,
  createSalesReturn,
  listPurchaseReturns,
  listSalesReturns,
} from '../../services/returns.service.js';

export const returnsRouter: Router = Router();

returnsRouter.use(authenticate);

returnsRouter.post(
  '/sales',
  requirePermission('sale:return'),
  idempotent('returns.sales'),
  validateBody(
    z.object({
      saleId: z.string().optional(),
      customerId: z.string().optional(),
      reason: z.string().min(2, 'Please choose a reason'),
      refundMethod: z.enum(['CASH', 'UPI', 'CARD', 'CREDIT_NOTE', 'ADJUST_DUE']).optional(),
      items: z
        .array(
          z.object({
            saleItemId: z.string().optional(),
            variantId: z.string().optional(),
            quantity: z.number().positive(),
            unitPricePaise: z.number().int().min(0).optional(),
            restock: z.boolean().optional(),
          }),
        )
        .min(1),
      clientRequestId: z.string().max(80).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createSalesReturn(scopeOf(req), req.body));
  }),
);

returnsRouter.get(
  '/sales',
  requirePermission('sale:read'),
  asyncHandler(async (req, res) => {
    res.json({ returns: await listSalesReturns(scopeOf(req), {}) });
  }),
);

returnsRouter.post(
  '/purchases',
  requirePermission('purchase:return'),
  idempotent('returns.purchases'),
  validateBody(
    z.object({
      purchaseId: z.string().optional(),
      supplierId: z.string().optional(),
      reason: z.string().min(2, 'Please choose a reason'),
      settlement: z.enum(['ADJUST_DUE', 'CASH_REFUND']).optional(),
      items: z
        .array(
          z.object({
            purchaseItemId: z.string().optional(),
            variantId: z.string().optional(),
            quantity: z.number().positive(),
            unitCostPaise: z.number().int().min(0).optional(),
          }),
        )
        .min(1),
      clientRequestId: z.string().max(80).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createPurchaseReturn(scopeOf(req), req.body));
  }),
);

returnsRouter.get(
  '/purchases',
  requirePermission('purchase:read'),
  asyncHandler(async (req, res) => {
    res.json({ returns: await listPurchaseReturns(scopeOf(req), {}) });
  }),
);
