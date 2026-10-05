import { prisma, txOptions, type Tx } from '../db/prisma.js';
import type { TenantScope } from '../db/tenant.js';
import { badRequest, conflict, notFound } from '../domain/errors.js';
import type { PaymentMethod, TransactionSource } from '../domain/enums.js';
import { computeLineTax, roundQty } from '../domain/money.js';
import { applyStockMovement, getBusinessSettings } from './inventory.service.js';
import { recordAudit } from './audit.service.js';
import { refreshStockAlerts } from './notification.service.js';

export interface PurchaseItemInput {
  variantId: string;
  quantity: number;
  unitCostPaise: number;
  discountPaise?: number;
  taxRate?: number;
  /** Optional batch details for pharmacy/grocery goods. */
  batchNumber?: string | null;
  expiryDate?: Date | null;
  mrpPaise?: number | null;
  /** Update the catalogue prices from this purchase. */
  updateSellingPricePaise?: number | null;
  serials?: string[];
}

export interface CreatePurchaseInput {
  supplierId?: string | null;
  invoiceNumber?: string | null;
  purchaseDate?: Date;
  items: PurchaseItemInput[];
  discountPaise?: number;
  payments?: Array<{ method: PaymentMethod; amountPaise: number; reference?: string }>;
  note?: string;
  source?: TransactionSource;
  imageScanId?: string | null;
  clientRequestId?: string;
}

/**
 * Records a purchase: stock in at the invoice cost (which refreshes the moving
 * average), batch rows for expiry tracking, supplier dues and the audit trail.
 */
export async function createPurchase(scope: TenantScope, input: CreatePurchaseInput) {
  if (!input.items.length) throw badRequest('Add at least one product to the purchase.');

  const purchase = await prisma.$transaction(async (tx) => {
    const settings = await getBusinessSettings(tx, scope.businessId);
    const taxMode = settings.pricesIncludeTax ? 'INCLUSIVE' : 'EXCLUSIVE';

    const purchase = await tx.purchase.create({
      data: {
        businessId: scope.businessId,
        supplierId: input.supplierId ?? null,
        userId: scope.userId || null,
        invoiceNumber: input.invoiceNumber ?? null,
        purchaseDate: input.purchaseDate ?? new Date(),
        note: input.note ?? null,
        source: input.source ?? 'MANUAL',
        imageScanId: input.imageScanId ?? null,
        clientRequestId: input.clientRequestId ?? null,
      },
    });

    let subtotalPaise = 0;
    let taxPaise = 0;
    let discountPaise = Math.max(0, Math.round(input.discountPaise ?? 0));

    for (const item of input.items) {
      const quantity = roundQty(item.quantity);
      if (quantity <= 0) throw badRequest('Quantity must be more than zero.');
      if (item.unitCostPaise < 0) throw badRequest('Purchase price cannot be negative.');

      const variant = await tx.productVariant.findFirst({
        where: { id: item.variantId, businessId: scope.businessId },
        include: { product: { include: { tax: true } } },
      });
      if (!variant) throw notFound('Product');

      const taxRate = settings.taxEnabled ? item.taxRate ?? variant.product.tax?.rate ?? 0 : 0;
      const math = computeLineTax({
        unitPricePaise: item.unitCostPaise,
        quantity,
        discountPaise: item.discountPaise ?? 0,
        taxRate,
        mode: taxMode,
      });

      let batchId: string | null = null;
      if (item.batchNumber) {
        const batch = await tx.batch.upsert({
          where: {
            businessId_variantId_batchNumber: {
              businessId: scope.businessId,
              variantId: variant.id,
              batchNumber: item.batchNumber,
            },
          },
          create: {
            businessId: scope.businessId,
            variantId: variant.id,
            batchNumber: item.batchNumber,
            expiryDate: item.expiryDate ?? null,
            quantity: 0,
            costPaise: item.unitCostPaise,
            mrpPaise: item.mrpPaise ?? variant.mrpPaise,
          },
          update: {
            ...(item.expiryDate ? { expiryDate: item.expiryDate } : {}),
            costPaise: item.unitCostPaise,
          },
        });
        batchId = batch.id;
      }

      await applyStockMovement(tx, scope, {
        variantId: variant.id,
        quantity,
        type: 'PURCHASE',
        unitCostPaise: Math.round(math.taxablePaise / quantity),
        batchId,
        referenceType: 'PURCHASE',
        referenceId: purchase.id,
        source: input.source ?? 'MANUAL',
      });

      await tx.purchaseItem.create({
        data: {
          purchaseId: purchase.id,
          variantId: variant.id,
          batchId,
          productName: variant.isDefault ? variant.product.name : `${variant.product.name} - ${variant.name}`,
          quantity,
          unitCostPaise: item.unitCostPaise,
          discountPaise: item.discountPaise ?? 0,
          taxRate,
          taxPaise: math.taxPaise,
          totalPaise: math.totalPaise,
        },
      });

      if (item.serials?.length) {
        for (const serial of item.serials) {
          await tx.serialItem.create({
            data: {
              businessId: scope.businessId,
              variantId: variant.id,
              serial,
              purchaseId: purchase.id,
              status: 'IN_STOCK',
            },
          });
        }
      }

      const priceUpdates: Record<string, number> = {};
      if (item.unitCostPaise !== variant.purchasePricePaise) priceUpdates.purchasePricePaise = item.unitCostPaise;
      if (item.updateSellingPricePaise) priceUpdates.sellingPricePaise = item.updateSellingPricePaise;
      if (item.mrpPaise) priceUpdates.mrpPaise = item.mrpPaise;
      if (Object.keys(priceUpdates).length) {
        await tx.productVariant.update({ where: { id: variant.id }, data: priceUpdates });
      }

      subtotalPaise += math.taxablePaise;
      taxPaise += math.taxPaise;
      discountPaise += item.discountPaise ?? 0;
    }

    const totalPaise = subtotalPaise + taxPaise;
    const paidPaise = (input.payments ?? []).reduce((sum, p) => sum + Math.round(p.amountPaise), 0);
    if (paidPaise > totalPaise + 100) throw badRequest('Payment is more than the purchase amount.');
    const duePaise = Math.max(0, totalPaise - paidPaise);

    for (const payment of input.payments ?? []) {
      if (payment.amountPaise <= 0) continue;
      await tx.purchasePayment.create({
        data: {
          purchaseId: purchase.id,
          method: payment.method,
          amountPaise: Math.round(payment.amountPaise),
          reference: payment.reference ?? null,
        },
      });
    }

    if (input.supplierId && duePaise > 0) {
      await tx.supplier.update({
        where: { id: input.supplierId },
        data: { balancePaise: { increment: duePaise } },
      });
    }

    const updated = await tx.purchase.update({
      where: { id: purchase.id },
      data: { subtotalPaise, taxPaise, discountPaise, totalPaise, paidPaise, duePaise },
      include: { items: true, payments: true, supplier: true },
    });

    await recordAudit(tx, scope, {
      action: 'PURCHASE_CREATED',
      entityType: 'Purchase',
      entityId: purchase.id,
      after: { totalPaise, items: updated.items.length, source: input.source ?? 'MANUAL' },
      meta: input.imageScanId ? { imageScanId: input.imageScanId } : undefined,
      source: input.source ?? 'MANUAL',
    });

    return updated;
  }, txOptions);

  await refreshStockAlerts(scope.businessId, purchase.items.map((i) => i.variantId));
  return getPurchase(scope, purchase.id);
}

