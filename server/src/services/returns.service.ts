import { prisma, txOptions } from '../db/prisma.js';
import type { TenantScope } from '../db/tenant.js';
import { badRequest, conflict, notFound } from '../domain/errors.js';
import { roundQty } from '../domain/money.js';
import { applyStockMovement } from './inventory.service.js';
import { recordAudit } from './audit.service.js';
import { nextDocumentNumber } from './sequence.service.js';
import { refreshStockAlerts } from './notification.service.js';

export interface SalesReturnInput {
  saleId?: string;
  customerId?: string;
  reason: string;
  refundMethod?: 'CASH' | 'UPI' | 'CARD' | 'CREDIT_NOTE' | 'ADJUST_DUE';
  items: Array<{
    saleItemId?: string;
    variantId?: string;
    quantity: number;
    unitPricePaise?: number;
    /** Damaged goods come back off the shelf, not into it. */
    restock?: boolean;
  }>;
  clientRequestId?: string;
}

/**
 * Customer return: money (or credit) back to the customer, goods back into
 * stock when they are resellable, and the original bill keeps a returned
 * quantity so it can never be returned twice.
 */
export async function createSalesReturn(scope: TenantScope, input: SalesReturnInput) {
  if (!input.items.length) throw badRequest('Choose at least one product to return.');

  const result = await prisma.$transaction(async (tx) => {
    const returnNumber = await nextDocumentNumber(tx, scope.businessId, 'SALES_RETURN', 'SR');
    const sale = input.saleId
      ? await tx.sale.findFirst({
          where: { id: input.saleId, businessId: scope.businessId },
          include: { items: true },
        })
      : null;
    if (input.saleId && !sale) throw notFound('Bill');
    if (sale?.status === 'CANCELLED') throw conflict('This bill is already cancelled.');

    const salesReturn = await tx.salesReturn.create({
      data: {
        businessId: scope.businessId,
        saleId: sale?.id ?? null,
        customerId: input.customerId ?? sale?.customerId ?? null,
        returnNumber,
        reason: input.reason,
        refundMethod: input.refundMethod ?? 'CASH',
        userId: scope.userId || null,
      },
    });

    let totalPaise = 0;
    const touchedVariants: string[] = [];

    for (const line of input.items) {
      const quantity = roundQty(line.quantity);
      if (quantity <= 0) throw badRequest('Return quantity must be more than zero.');

      const saleItem = line.saleItemId ? sale?.items.find((i) => i.id === line.saleItemId) : undefined;
      if (line.saleItemId && !saleItem) throw notFound('Bill item');

      const variantId = saleItem?.variantId ?? line.variantId;
      if (!variantId) throw badRequest('Choose the product being returned.');

      if (saleItem) {
        const remaining = roundQty(saleItem.quantity - saleItem.returnedQty);
        if (quantity > remaining) {
          throw conflict(
            `Only ${remaining} of ${saleItem.productName} can still be returned on this bill.`,
            [{ label: 'Change Quantity', action: 'CHANGE_QUANTITY', payload: { available: remaining } }],
          );
        }
        await tx.saleItem.update({
          where: { id: saleItem.id },
          data: { returnedQty: { increment: quantity } },
        });
      }

      const unitPricePaise =
        line.unitPricePaise ??
        (saleItem ? Math.round((saleItem.totalPaise - saleItem.discountPaise) / saleItem.quantity) : 0);
      const linePaise = Math.round(unitPricePaise * quantity);
      const restock = line.restock ?? true;

      if (restock) {
        await applyStockMovement(tx, scope, {
          variantId,
          quantity,
          type: 'SALE_RETURN',
          batchId: saleItem?.batchId ?? null,
          unitCostPaise: saleItem && saleItem.quantity > 0 ? Math.round(saleItem.costPaise / saleItem.quantity) : undefined,
          referenceType: 'SALES_RETURN',
          referenceId: salesReturn.id,
          note: input.reason,
        });
      } else {
        await applyStockMovement(
          tx,
          scope,
          {
            variantId,
            quantity,
            type: 'SALE_RETURN',
            referenceType: 'SALES_RETURN',
            referenceId: salesReturn.id,
            note: `${input.reason} (not resellable)`,
          },
          { allowNegativeStock: true },
        );
        await applyStockMovement(
          tx,
          scope,
          {
            variantId,
            quantity: -quantity,
            type: 'DAMAGE',
            referenceType: 'SALES_RETURN',
            referenceId: salesReturn.id,
            note: 'Returned item not resellable',
          },
          { allowNegativeStock: true },
        );
      }

      await tx.salesReturnItem.create({
        data: {
          returnId: salesReturn.id,
          saleItemId: saleItem?.id ?? null,
          variantId,
          quantity,
          unitPricePaise,
          totalPaise: linePaise,
          restock,
        },
      });

      totalPaise += linePaise;
      touchedVariants.push(variantId);
    }

    const customerId = input.customerId ?? sale?.customerId ?? null;
    const method = input.refundMethod ?? 'CASH';
    let refundPaise = totalPaise;

    if (method === 'ADJUST_DUE' && customerId) {
      await tx.customer.update({
        where: { id: customerId },
        data: { balancePaise: { decrement: totalPaise } },
      });
      refundPaise = 0;
    } else if (method === 'CREDIT_NOTE' && customerId) {
      // A credit note is a negative balance the customer can spend later.
      await tx.customer.update({
        where: { id: customerId },
        data: { balancePaise: { decrement: totalPaise } },
      });
      refundPaise = 0;
    }

    const updated = await tx.salesReturn.update({
      where: { id: salesReturn.id },
      data: { totalPaise, refundPaise },
      include: { items: true },
    });

    await recordAudit(tx, scope, {
      action: 'SALES_RETURN',
      entityType: 'SalesReturn',
      entityId: salesReturn.id,
      after: { returnNumber, totalPaise, reason: input.reason, refundMethod: method },
    });

    return { salesReturn: updated, touchedVariants };
  }, txOptions);

  await refreshStockAlerts(scope.businessId, result.touchedVariants);
  return result.salesReturn;
}

