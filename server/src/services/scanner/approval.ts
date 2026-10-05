import { prisma } from '../../db/prisma.js';
import type { TenantScope } from '../../db/tenant.js';
import { badRequest, conflict, notFound } from '../../domain/errors.js';
import type { PaymentMethod } from '../../domain/enums.js';
import { recordAudit } from '../audit.service.js';
import { createPurchase } from '../purchase.service.js';
import { createStockAdjustment } from '../inventory.service.js';
import { createProduct, updateProduct } from '../product.service.js';
import { findOrCreateSupplierByName } from '../party.service.js';
import { validateExtractedItem } from './validation.js';
import { getScanForReview } from './pipeline.js';

export interface ApproveScanInput {
  /** The owner must name every line being accepted. Nothing is implicit. */
  acceptedItemIds: string[];
  rejectedItemIds?: string[];
  supplierId?: string | null;
  supplierName?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  payment?: { method: PaymentMethod; amountPaise: number; reference?: string } | null;
  note?: string;
}

/**
 * The only door between the AI and the stock ledger.
 *
 * Nothing in the scanner pipeline can change inventory. This function requires
 * an explicit list of approved lines from a user holding `scanner:approve`,
 * re-runs deterministic validation on each one, and then creates ordinary
 * business transactions (a purchase, an adjustment, a product) which in turn
 * write inventory transactions. There is no path that writes stock directly.
 */
