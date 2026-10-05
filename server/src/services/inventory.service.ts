import type { Db, Tx } from '../db/prisma.js';
import { prisma, txOptions } from '../db/prisma.js';
import type { TenantScope } from '../db/tenant.js';
import { insufficientStock, notFound, badRequest } from '../domain/errors.js';
import type { AdjustmentReason, InventoryTransactionType, TransactionSource } from '../domain/enums.js';
import { nextAverageCost, roundQty } from '../domain/money.js';
import { recordAudit } from './audit.service.js';

export interface StockMovement {
  variantId: string;
  /** Signed: positive adds stock, negative removes it. */
  quantity: number;
  type: InventoryTransactionType;
  unitCostPaise?: number;
  referenceType?: string;
  referenceId?: string;
  source?: TransactionSource;
  note?: string;
  batchId?: string | null;
  /** Physical counts set the absolute level instead of a delta. */
  allowNegative?: boolean;
}

export interface MovementResult {
  transactionId: string;
  variantId: string;
  previousStock: number;
  newStock: number;
  /** Cost of goods for outgoing movements (moving average at the time). */
  cogsPaise: number;
  avgCostPaise: number;
}

/** Movement types that may raise the moving average cost. */
const INBOUND_COSTED: InventoryTransactionType[] = ['OPENING', 'PURCHASE', 'PRODUCTION', 'IMAGE_SCAN_ADJUSTMENT'];

/**
 * The single writer for stock. Nothing anywhere else in the codebase is
 * allowed to touch `Inventory.quantity`: stock only ever moves together with
 * an `InventoryTransaction` row describing why, by whom and from what source.
 */
export async function applyStockMovement(
  tx: Tx,
  scope: TenantScope,
  movement: StockMovement,
  options: { allowNegativeStock?: boolean } = {},
): Promise<MovementResult> {
  const quantity = roundQty(movement.quantity);
  if (quantity === 0) throw badRequest('Quantity cannot be zero.');

  const variant = await tx.productVariant.findFirst({
    where: { id: movement.variantId, businessId: scope.businessId },
    include: { product: { select: { name: true } }, inventory: true },
  });
  if (!variant) throw notFound('Product');

  const inventory =
    variant.inventory ??
    (await tx.inventory.create({
      data: { businessId: scope.businessId, variantId: variant.id, quantity: 0, avgCostPaise: variant.purchasePricePaise },
    }));

  const previousStock = roundQty(inventory.quantity);
  const newStock = roundQty(previousStock + quantity);

  const negativeAllowed = movement.allowNegative ?? options.allowNegativeStock ?? false;
  if (quantity < 0 && newStock < 0 && !negativeAllowed) {
    throw insufficientStock(variant.product.name, previousStock, Math.abs(quantity));
  }

  let avgCostPaise = inventory.avgCostPaise;
  let cogsPaise = 0;

  if (quantity > 0 && INBOUND_COSTED.includes(movement.type) && movement.unitCostPaise !== undefined) {
    avgCostPaise = nextAverageCost(previousStock, inventory.avgCostPaise, quantity, movement.unitCostPaise);
  } else if (quantity < 0) {
    cogsPaise = Math.round(Math.abs(quantity) * inventory.avgCostPaise);
  }

  await tx.inventory.update({
    where: { id: inventory.id },
    data: { quantity: newStock, avgCostPaise },
  });

  if (movement.batchId) {
    await tx.batch.update({
      where: { id: movement.batchId },
      data: { quantity: { increment: quantity } },
    });
  }

  const transaction = await tx.inventoryTransaction.create({
    data: {
      businessId: scope.businessId,
      variantId: variant.id,
      batchId: movement.batchId ?? null,
      type: movement.type,
      quantity,
      previousStock,
      newStock,
      unitCostPaise:
        movement.unitCostPaise ?? (quantity < 0 ? inventory.avgCostPaise : avgCostPaise),
      referenceType: movement.referenceType ?? null,
      referenceId: movement.referenceId ?? null,
      source: movement.source ?? 'MANUAL',
      note: movement.note ?? null,
      userId: scope.userId || null,
    },
  });

  return {
    transactionId: transaction.id,
    variantId: variant.id,
    previousStock,
    newStock,
    cogsPaise,
    avgCostPaise,
  };
}

export async function getBusinessSettings(db: Db, businessId: string) {
  const settings = await db.businessSettings.findUnique({ where: { businessId } });
  if (!settings) throw notFound('Business settings');
  return settings;
}

/**
 * FEFO (first expiry, first out) batch picking for pharmacy/grocery. Returns
 * the batches to consume for a requested quantity, oldest expiry first.
 */
