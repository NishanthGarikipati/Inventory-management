import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../middleware/validate.js';
import { authenticate, requirePermission, scopeOf } from '../middleware/auth.js';
import { idempotent } from '../middleware/idempotency.js';
import { cancelSale, createSale, getSale, listSales } from '../../services/sale.service.js';
import { PAYMENT_METHODS } from '../../domain/enums.js';
import { prisma } from '../../db/prisma.js';
import { notFound } from '../../domain/errors.js';

export const saleRouter: Router = Router();

saleRouter.use(authenticate);

const saleSchema = z.object({
  customerId: z.string().nullable().optional(),
  items: z
    .array(
      z.object({
        variantId: z.string(),
        quantity: z.number().positive('Quantity must be more than zero'),
        unitPricePaise: z.number().int().min(0).optional(),
        discountPaise: z.number().int().min(0).optional(),
        batchId: z.string().nullable().optional(),
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
    .default([]),
  channel: z.enum(['COUNTER', 'TAKEAWAY', 'DELIVERY', 'TABLE']).optional(),
  tableLabel: z.string().max(20).optional(),
  note: z.string().max(300).optional(),
  saleDate: z.coerce.date().optional(),
  clientRequestId: z.string().max(80).optional(),
});

saleRouter.post(
  '/',
  requirePermission('sale:create'),
  idempotent('sales.create'),
  validateBody(saleSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createSale(scopeOf(req), req.body));
  }),
);

saleRouter.get(
  '/',
  requirePermission('sale:read'),
  asyncHandler(async (req, res) => {
    const { from, to, customerId, status, page, pageSize } = req.query;
    res.json(
      await listSales(scopeOf(req), {
        from: from ? new Date(String(from)) : undefined,
        to: to ? new Date(String(to)) : undefined,
        customerId: typeof customerId === 'string' ? customerId : undefined,
        status: typeof status === 'string' ? status : undefined,
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
      }),
    );
  }),
);

saleRouter.get(
  '/:id',
  requirePermission('sale:read'),
  asyncHandler(async (req, res) => {
    res.json(await getSale(scopeOf(req), req.params.id));
  }),
);

saleRouter.get(
  '/:id/receipt',
  requirePermission('sale:read'),
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const invoice = await prisma.invoice.findFirst({
      where: { saleId: req.params.id, businessId: scope.businessId },
    });
    if (!invoice) throw notFound('Receipt');
    res.json({ number: invoice.number, receipt: JSON.parse(invoice.payload) });
  }),
);

saleRouter.post(
  '/:id/cancel',
  requirePermission('sale:cancel'),
  validateBody(z.object({ reason: z.string().min(2, 'Please say why this bill is cancelled') })),
  asyncHandler(async (req, res) => {
    res.json(await cancelSale(scopeOf(req), req.params.id, req.body.reason));
  }),
);
