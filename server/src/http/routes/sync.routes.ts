import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../middleware/validate.js';
import { authenticate, scopeOf } from '../middleware/auth.js';
import { prisma } from '../../db/prisma.js';
import { roundQty } from '../../domain/money.js';
import { createSale } from '../../services/sale.service.js';
import { createPurchase } from '../../services/purchase.service.js';
import { createStockAdjustment } from '../../services/inventory.service.js';
import { recordCustomerPayment, recordSupplierPayment } from '../../services/party.service.js';
import { createExpense } from '../../services/expense.service.js';
import { AppError } from '../../domain/errors.js';
import { roleHasPermission } from '../../domain/permissions.js';
import type { UserRole } from '../../domain/enums.js';

export const syncRouter: Router = Router();

syncRouter.use(authenticate);

/**
 * Pull: everything the phone needs to sell without a network. Only rows that
 * changed since the client's last sync are returned, so a catalogue of 100k
 * products syncs once and then trickles.
 */
syncRouter.get(
  '/pull',
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const since = req.query.since ? new Date(String(req.query.since)) : new Date(0);
    const changedSince = { gte: since };

    const [products, inventory, customers, suppliers, taxes, units, settings, business] = await Promise.all([
      prisma.product.findMany({
        where: { businessId: scope.businessId, updatedAt: changedSince },
        include: { variants: true, category: { select: { name: true } }, unit: true, tax: true },
        take: 2000,
      }),
      prisma.inventory.findMany({
        where: { businessId: scope.businessId, updatedAt: changedSince },
        select: { variantId: true, quantity: true, avgCostPaise: true, updatedAt: true },
        take: 5000,
      }),
      prisma.customer.findMany({ where: { businessId: scope.businessId, updatedAt: changedSince }, take: 2000 }),
      prisma.supplier.findMany({ where: { businessId: scope.businessId, updatedAt: changedSince }, take: 2000 }),
      prisma.tax.findMany({ where: { businessId: scope.businessId } }),
      prisma.unit.findMany({ where: { businessId: scope.businessId } }),
      prisma.businessSettings.findUnique({ where: { businessId: scope.businessId } }),
      prisma.business.findUnique({ where: { id: scope.businessId } }),
    ]);

    res.json({
      syncedAt: new Date().toISOString(),
      business,
      settings,
      taxes,
      units,
      customers,
      suppliers,
      inventory: inventory.map((row) => ({ ...row, quantity: roundQty(row.quantity) })),
      products: products.map((product) => ({
        id: product.id,
        name: product.name,
        category: product.category?.name ?? null,
        unit: product.unit.code,
        allowDecimal: product.unit.allowDecimal,
        taxRate: product.tax?.rate ?? 0,
        trackBatch: product.trackBatch,
        trackSerial: product.trackSerial,
        isComposite: product.isComposite,
        isActive: product.isActive,
        variants: product.variants.map((variant) => ({
          id: variant.id,
          name: variant.name,
          sku: variant.sku,
          barcode: variant.barcode,
          isDefault: variant.isDefault,
          sellingPricePaise: variant.sellingPricePaise,
          purchasePricePaise: variant.purchasePricePaise,
          mrpPaise: variant.mrpPaise,
          minStock: variant.minStock,
        })),
      })),
    });
  }),
);

const operationSchema = z.object({
  clientRequestId: z.string().min(4).max(80),
  type: z.enum(['SALE', 'PURCHASE', 'ADJUSTMENT', 'CUSTOMER_PAYMENT', 'SUPPLIER_PAYMENT', 'EXPENSE']),
  payload: z.record(z.unknown()),
  queuedAt: z.string().optional(),
});

const PERMISSION_BY_TYPE = {
  SALE: 'sale:create',
  PURCHASE: 'purchase:write',
  ADJUSTMENT: 'inventory:adjust',
  CUSTOMER_PAYMENT: 'payment:create',
  SUPPLIER_PAYMENT: 'payment:create',
  EXPENSE: 'expense:write',
} as const;

/**
 * Push: replays the queue the phone built while offline. Each operation
 * carries a client request id, so a partially delivered batch can be sent
 * again safely - a transaction is never lost, and never applied twice.
 */
syncRouter.post(
  '/push',
  validateBody(z.object({ operations: z.array(operationSchema).min(1).max(100) })),
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const results = [];
    const operations = req.body.operations as Array<z.infer<typeof operationSchema>>;

    for (const operation of operations) {
      const existing = await prisma.idempotencyKey.findUnique({
        where: { businessId_key: { businessId: scope.businessId, key: operation.clientRequestId } },
      });
      if (existing) {
        results.push({
          clientRequestId: operation.clientRequestId,
          status: 'DUPLICATE' as const,
          result: JSON.parse(existing.responseJson),
        });
        continue;
      }

      if (!roleHasPermission(scope.role as UserRole, PERMISSION_BY_TYPE[operation.type])) {
        results.push({
          clientRequestId: operation.clientRequestId,
          status: 'FAILED' as const,
          error: { code: 'FORBIDDEN', message: 'Your role cannot do this.' },
        });
        continue;
      }

      try {
        const payload = { ...operation.payload, clientRequestId: operation.clientRequestId, source: 'OFFLINE_SYNC' };
        const result = await applyOperation(scope, operation.type, payload);
        await prisma.idempotencyKey.create({
          data: {
            businessId: scope.businessId,
            key: operation.clientRequestId,
            endpoint: `sync.${operation.type.toLowerCase()}`,
            responseJson: JSON.stringify(result),
            entityType: operation.type,
            entityId: (result as { id?: string }).id ?? null,
          },
        });
        results.push({ clientRequestId: operation.clientRequestId, status: 'APPLIED' as const, result });
      } catch (error) {
        const appError = error instanceof AppError ? error : null;
        results.push({
          clientRequestId: operation.clientRequestId,
          status: 'FAILED' as const,
          error: {
            code: appError?.code ?? 'SERVER_ERROR',
            message: appError?.message ?? 'We could not save this. Please check and try again.',
            actions: appError?.actions ?? [],
          },
        });
      }
    }

    res.json({
      syncedAt: new Date().toISOString(),
      applied: results.filter((r) => r.status === 'APPLIED').length,
      duplicates: results.filter((r) => r.status === 'DUPLICATE').length,
      failed: results.filter((r) => r.status === 'FAILED').length,
      results,
    });
  }),
);

async function applyOperation(
  scope: ReturnType<typeof scopeOf>,
  type: z.infer<typeof operationSchema>['type'],
  payload: Record<string, unknown>,
) {
  switch (type) {
    case 'SALE':
      return createSale(scope, payload as never);
    case 'PURCHASE':
      return createPurchase(scope, payload as never);
    case 'ADJUSTMENT':
      return createStockAdjustment(scope, payload as never);
    case 'CUSTOMER_PAYMENT':
      return recordCustomerPayment(scope, payload as never);
    case 'SUPPLIER_PAYMENT':
      return recordSupplierPayment(scope, payload as never);
    case 'EXPENSE':
      return createExpense(scope, payload as never);
    default:
      throw new AppError(400, 'UNKNOWN_OPERATION', 'This action could not be synced.');
  }
}