export async function allocateBatchesFefo(
  db: Db,
  businessId: string,
  variantId: string,
  quantity: number,
): Promise<Array<{ batchId: string; quantity: number; batchNumber: string; expiryDate: Date | null }>> {
  const batches = await db.batch.findMany({
    where: { businessId, variantId, quantity: { gt: 0 } },
    orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }],
  });

  const picks: Array<{ batchId: string; quantity: number; batchNumber: string; expiryDate: Date | null }> = [];
  let remaining = roundQty(quantity);
  for (const batch of batches) {
    if (remaining <= 0) break;
    const take = Math.min(batch.quantity, remaining);
    picks.push({ batchId: batch.id, quantity: roundQty(take), batchNumber: batch.batchNumber, expiryDate: batch.expiryDate });
    remaining = roundQty(remaining - take);
  }
  return picks;
}

export interface AdjustmentLine {
  variantId: string;
  /** Delta mode: signed change. */
  quantityChange?: number;
  /** Count mode: the physical quantity counted on the shelf. */
  countedQuantity?: number;
  note?: string;
}

/**
 * Stock adjustments always carry a reason - "stock just changed" is never an
 * acceptable answer for a shop owner looking at their ledger.
 */
export async function createStockAdjustment(
  scope: TenantScope,
  input: {
    reason: AdjustmentReason;
    note?: string;
    source?: TransactionSource;
    lines: AdjustmentLine[];
  },
) {
  if (!input.lines.length) throw badRequest('Add at least one product to adjust.');

  return prisma.$transaction(async (tx) => {
    const settings = await getBusinessSettings(tx, scope.businessId);
    const adjustment = await tx.stockAdjustment.create({
      data: {
        businessId: scope.businessId,
        reason: input.reason,
        note: input.note ?? null,
        source: input.source ?? 'MANUAL',
        userId: scope.userId || null,
      },
    });

    const results: MovementResult[] = [];
    for (const line of input.lines) {
      let delta = line.quantityChange ?? 0;
      if (line.countedQuantity !== undefined) {
        const inventory = await tx.inventory.findFirst({
          where: { businessId: scope.businessId, variantId: line.variantId },
        });
        delta = roundQty(line.countedQuantity - (inventory?.quantity ?? 0));
      }
      if (delta === 0) continue;

      const type = movementTypeForReason(input.reason, input.source);
      const movement = await applyStockMovement(
        tx,
        scope,
        {
          variantId: line.variantId,
          quantity: delta,
          type,
          referenceType: 'ADJUSTMENT',
          referenceId: adjustment.id,
          source: input.source ?? 'MANUAL',
          note: line.note ?? input.note,
          // Damage/expiry write-offs must be possible even if the book stock
          // disagrees with the shelf; the ledger keeps the discrepancy visible.
          allowNegative: input.reason === 'COUNT_DIFF' ? true : settings.allowNegativeStock,
        },
        { allowNegativeStock: settings.allowNegativeStock },
      );

      await tx.stockAdjustmentItem.create({
        data: {
          adjustmentId: adjustment.id,
          variantId: line.variantId,
          quantityChange: delta,
          previousStock: movement.previousStock,
          newStock: movement.newStock,
        },
      });
      results.push(movement);
    }

    await recordAudit(tx, scope, {
      action: 'STOCK_ADJUSTMENT',
      entityType: 'StockAdjustment',
      entityId: adjustment.id,
      after: { reason: input.reason, lines: results },
      source: input.source ?? 'MANUAL',
    });

    return { adjustment, movements: results };
  }, txOptions);
}

function movementTypeForReason(
  reason: AdjustmentReason,
  source?: TransactionSource,
): InventoryTransactionType {
  if (source === 'IMAGE_SCAN') return 'IMAGE_SCAN_ADJUSTMENT';
  switch (reason) {
    case 'DAMAGED':
      return 'DAMAGE';
    case 'EXPIRED':
      return 'EXPIRY';
    case 'OPENING':
      return 'OPENING';
    default:
      return 'ADJUSTMENT';
  }
}

export interface InventoryListFilters {
  search?: string;
  categoryId?: string;
  brandId?: string;
  status?: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'EXPIRING_SOON';
  page?: number;
  pageSize?: number;
}

const INVENTORY_ROW_INCLUDE = {
  inventory: true,
  product: { include: { category: true, brand: true, unit: true } },
  batches: { where: { quantity: { gt: 0 } }, orderBy: { expiryDate: 'asc' as const }, take: 1 },
};

type InventoryVariant = Awaited<ReturnType<typeof loadInventoryVariant>>;