export async function approveScan(scope: TenantScope, scanId: string, input: ApproveScanInput) {
  const scan = await prisma.imageScan.findFirst({
    where: { id: scanId, businessId: scope.businessId },
    include: { items: true },
  });
  if (!scan) throw notFound('Scan');
  if (scan.status === 'APPROVED') throw conflict('This scan was already confirmed.');
  if (scan.status === 'REJECTED') throw conflict('This scan was cancelled.');
  if (!['REVIEW_REQUIRED', 'EXTRACTED'].includes(scan.status)) {
    throw conflict('This scan is not ready for confirmation yet.');
  }
  if (!input.acceptedItemIds.length) {
    throw badRequest('Select at least one product to confirm.');
  }

  const accepted = scan.items.filter((item) => input.acceptedItemIds.includes(item.id));
  if (accepted.length !== input.acceptedItemIds.length) {
    throw badRequest('Some of the selected lines are no longer part of this scan.');
  }

  const blocked = accepted.filter((item) => item.reviewState === 'NEEDS_INPUT');
  if (blocked.length) {
    throw badRequest(
      `Please fill in the missing details for ${blocked.map((b) => b.extractedProductName).join(', ')}.`,
      [{ label: 'Enter Details', action: 'EDIT_ITEMS', payload: { itemIds: blocked.map((b) => b.id) } }],
    );
  }

  const allowedTaxRates = await prisma.tax
    .findMany({ where: { businessId: scope.businessId }, select: { rate: true } })
    .then((rows) => rows.map((r) => r.rate));

  // Defence in depth: the values are validated again at the moment of
  // approval, not just when they were extracted.
  const prepared = accepted.map((item) => {
    const validated = validateExtractedItem(
      {
        productName: item.extractedProductName,
        quantity: item.quantity,
        unit: item.unitHint,
        purchasePrice: item.purchasePricePaise !== null ? item.purchasePricePaise / 100 : null,
        sellingPrice: item.sellingPricePaise !== null ? item.sellingPricePaise / 100 : null,
        mrp: item.mrpPaise !== null ? item.mrpPaise / 100 : null,
        barcode: item.barcode,
        batch: item.batch,
        expiry: item.expiry ? item.expiry.toISOString().slice(0, 10) : null,
        taxRate: item.taxRate,
      },
      { allowedTaxRates, maxQuantity: 100_000, maxPricePaise: 10_000_000_00, scanType: scan.scanType },
    );
    const blocking = validated.issues.filter((issue) => issue.severity === 'BLOCK');
    if (blocking.length) {
      throw badRequest(`${item.extractedProductName}: ${blocking[0].message}`, [
        { label: 'Enter Details', action: 'EDIT_ITEMS', payload: { itemIds: [item.id] } },
      ]);
    }
    return { item, validated };
  });

  // Resolve every line to a real product before any transaction is created.
  const resolved = [];
  for (const { item, validated } of prepared) {
    let variantId = item.matchedVariantId;

    if (variantId) {
      const variant = await prisma.productVariant.findFirst({
        where: { id: variantId, businessId: scope.businessId },
      });
      if (!variant) throw notFound('Product');
    } else {
      if (!item.createNewProduct) {
        throw badRequest(`Choose a product for "${item.extractedProductName}" or mark it as a new product.`, [
          { label: 'Select Product', action: 'SELECT_PRODUCT', payload: { itemId: item.id } },
          { label: 'Create New Product', action: 'CREATE_PRODUCT', payload: { itemId: item.id } },
        ]);
      }
      const created = await createProduct(scope, {
        name: validated.productName,
        barcode: validated.barcode,
        purchasePricePaise: validated.purchasePricePaise ?? 0,
        sellingPricePaise: validated.sellingPricePaise ?? validated.mrpPaise ?? 0,
        mrpPaise: validated.mrpPaise ?? 0,
        unitCode: validated.unit ?? undefined,
        trackBatch: Boolean(validated.batch),
        trackExpiry: Boolean(validated.expiry),
        ignoreDuplicateWarning: true,
        source: 'IMAGE_SCAN',
      });
      variantId = created.variants[0].id;
      await prisma.imageScanItem.update({ where: { id: item.id }, data: { matchedVariantId: variantId } });
    }

    resolved.push({ item, validated, variantId: variantId! });
  }

  let resultRefType: string | null = null;
  let resultRefId: string | null = null;

  if (scan.scanType === 'INVOICE' || scan.scanType === 'RECEIPT') {
    const supplierId =
      input.supplierId ??
      scan.supplierId ??
      (input.supplierName || scan.extractedSupplierName
        ? (await findOrCreateSupplierByName(scope, (input.supplierName ?? scan.extractedSupplierName)!)).id
        : null);

    const purchase = await createPurchase(scope, {
      supplierId,
      invoiceNumber: input.invoiceNumber ?? scan.invoiceNumber,
      purchaseDate: input.invoiceDate ? new Date(input.invoiceDate) : scan.invoiceDate ?? new Date(),
      source: 'IMAGE_SCAN',
      imageScanId: scan.id,
      note: input.note,
      items: resolved.map(({ validated, variantId }) => ({
        variantId,
        quantity: validated.quantity ?? 0,
        unitCostPaise: validated.purchasePricePaise ?? 0,
        taxRate: validated.taxRate ?? undefined,
        batchNumber: validated.batch,
        expiryDate: validated.expiry,
        mrpPaise: validated.mrpPaise,
      })),
      payments: input.payment ? [input.payment] : [],
    });

    resultRefType = 'Purchase';
    resultRefId = purchase.id;
  } else if (scan.scanType === 'SHELF' || scan.scanType === 'STOCK_SHEET') {
    // Image based counting is a proposed physical count, never an overwrite:
    // the adjustment records the difference against the counted quantity.
    const { adjustment } = await createStockAdjustment(scope, {
      reason: 'COUNT_DIFF',
      note: input.note ?? `Counted from ${scan.scanType === 'SHELF' ? 'shelf photo' : 'stock sheet'}`,
      source: 'IMAGE_SCAN',
      lines: resolved.map(({ validated, variantId }) => ({
        variantId,
        countedQuantity: validated.quantity ?? 0,
      })),
    });
    resultRefType = 'StockAdjustment';
    resultRefId = adjustment.id;
  } else {
    // Product label: update catalogue details only. Stock never moves here.
    for (const { validated, variantId } of resolved) {
      const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
      await updateProduct(scope, variant.productId, {
        ...(validated.mrpPaise ? { mrpPaise: validated.mrpPaise } : {}),
        ...(validated.sellingPricePaise ? { sellingPricePaise: validated.sellingPricePaise } : {}),
        ...(validated.barcode && !variant.barcode ? { barcode: validated.barcode } : {}),
        source: 'IMAGE_SCAN',
      });
    }
    resultRefType = 'Product';
    resultRefId = resolved[0]?.variantId ?? null;
  }

  const rejectedIds = input.rejectedItemIds ?? scan.items.filter((i) => !input.acceptedItemIds.includes(i.id)).map((i) => i.id);

  await prisma.imageScanItem.updateMany({
    where: { id: { in: input.acceptedItemIds } },
    data: { reviewState: 'ACCEPTED' },
  });
  if (rejectedIds.length) {
    await prisma.imageScanItem.updateMany({
      where: { id: { in: rejectedIds } },
      data: { reviewState: 'REJECTED' },
    });
  }

  const corrections = await prisma.imageScanCorrection.findMany({ where: { scanId: scan.id } });

  const snapshot = {
    scanId: scan.id,
    imageRef: scan.imageRef,
    scanType: scan.scanType,
    provider: scan.provider,
    overallConfidence: scan.overallConfidence,
    result: { type: resultRefType, id: resultRefId },
    items: resolved.map(({ item, validated, variantId }) => ({
      scanItemId: item.id,
      extracted: {
        name: item.extractedProductName,
        quantity: item.quantity,
        purchasePricePaise: item.purchasePricePaise,
        confidence: item.confidence,
        matchMethod: item.matchMethod,
        matchScore: item.matchScore,
      },
      confirmed: {
        variantId,
        name: validated.productName,
        quantity: validated.quantity,
        purchasePricePaise: validated.purchasePricePaise,
        batch: validated.batch,
        expiry: validated.expiry,
      },
      userCorrected: item.userCorrected,
    })),
    corrections: corrections.map((c) => ({
      field: c.field,
      from: c.originalValue,
      to: c.correctedValue,
      userId: c.userId,
    })),
  };

  const approval = await prisma.imageScanApproval.create({
    data: {
      scanId: scan.id,
      approvedById: scope.userId,
      approvedItems: input.acceptedItemIds.length,
      rejectedItems: rejectedIds.length,
      snapshot: JSON.stringify(snapshot),
    },
  });

  await prisma.imageScan.update({
    where: { id: scan.id },
    data: { status: 'APPROVED', resultRefType, resultRefId },
  });

  await recordAudit(prisma, scope, {
    action: 'AI_SCAN_APPROVED',
    entityType: 'ImageScan',
    entityId: scan.id,
    before: { status: scan.status },
    after: snapshot,
    meta: { approvalId: approval.id, imageRef: scan.imageRef },
    source: 'IMAGE_SCAN',
  });

  await prisma.notification.deleteMany({
    where: { businessId: scope.businessId, dedupeKey: `scan-${scan.id}` },
  });

  return { scan: await getScanForReview(scope, scan.id), resultRefType, resultRefId, approval };
}

export async function rejectScan(scope: TenantScope, scanId: string, reason: string) {
  const scan = await prisma.imageScan.findFirst({ where: { id: scanId, businessId: scope.businessId } });
  if (!scan) throw notFound('Scan');
  if (scan.status === 'APPROVED') throw conflict('This scan was already confirmed and cannot be cancelled.');

  await prisma.imageScanItem.updateMany({ where: { scanId: scan.id }, data: { reviewState: 'REJECTED' } });
  const updated = await prisma.imageScan.update({
    where: { id: scan.id },
    data: { status: 'REJECTED', failureReason: reason },
  });

  await recordAudit(prisma, scope, {
    action: 'AI_SCAN_REJECTED',
    entityType: 'ImageScan',
    entityId: scan.id,
    after: { reason },
    source: 'IMAGE_SCAN',
  });

  await prisma.notification.deleteMany({
    where: { businessId: scope.businessId, dedupeKey: `scan-${scan.id}` },
  });

  return updated;
}