export interface PurchaseReturnInput {
  purchaseId?: string;
  supplierId?: string;
  reason: string;
  settlement?: 'ADJUST_DUE' | 'CASH_REFUND';
  items: Array<{ purchaseItemId?: string; variantId?: string; quantity: number; unitCostPaise?: number }>;
  clientRequestId?: string;
}

/** Goods going back to the supplier: stock out, supplier due reduced. */
export async function createPurchaseReturn(scope: TenantScope, input: PurchaseReturnInput) {
  if (!input.items.length) throw badRequest('Choose at least one product to return.');

  const result = await prisma.$transaction(async (tx) => {
    const returnNumber = await nextDocumentNumber(tx, scope.businessId, 'PURCHASE_RETURN', 'PR');
    const purchase = input.purchaseId
      ? await tx.purchase.findFirst({
          where: { id: input.purchaseId, businessId: scope.businessId },
          include: { items: true },
        })
      : null;
    if (input.purchaseId && !purchase) throw notFound('Purchase');

    const purchaseReturn = await tx.purchaseReturn.create({
      data: {
        businessId: scope.businessId,
        purchaseId: purchase?.id ?? null,
        supplierId: input.supplierId ?? purchase?.supplierId ?? null,
        returnNumber,
        reason: input.reason,
        settlement: input.settlement ?? 'ADJUST_DUE',
        userId: scope.userId || null,
      },
    });

    let totalPaise = 0;
    const touchedVariants: string[] = [];

    for (const line of input.items) {
      const quantity = roundQty(line.quantity);
      if (quantity <= 0) throw badRequest('Return quantity must be more than zero.');

      const purchaseItem = line.purchaseItemId
        ? purchase?.items.find((i) => i.id === line.purchaseItemId)
        : undefined;
      if (line.purchaseItemId && !purchaseItem) throw notFound('Purchase item');

      const variantId = purchaseItem?.variantId ?? line.variantId;
      if (!variantId) throw badRequest('Choose the product being returned.');

      if (purchaseItem) {
        const remaining = roundQty(purchaseItem.quantity - purchaseItem.returnedQty);
        if (quantity > remaining) {
          throw conflict(`Only ${remaining} of ${purchaseItem.productName} can still be returned.`);
        }
        await tx.purchaseItem.update({
          where: { id: purchaseItem.id },
          data: { returnedQty: { increment: quantity } },
        });
      }

      const unitCostPaise = line.unitCostPaise ?? purchaseItem?.unitCostPaise ?? 0;
      await applyStockMovement(tx, scope, {
        variantId,
        quantity: -quantity,
        type: 'PURCHASE_RETURN',
        batchId: purchaseItem?.batchId ?? null,
        referenceType: 'PURCHASE_RETURN',
        referenceId: purchaseReturn.id,
        note: input.reason,
      });

      await tx.purchaseReturnItem.create({
        data: {
          returnId: purchaseReturn.id,
          purchaseItemId: purchaseItem?.id ?? null,
          variantId,
          quantity,
          unitCostPaise,
          totalPaise: Math.round(unitCostPaise * quantity),
        },
      });

      totalPaise += Math.round(unitCostPaise * quantity);
      touchedVariants.push(variantId);
    }

    const supplierId = input.supplierId ?? purchase?.supplierId ?? null;
    if (supplierId && (input.settlement ?? 'ADJUST_DUE') === 'ADJUST_DUE') {
      await tx.supplier.update({
        where: { id: supplierId },
        data: { balancePaise: { decrement: totalPaise } },
      });
    }

    const updated = await tx.purchaseReturn.update({
      where: { id: purchaseReturn.id },
      data: { totalPaise },
      include: { items: true },
    });

    await recordAudit(tx, scope, {
      action: 'PURCHASE_RETURN',
      entityType: 'PurchaseReturn',
      entityId: purchaseReturn.id,
      after: { returnNumber, totalPaise, reason: input.reason },
    });

    return { purchaseReturn: updated, touchedVariants };
  }, txOptions);

  await refreshStockAlerts(scope.businessId, result.touchedVariants);
  return result.purchaseReturn;
}

export async function listSalesReturns(scope: TenantScope, filters: { from?: Date; to?: Date; limit?: number } = {}) {
  return prisma.salesReturn.findMany({
    where: {
      businessId: scope.businessId,
      ...(filters.from || filters.to
        ? { createdAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
        : {}),
    },
    include: { items: true, customer: { select: { id: true, name: true } }, sale: { select: { invoiceNumber: true } } },
    orderBy: { createdAt: 'desc' },
    take: Math.min(200, filters.limit ?? 50),
  });
}

export async function listPurchaseReturns(scope: TenantScope, filters: { from?: Date; to?: Date; limit?: number } = {}) {
  return prisma.purchaseReturn.findMany({
    where: {
      businessId: scope.businessId,
      ...(filters.from || filters.to
        ? { createdAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
        : {}),
    },
    include: { items: true, supplier: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: Math.min(200, filters.limit ?? 50),
  });
}
