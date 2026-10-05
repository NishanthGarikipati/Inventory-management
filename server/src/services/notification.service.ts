import { prisma, type Db } from '../db/prisma.js';
import type { TenantScope } from '../db/tenant.js';
import { toRupees } from '../domain/money.js';

export interface NotificationInput {
  type: 'LOW_STOCK' | 'OUT_OF_STOCK' | 'EXPIRY' | 'CUSTOMER_DUE' | 'SUPPLIER_DUE' | 'SCAN_REVIEW';
  title: string;
  body: string;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  dedupeKey: string;
  refType?: string;
  refId?: string;
}

/** Upsert on dedupeKey so a shop owner is not buried in repeat alerts. */
export async function raiseNotification(db: Db, businessId: string, input: NotificationInput) {
  return db.notification.upsert({
    where: { businessId_dedupeKey: { businessId, dedupeKey: input.dedupeKey } },
    create: {
      businessId,
      type: input.type,
      title: input.title,
      body: input.body,
      severity: input.severity ?? 'INFO',
      dedupeKey: input.dedupeKey,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
    },
    update: { body: input.body, severity: input.severity ?? 'INFO', isRead: false, createdAt: new Date() },
  });
}

/**
 * Re-evaluates stock alerts for the variants a transaction touched. Runs after
 * the sale/purchase transaction commits so it never slows down the POS.
 */
export async function refreshStockAlerts(businessId: string, variantIds: string[]): Promise<void> {
  const unique = [...new Set(variantIds)];
  if (!unique.length) return;

  const settings = await prisma.businessSettings.findUnique({ where: { businessId } });
  if (!settings?.lowStockAlerts) return;

  const variants = await prisma.productVariant.findMany({
    where: { businessId, id: { in: unique } },
    include: { inventory: true, product: { select: { name: true } } },
  });

  for (const variant of variants) {
    const quantity = variant.inventory?.quantity ?? 0;
    const name = variant.isDefault ? variant.product.name : `${variant.product.name} - ${variant.name}`;
    const dedupeKey = `stock-${variant.id}`;
    if (quantity <= 0) {
      await raiseNotification(prisma, businessId, {
        type: 'OUT_OF_STOCK',
        title: 'Out of stock',
        body: `${name} is finished. Order it from your supplier.`,
        severity: 'CRITICAL',
        dedupeKey,
        refType: 'ProductVariant',
        refId: variant.id,
      });
    } else if (variant.minStock > 0 && quantity <= variant.minStock) {
      await raiseNotification(prisma, businessId, {
        type: 'LOW_STOCK',
        title: 'Low stock',
        body: `${name} is below minimum stock (${quantity} left).`,
        severity: 'WARNING',
        dedupeKey,
        refType: 'ProductVariant',
        refId: variant.id,
      });
    } else {
      await prisma.notification.deleteMany({ where: { businessId, dedupeKey } });
    }
  }
}

/** Expiry, customer due and supplier due sweep - run on dashboard open or by a job. */
export async function refreshBusinessAlerts(businessId: string): Promise<number> {
  const settings = await prisma.businessSettings.findUnique({ where: { businessId } });
  const days = settings?.expiryAlertDays ?? 30;
  const cutoff = new Date(Date.now() + days * 86400_000);
  let raised = 0;

  const batches = await prisma.batch.findMany({
    where: { businessId, quantity: { gt: 0 }, expiryDate: { not: null, lte: cutoff } },
    include: { variant: { include: { product: { select: { name: true } } } } },
    take: 100,
  });
  for (const batch of batches) {
    const daysLeft = Math.ceil((batch.expiryDate!.getTime() - Date.now()) / 86400_000);
    await raiseNotification(prisma, businessId, {
      type: 'EXPIRY',
      title: daysLeft < 0 ? 'Expired stock' : 'Expiring soon',
      body:
        daysLeft < 0
          ? `${batch.variant.product.name} batch ${batch.batchNumber} has expired. Remove it from the shelf.`
          : `${batch.variant.product.name} batch ${batch.batchNumber} expires in ${daysLeft} days.`,
      severity: daysLeft < 0 ? 'CRITICAL' : 'WARNING',
      dedupeKey: `expiry-${batch.id}`,
      refType: 'Batch',
      refId: batch.id,
    });
    raised += 1;
  }

  const debtors = await prisma.customer.findMany({
    where: { businessId, balancePaise: { gt: 0 } },
    orderBy: { balancePaise: 'desc' },
    take: 10,
  });
  for (const customer of debtors) {
    await raiseNotification(prisma, businessId, {
      type: 'CUSTOMER_DUE',
      title: 'Money due',
      body: `${customer.name} has ₹${toRupees(customer.balancePaise).toLocaleString('en-IN')} outstanding.`,
      severity: 'INFO',
      dedupeKey: `customer-due-${customer.id}`,
      refType: 'Customer',
      refId: customer.id,
    });
    raised += 1;
  }

  const creditors = await prisma.supplier.findMany({
    where: { businessId, balancePaise: { gt: 0 } },
    orderBy: { balancePaise: 'desc' },
    take: 10,
  });
  for (const supplier of creditors) {
    await raiseNotification(prisma, businessId, {
      type: 'SUPPLIER_DUE',
      title: 'Supplier due',
      body: `You owe ${supplier.name} ₹${toRupees(supplier.balancePaise).toLocaleString('en-IN')}.`,
      severity: 'INFO',
      dedupeKey: `supplier-due-${supplier.id}`,
      refType: 'Supplier',
      refId: supplier.id,
    });
    raised += 1;
  }

  const pendingScans = await prisma.imageScan.count({
    where: { businessId, status: 'REVIEW_REQUIRED' },
  });
  if (pendingScans > 0) {
    await raiseNotification(prisma, businessId, {
      type: 'SCAN_REVIEW',
      title: 'Waiting for your confirmation',
      body: `${pendingScans} scanned ${pendingScans === 1 ? 'document is' : 'documents are'} waiting for confirmation.`,
      severity: 'WARNING',
      dedupeKey: 'scan-review-pending',
      refType: 'ImageScan',
    });
    raised += 1;
  } else {
    await prisma.notification.deleteMany({ where: { businessId, dedupeKey: 'scan-review-pending' } });
  }

  return raised;
}

export async function listNotifications(scope: TenantScope, options: { unreadOnly?: boolean; limit?: number } = {}) {
  return prisma.notification.findMany({
    where: { businessId: scope.businessId, ...(options.unreadOnly ? { isRead: false } : {}) },
    orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
    take: Math.min(200, options.limit ?? 50),
  });
}

export async function markNotificationRead(scope: TenantScope, id: string) {
  await prisma.notification.updateMany({
    where: { id, businessId: scope.businessId },
    data: { isRead: true },
  });
}