export async function getPurchase(scope: TenantScope, purchaseId: string) {
  const purchase = await prisma.purchase.findFirst({
    where: { id: purchaseId, businessId: scope.businessId },
    include: {
      items: { include: { variant: { include: { product: { select: { name: true } } } }, batch: true } },
      payments: true,
      supplier: true,
      returns: { include: { items: true } },
    },
  });
  if (!purchase) throw notFound('Purchase');
  return purchase;
}

export async function listPurchases(
  scope: TenantScope,
  filters: { from?: Date; to?: Date; supplierId?: string; page?: number; pageSize?: number },
) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 25));
  const where = {
    businessId: scope.businessId,
    ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
    ...(filters.from || filters.to
      ? { purchaseDate: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.purchase.findMany({
      where,
      include: { supplier: { select: { id: true, name: true } }, _count: { select: { items: true } } },
      orderBy: { purchaseDate: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.purchase.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function cancelPurchase(scope: TenantScope, purchaseId: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    const purchase = await tx.purchase.findFirst({
      where: { id: purchaseId, businessId: scope.businessId },
      include: { items: true },
    });
    if (!purchase) throw notFound('Purchase');
    if (purchase.status === 'CANCELLED') throw conflict('This purchase is already cancelled.');

    const settings = await getBusinessSettings(tx, scope.businessId);

    // Cancelling pulls the received goods back out. If they have already been
    // sold there is nothing to pull, and quietly driving stock negative would
    // hide that - the owner wants a purchase return instead.
    if (!settings.allowNegativeStock) {
      for (const item of purchase.items) {
        const inventory = await tx.inventory.findFirst({
          where: { businessId: scope.businessId, variantId: item.variantId },
        });
        if ((inventory?.quantity ?? 0) < item.quantity) {
          throw conflict(
            `${item.productName} from this purchase has already been sold, so the purchase cannot be cancelled.`,
            [
              { label: 'Return To Supplier', action: 'CREATE_PURCHASE_RETURN', payload: { purchaseId: purchase.id } },
              { label: 'Adjust Stock', action: 'STOCK_ADJUSTMENT', payload: { variantId: item.variantId } },
            ],
          );
        }
      }
    }

    for (const item of purchase.items) {
      await applyStockMovement(
        tx,
        scope,
        {
          variantId: item.variantId,
          quantity: -item.quantity,
          type: 'PURCHASE_RETURN',
          batchId: item.batchId,
          referenceType: 'PURCHASE_CANCELLATION',
          referenceId: purchase.id,
          note: reason,
        },
        { allowNegativeStock: settings.allowNegativeStock },
      );
    }

    if (purchase.supplierId && purchase.duePaise > 0) {
      await tx.supplier.update({
        where: { id: purchase.supplierId },
        data: { balancePaise: { decrement: purchase.duePaise } },
      });
    }

    const updated = await tx.purchase.update({ where: { id: purchase.id }, data: { status: 'CANCELLED' } });
    await recordAudit(tx, scope, {
      action: 'PURCHASE_CANCELLED',
      entityType: 'Purchase',
      entityId: purchase.id,
      before: { status: purchase.status },
      after: { status: 'CANCELLED', reason },
    });
    return updated;
  }, txOptions);
}

/** Shared by the manual purchase screen and the scanner approval step. */
export async function ensureBatchForVariant(
  tx: Tx,
  businessId: string,
  variantId: string,
  batchNumber: string,
  expiryDate: Date | null,
) {
  return tx.batch.upsert({
    where: { businessId_variantId_batchNumber: { businessId, variantId, batchNumber } },
    create: { businessId, variantId, batchNumber, expiryDate },
    update: expiryDate ? { expiryDate } : {},
  });
}