async function loadInventoryVariant(businessId: string, variantId: string) {
  return prisma.productVariant.findFirst({
    where: { id: variantId, businessId },
    include: INVENTORY_ROW_INCLUDE,
  });
}

/** One shelf row: what is there, what it is worth, and whether it needs attention. */
function toInventoryRow(variant: NonNullable<InventoryVariant>, expiryCutoff: Date) {
  const quantity = roundQty(variant.inventory?.quantity ?? 0);
  const avgCost = variant.inventory?.avgCostPaise ?? variant.purchasePricePaise;
  const nearestExpiry = variant.batches[0]?.expiryDate ?? null;
  let status: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'EXPIRING_SOON' = 'IN_STOCK';
  if (quantity <= 0) status = 'OUT_OF_STOCK';
  else if (variant.minStock > 0 && quantity <= variant.minStock) status = 'LOW_STOCK';
  if (nearestExpiry && nearestExpiry <= expiryCutoff && quantity > 0) status = 'EXPIRING_SOON';

  return {
    variantId: variant.id,
    productId: variant.productId,
    name: variant.isDefault ? variant.product.name : `${variant.product.name} - ${variant.name}`,
    sku: variant.sku,
    barcode: variant.barcode,
    unit: variant.product.unit.code,
    allowDecimal: variant.product.unit.allowDecimal,
    category: variant.product.category?.name ?? null,
    brand: variant.product.brand?.name ?? null,
    quantity,
    minStock: variant.minStock,
    status,
    nearestExpiry,
    purchasePricePaise: variant.purchasePricePaise,
    sellingPricePaise: variant.sellingPricePaise,
    mrpPaise: variant.mrpPaise,
    stockValuePaise: Math.round(quantity * avgCost),
    avgCostPaise: avgCost,
    trackBatch: variant.product.trackBatch,
    trackSerial: variant.product.trackSerial,
  };
}

/** The stock card for a single product, as the STOCK screen opens it. */
export async function getInventoryItem(scope: TenantScope, variantId: string) {
  const [variant, settings] = await Promise.all([
    loadInventoryVariant(scope.businessId, variantId),
    getBusinessSettings(prisma, scope.businessId),
  ]);
  if (!variant) throw notFound('Product');
  return toInventoryRow(variant, new Date(Date.now() + settings.expiryAlertDays * 86400_000));
}

export async function listInventory(scope: TenantScope, filters: InventoryListFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 50));
  const settings = await getBusinessSettings(prisma, scope.businessId);

  const search = filters.search?.trim();
  const variants = await prisma.productVariant.findMany({
    where: {
      businessId: scope.businessId,
      isActive: true,
      product: {
        isActive: true,
        ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
        ...(filters.brandId ? { brandId: filters.brandId } : {}),
      },
      ...(search
        ? {
            OR: [
              { product: { name: { contains: search } } },
              { product: { normalizedName: { contains: search.toLowerCase() } } },
              { sku: { contains: search } },
              { barcode: search },
            ],
          }
        : {}),
    },
    include: INVENTORY_ROW_INCLUDE,
    orderBy: { product: { name: 'asc' } },
  });

  const expiryCutoff = new Date(Date.now() + settings.expiryAlertDays * 86400_000);

  const rows = variants.map((variant) => toInventoryRow(variant, expiryCutoff));

  const filtered = filters.status ? rows.filter((r) => r.status === filters.status) : rows;

  return {
    items: filtered.slice((page - 1) * pageSize, page * pageSize),
    total: filtered.length,
    page,
    pageSize,
    summary: {
      stockValuePaise: rows.reduce((sum, r) => sum + r.stockValuePaise, 0),
      lowStock: rows.filter((r) => r.status === 'LOW_STOCK').length,
      outOfStock: rows.filter((r) => r.status === 'OUT_OF_STOCK').length,
      expiringSoon: rows.filter((r) => r.status === 'EXPIRING_SOON').length,
    },
  };
}

export async function getStockLedger(
  scope: TenantScope,
  variantId: string,
  options: { limit?: number; from?: Date; to?: Date } = {},
) {
  return prisma.inventoryTransaction.findMany({
    where: {
      businessId: scope.businessId,
      variantId,
      ...(options.from || options.to
        ? { createdAt: { ...(options.from ? { gte: options.from } : {}), ...(options.to ? { lte: options.to } : {}) } }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(500, options.limit ?? 100),
    include: { user: { select: { id: true, name: true } } },
  });
}

export async function getStockLevel(db: Db, businessId: string, variantId: string): Promise<number> {
  const inventory = await db.inventory.findFirst({ where: { businessId, variantId } });
  return roundQty(inventory?.quantity ?? 0);
}
