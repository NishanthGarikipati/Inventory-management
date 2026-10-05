import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../middleware/validate.js';
import { authenticate, requirePermission, scopeOf } from '../middleware/auth.js';
import { idempotent } from '../middleware/idempotency.js';
import { cancelPurchase, createPurchase, getPurchase, listPurchases } from '../../services/purchase.service.js';
import { PAYMENT_METHODS } from '../../domain/enums.js';

export const purchaseRouter: Router = Router();

purchaseRouter.use(authenticate);

const purchaseSchema = z.object({
  supplierId: z.string().nullable().optional(),
  invoiceNumber: z.string().max(60).nullable().optional(),
  purchaseDate: z.coerce.date().optional(),
  items: z
    .array(
      z.object({
        variantId: z.string(),
        quantity: z.number().positive('Quantity must be more than zero'),
        unitCostPaise: z.number().int().min(0),
        discountPaise: z.number().int().min(0).optional(),
        taxRate: z.number().min(0).max(100).optional(),
        batchNumber: z.string().max(40).nullable().optional(),
        expiryDate: z.coerce.date().nullable().optional(),
        mrpPaise: z.number().int().min(0).nullable().optional(),
        updateSellingPricePaise: z.number().int().min(0).nullable().optional(),
        serials: z.array(z.string()).optional(),
      }),
    )
    .min(1, 'Add at least one product'),
  discountPaise: z.number().int().min(0).optional(),
  payments: z
    .array(
      z.object({
        method: z.enum(PAYMENT_METHODS),
        amountPaise: z.number().int().min(0),
        reference: z.string().max(60).optional(),
      }),
    )
    .optional(),
  note: z.string().max(300).optional(),
  clientRequestId: z.string().max(80).optional(),
});

purchaseRouter.post(
  '/',
  requirePermission('purchase:write'),
  idempotent('purchases.create'),
  validateBody(purchaseSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createPurchase(scopeOf(req), req.body));
  }),
);

purchaseRouter.get(
  '/',
  requirePermission('purchase:read'),
  asyncHandler(async (req, res) => {
    const { from, to, supplierId, page, pageSize } = req.query;
    res.json(
      await listPurchases(scopeOf(req), {
        from: from ? new Date(String(from)) : undefined,
        to: to ? new Date(String(to)) : undefined,
        supplierId: typeof supplierId === 'string' ? supplierId : undefined,
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
      }),
    );
  }),
);

purchaseRouter.get(
  '/:id',
  requirePermission('purchase:read'),
  asyncHandler(async (req, res) => {
    res.json(await getPurchase(scopeOf(req), req.params.id));
  }),
);

purchaseRouter.post(
  '/:id/cancel',
  requirePermission('purchase:write'),
  validateBody(z.object({ reason: z.string().min(2) })),
  asyncHandler(async (req, res) => {
    res.json(await cancelPurchase(scopeOf(req), req.params.id, req.body.reason));
  }),
);
