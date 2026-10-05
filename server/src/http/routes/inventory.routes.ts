import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../middleware/validate.js';
import { authenticate, requirePermission, scopeOf } from '../middleware/auth.js';
import { idempotent } from '../middleware/idempotency.js';
import {
  createStockAdjustment,
  getInventoryItem,
  getStockLedger,
  listInventory,
  allocateBatchesFefo,
} from '../../services/inventory.service.js';
import { ADJUSTMENT_REASONS } from '../../domain/enums.js';
import { prisma } from '../../db/prisma.js';

export const inventoryRouter: Router = Router();

inventoryRouter.use(authenticate);

inventoryRouter.get(
  '/',
  requirePermission('inventory:read'),
  asyncHandler(async (req, res) => {
    const { search, categoryId, brandId, status, page, pageSize } = req.query;
    res.json(
      await listInventory(scopeOf(req), {
        search: typeof search === 'string' ? search : undefined,
        categoryId: typeof categoryId === 'string' ? categoryId : undefined,
        brandId: typeof brandId === 'string' ? brandId : undefined,
        status: typeof status === 'string' ? (status as never) : undefined,
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
      }),
    );
  }),
);

inventoryRouter.get(
  '/item/:variantId',
  requirePermission('inventory:read'),
  asyncHandler(async (req, res) => {
    res.json({ item: await getInventoryItem(scopeOf(req), req.params.variantId) });
  }),
);

inventoryRouter.get(
  '/ledger/:variantId',
  requirePermission('inventory:read'),
  asyncHandler(async (req, res) => {
    res.json({
      transactions: await getStockLedger(scopeOf(req), req.params.variantId, {
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      }),
    });
  }),
);

inventoryRouter.get(
  '/batches/:variantId',
  requirePermission('inventory:read'),
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const batches = await prisma.batch.findMany({
      where: { businessId: scope.businessId, variantId: req.params.variantId },
      orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }],
    });
    res.json({ batches });
  }),
);

inventoryRouter.get(
  '/fefo/:variantId',
  requirePermission('inventory:read'),
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const quantity = Number(req.query.quantity ?? 1);
    res.json({ picks: await allocateBatchesFefo(prisma, scope.businessId, req.params.variantId, quantity) });
  }),
);

inventoryRouter.post(
  '/adjustment',
  requirePermission('inventory:adjust'),
  idempotent('inventory.adjustment'),
  validateBody(
    z.object({
      reason: z.enum(ADJUSTMENT_REASONS),
      note: z.string().max(300).optional(),
      clientRequestId: z.string().optional(),
      lines: z
        .array(
          z.object({
            variantId: z.string(),
            quantityChange: z.number().optional(),
            countedQuantity: z.number().min(0).optional(),
            note: z.string().max(200).optional(),
          }),
        )
        .min(1, 'Add at least one product'),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createStockAdjustment(scopeOf(req), req.body));
  }),
);

inventoryRouter.get(
  '/adjustments',
  requirePermission('inventory:read'),
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    res.json({
      adjustments: await prisma.stockAdjustment.findMany({
        where: { businessId: scope.businessId },
        include: { items: { include: { variant: { include: { product: { select: { name: true } } } } } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    });
  }),
);

inventoryRouter.get(
  '/serials/:variantId',
  requirePermission('inventory:read'),
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    res.json({
      serials: await prisma.serialItem.findMany({
        where: { businessId: scope.businessId, variantId: req.params.variantId },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    });
  }),
);
