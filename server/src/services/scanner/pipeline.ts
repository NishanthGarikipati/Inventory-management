import { prisma } from '../../db/prisma.js';
import type { TenantScope } from '../../db/tenant.js';
import { conflict, notFound } from '../../domain/errors.js';
import type { ScanType } from '../../domain/enums.js';
import { objectStorage } from '../../storage/objectStorage.js';
import { logger } from '../../utils/logger.js';
import { matchProduct, FUZZY_MATCH_FLOOR, FUZZY_MATCH_STRONG } from '../matching.service.js';
import { recordAudit } from '../audit.service.js';
import { raiseNotification } from '../notification.service.js';
import { checkImageQuality } from './quality.js';
import { getExtractionProvider, getFallbackProvider } from './providers/index.js';
import { validateExtractedItem } from './validation.js';
import type { ExtractionResult } from './types.js';

export interface UploadScanInput {
  buffer: Buffer;
  mimeType: string;
  scanType: ScanType;
  /** Text recognised on the device, if the phone could read it. */
  ocrText?: string;
  /** Barcodes decoded by the camera - these outrank anything the AI reads. */
  barcodes?: string[];
  supplierId?: string | null;
}

/**
 * Stage 1: accept the photo.
 *
 * Quality gate and duplicate detection happen before a single byte is stored
 * or an AI call is made. Processing is kicked off separately so the POS is
 * never blocked while a photo is being read.
 */
export async function uploadScan(scope: TenantScope, input: UploadScanInput) {
  const quality = checkImageQuality(input.buffer, input.mimeType);

  if (!quality.ok) {
    const stored = await objectStorage.put(scope.businessId, input.buffer, extensionFor(input.mimeType));
    const scan = await prisma.imageScan.create({
      data: {
        businessId: scope.businessId,
        userId: scope.userId || null,
        imageRef: stored.ref,
        imageHash: stored.hash,
        mimeType: input.mimeType,
        sizeBytes: stored.sizeBytes,
        scanType: input.scanType,
        status: 'FAILED',
        failureReason: quality.advice ?? 'The photo could not be read.',
      },
    });
    await prisma.imageScanResult.create({
      data: { scanId: scan.id, stage: 'QUALITY', provider: 'quality-check', payload: JSON.stringify(quality) },
    });
    return { scan, quality };
  }

  const stored = await objectStorage.put(scope.businessId, input.buffer, extensionFor(input.mimeType));

  // The same photo sent twice (double tap, offline retry) must not become two
  // stock updates.
  const duplicate = await prisma.imageScan.findFirst({
    where: {
      businessId: scope.businessId,
      imageHash: stored.hash,
      status: { in: ['UPLOADED', 'PROCESSING', 'EXTRACTED', 'REVIEW_REQUIRED', 'APPROVED'] },
      createdAt: { gte: new Date(Date.now() - 24 * 3600_000) },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (duplicate) {
    throw conflict('You already scanned this photo.', [
      { label: 'Open Previous Scan', action: 'OPEN_SCAN', payload: { scanId: duplicate.id } },
      { label: 'Take New Photo', action: 'RETAKE' },
    ]);
  }

  const scan = await prisma.imageScan.create({
    data: {
      businessId: scope.businessId,
      userId: scope.userId || null,
      imageRef: stored.ref,
      imageHash: stored.hash,
      mimeType: input.mimeType,
      sizeBytes: stored.sizeBytes,
      scanType: input.scanType,
      status: 'UPLOADED',
      supplierId: input.supplierId ?? null,
    },
  });

  await prisma.imageScanResult.create({
    data: { scanId: scan.id, stage: 'QUALITY', provider: 'quality-check', payload: JSON.stringify(quality) },
  });

  if (input.barcodes?.length) {
    await prisma.imageScanResult.create({
      data: {
        scanId: scan.id,
        stage: 'BARCODE',
        provider: 'device-camera',
        payload: JSON.stringify({ barcodes: input.barcodes }),
      },
    });
  }
  if (input.ocrText) {
    await prisma.imageScanResult.create({
      data: {
        scanId: scan.id,
        stage: 'OCR',
        provider: 'device-ocr',
        payload: JSON.stringify({ text: input.ocrText.slice(0, 20000) }),
      },
    });
  }

  return { scan, quality };
}

/**
 * Stage 2: read the photo, match products, score confidence and park
 * everything on the review screen. This function never changes stock.
 */
export async function processScan(scope: TenantScope, scanId: string) {
  const scan = await prisma.imageScan.findFirst({ where: { id: scanId, businessId: scope.businessId } });
  if (!scan) throw notFound('Scan');
  if (['APPROVED', 'REJECTED'].includes(scan.status)) {
    throw conflict('This scan is already finished.');
  }

  await prisma.imageScan.update({ where: { id: scan.id }, data: { status: 'PROCESSING' } });

  const [business, settings, ocrRow, barcodeRow] = await Promise.all([
    prisma.business.findUnique({ where: { id: scope.businessId } }),
    prisma.businessSettings.findUnique({ where: { businessId: scope.businessId } }),
    prisma.imageScanResult.findFirst({ where: { scanId: scan.id, stage: 'OCR' } }),
    prisma.imageScanResult.findFirst({ where: { scanId: scan.id, stage: 'BARCODE' } }),
  ]);

  const ocrText = ocrRow ? (JSON.parse(ocrRow.payload).text as string) : undefined;
  const barcodes = barcodeRow ? (JSON.parse(barcodeRow.payload).barcodes as string[]) : [];

  let extraction: ExtractionResult;
  let provider = getExtractionProvider();
  const startedAt = Date.now();

  try {
    const imageBuffer = await objectStorage.get(scan.imageRef);
    const knownProductNames = await prisma.product
      .findMany({ where: { businessId: scope.businessId, isActive: true }, select: { name: true }, take: 200 })
      .then((rows) => rows.map((r) => r.name));

    try {
      extraction = await provider.extract({
        scanType: scan.scanType as ScanType,
        imageBuffer,
        mimeType: scan.mimeType,
        ocrText,
        barcodes,
        businessType: business?.businessType,
        knownProductNames,
      });
    } catch (error) {
      logger.warn({ err: error, scanId: scan.id }, 'primary extraction provider failed, falling back');
      provider = getFallbackProvider();
      extraction = await provider.extract({
        scanType: scan.scanType as ScanType,
        imageBuffer,
        mimeType: scan.mimeType,
        ocrText,
        barcodes,
        businessType: business?.businessType,
      });
    }
  } catch (error) {
    logger.error({ err: error, scanId: scan.id }, 'scan processing failed');
    const failed = await prisma.imageScan.update({
      where: { id: scan.id },
      data: {
        status: 'FAILED',
        failureReason: 'We could not read this photo. Please enter the details by hand.',
        processedAt: new Date(),
      },
    });
    return { scan: failed, items: [] };
  }

  await prisma.imageScanResult.create({
    data: {
      scanId: scan.id,
      stage: 'VISION',
      provider: extraction.provider,
      payload: JSON.stringify(extraction).slice(0, 100_000),
      durationMs: Date.now() - startedAt,
    },
  });

  if (extraction.multipleDocuments) {
    await prisma.imageScan.update({
      where: { id: scan.id },
      data: { failureReason: 'Multiple documents detected. Please scan one at a time.' },
    });
  }

  const allowedTaxRates = await prisma.tax
    .findMany({ where: { businessId: scope.businessId }, select: { rate: true } })
    .then((rows) => rows.map((r) => r.rate));

  const validationPayload: unknown[] = [];
  const matchPayload: unknown[] = [];

  await prisma.imageScanItem.deleteMany({ where: { scanId: scan.id } });

  let lineNumber = 0;
  const createdItems = [];

  for (const item of extraction.items) {
    lineNumber += 1;
    const validated = validateExtractedItem(
      {
        productName: item.productName,
        quantity: item.quantity ?? null,
        unit: item.unit ?? null,
        purchasePrice: item.purchasePrice ?? null,
        sellingPrice: item.sellingPrice ?? null,
        mrp: item.mrp ?? null,
        barcode: item.barcode ?? null,
        batch: item.batch ?? null,
        expiry: item.expiry ?? null,
        taxRate: item.taxRate ?? null,
      },
      {
        allowedTaxRates,
        maxQuantity: 100_000,
        maxPricePaise: 10_000_000_00,
        scanType: scan.scanType,
      },
    );
    validationPayload.push({ line: lineNumber, name: validated.productName, issues: validated.issues });

    const match = await matchProduct(prisma, scope.businessId, {
      name: validated.productName,
      barcode: validated.barcode,
    });
    matchPayload.push({
      line: lineNumber,
      method: match.method,
      score: match.score,
      best: match.best?.name ?? null,
    });

    const blocking = validated.issues.filter((issue) => issue.severity === 'BLOCK');
    const reviewState = blocking.length ? 'NEEDS_INPUT' : 'PENDING';

    const created = await prisma.imageScanItem.create({
      data: {
        scanId: scan.id,
        lineNumber,
        extractedProductName: validated.productName,
        extractedRaw: item.raw ?? null,
        barcode: validated.barcode,
        matchedVariantId: match.best?.variantId ?? null,
        matchMethod: match.method,
        matchScore: match.score,
        matchCandidates: JSON.stringify(match.candidates.slice(0, 5)),
        quantity: validated.quantity,
        unitHint: validated.unit,
        purchasePricePaise: validated.purchasePricePaise,
        sellingPricePaise: validated.sellingPricePaise,
        mrpPaise: validated.mrpPaise,
        taxRate: validated.taxRate,
        batch: validated.batch,
        expiry: validated.expiry,
        confidence: item.confidence,
        fieldConfidence: JSON.stringify({
          ...(item.fieldConfidence ?? {}),
          match: match.score,
          issues: validated.issues,
        }),
        reviewState,
        // Only propose creating a product when nothing in the catalogue is
        // even close - duplicates are worse than an extra confirmation tap.
        createNewProduct: !match.best && match.score < FUZZY_MATCH_FLOOR,
      },
    });
    createdItems.push(created);
  }

  await prisma.imageScanResult.createMany({
    data: [
      {
        scanId: scan.id,
        stage: 'VALIDATION',
        provider: 'business-rules',
        payload: JSON.stringify(validationPayload).slice(0, 100_000),
      },
      {
        scanId: scan.id,
        stage: 'MATCHING',
        provider: 'matcher',
        payload: JSON.stringify(matchPayload).slice(0, 100_000),
      },
    ],
  });

  const supplierName = extraction.supplier ?? null;
  const status = createdItems.length ? 'REVIEW_REQUIRED' : 'FAILED';

  const updated = await prisma.imageScan.update({
    where: { id: scan.id },
    data: {
      status,
      provider: extraction.provider,
      extractedSupplierName: supplierName,
      invoiceNumber: extraction.invoiceNumber ?? null,
      invoiceDate: extraction.invoiceDate ? new Date(extraction.invoiceDate) : null,
      overallConfidence: extraction.overallConfidence,
      processedAt: new Date(),
      failureReason: createdItems.length
        ? extraction.multipleDocuments
          ? 'Multiple documents detected. Please scan one at a time.'
          : null
        : extraction.notes?.[0] ?? 'We could not read any products in this photo.',
    },
  });

  await recordAudit(prisma, scope, {
    action: 'AI_SCAN_EXTRACTED',
    entityType: 'ImageScan',
    entityId: scan.id,
    after: {
      provider: extraction.provider,
      itemCount: createdItems.length,
      overallConfidence: extraction.overallConfidence,
      supplier: supplierName,
    },
    meta: { imageRef: scan.imageRef, scanType: scan.scanType, notes: extraction.notes },
    source: 'IMAGE_SCAN',
  });

  if (status === 'REVIEW_REQUIRED') {
    await raiseNotification(prisma, scope.businessId, {
      type: 'SCAN_REVIEW',
      title: 'Waiting for your confirmation',
      body: `${createdItems.length} ${createdItems.length === 1 ? 'product was' : 'products were'} detected from your ${scan.scanType.toLowerCase().replace('_', ' ')}.`,
      severity: 'WARNING',
      dedupeKey: `scan-${scan.id}`,
      refType: 'ImageScan',
      refId: scan.id,
    });
  }

  return { scan: updated, items: createdItems, settings };
}

/** Review payload: what the AI read, how sure it is, what it wants to do. */
export async function getScanForReview(scope: TenantScope, scanId: string) {
  const scan = await prisma.imageScan.findFirst({
    where: { id: scanId, businessId: scope.businessId },
    include: {
      items: {
        orderBy: { lineNumber: 'asc' },
        include: {
          matchedVariant: {
            include: { product: { select: { name: true } }, inventory: true },
          },
        },
      },
      approvals: { include: { approvedBy: { select: { id: true, name: true } } } },
      corrections: true,
      supplier: true,
      results: { select: { id: true, stage: true, provider: true, durationMs: true, createdAt: true } },
    },
  });
  if (!scan) throw notFound('Scan');

  const settings = await prisma.businessSettings.findUnique({ where: { businessId: scope.businessId } });
  const high = settings?.confidenceHigh ?? 0.9;
  const medium = settings?.confidenceMedium ?? 0.7;

  return {
    ...scan,
    thresholds: { high, medium },
    items: scan.items.map((item) => {
      const fieldConfidence = JSON.parse(item.fieldConfidence) as Record<string, unknown>;
      const issues = (fieldConfidence.issues as Array<{ field: string; message: string; severity: string }>) ?? [];
      return {
        ...item,
        matchCandidates: JSON.parse(item.matchCandidates),
        fieldConfidence,
        issues,
        confidenceBand: band(item.confidence, high, medium),
        matchBand: band(item.matchScore, FUZZY_MATCH_STRONG, FUZZY_MATCH_FLOOR),
        matchedProductName: item.matchedVariant
          ? item.matchedVariant.isDefault
            ? item.matchedVariant.product.name
            : `${item.matchedVariant.product.name} - ${item.matchedVariant.name}`
          : null,
        currentStock: item.matchedVariant?.inventory?.quantity ?? null,
        /** Pre-ticked on the review screen; the owner still confirms. */
        suggestedForApproval:
          item.reviewState !== 'NEEDS_INPUT' && item.confidence >= high && item.matchScore >= FUZZY_MATCH_STRONG,
      };
    }),
  };
}

const band = (value: number, high: number, medium: number): 'HIGH' | 'MEDIUM' | 'LOW' =>
  value >= high ? 'HIGH' : value >= medium ? 'MEDIUM' : 'LOW';

export async function listScans(
  scope: TenantScope,
  filters: { status?: string; scanType?: string; limit?: number } = {},
) {
  return prisma.imageScan.findMany({
    where: {
      businessId: scope.businessId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.scanType ? { scanType: filters.scanType } : {}),
    },
    include: { _count: { select: { items: true } } },
    orderBy: { createdAt: 'desc' },
    take: Math.min(200, filters.limit ?? 50),
  });
}

export interface ScanItemCorrection {
  itemId: string;
  matchedVariantId?: string | null;
  createNewProduct?: boolean;
  quantity?: number | null;
  purchasePricePaise?: number | null;
  sellingPricePaise?: number | null;
  mrpPaise?: number | null;
  taxRate?: number | null;
  batch?: string | null;
  expiry?: string | null;
  productName?: string;
  reviewState?: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'NEEDS_INPUT';
}

/**
 * Records the owner's edits on the review screen. Every change is stored as a
 * correction row so the original AI value and the human value both survive.
 */
export async function reviewScan(scope: TenantScope, scanId: string, corrections: ScanItemCorrection[]) {
  const scan = await prisma.imageScan.findFirst({
    where: { id: scanId, businessId: scope.businessId },
    include: { items: true },
  });
  if (!scan) throw notFound('Scan');
  if (['APPROVED', 'REJECTED'].includes(scan.status)) throw conflict('This scan is already finished.');

  for (const correction of corrections) {
    const item = scan.items.find((i) => i.id === correction.itemId);
    if (!item) continue;

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const data: Record<string, unknown> = {};

    const track = <T>(field: string, current: T, next: T | undefined | null, column = field) => {
      if (next === undefined) return;
      if (next === current) return;
      changes[field] = { from: current, to: next };
      data[column] = next;
    };

    track('extractedProductName', item.extractedProductName, correction.productName);
    track('matchedVariantId', item.matchedVariantId, correction.matchedVariantId);
    track('quantity', item.quantity, correction.quantity);
    track('purchasePricePaise', item.purchasePricePaise, correction.purchasePricePaise);
    track('sellingPricePaise', item.sellingPricePaise, correction.sellingPricePaise);
    track('mrpPaise', item.mrpPaise, correction.mrpPaise);
    track('taxRate', item.taxRate, correction.taxRate);
    track('batch', item.batch, correction.batch);
    if (correction.expiry !== undefined) {
      const next = correction.expiry ? new Date(correction.expiry) : null;
      changes.expiry = { from: item.expiry, to: next };
      data.expiry = next;
    }
    if (correction.createNewProduct !== undefined) {
      data.createNewProduct = correction.createNewProduct;
      if (correction.createNewProduct) data.matchedVariantId = null;
    }
    if (correction.reviewState) data.reviewState = correction.reviewState;

    if (Object.keys(changes).length) {
      data.userCorrected = true;
      // Corrections resolve the blocking issues the AI could not read.
      if (item.reviewState === 'NEEDS_INPUT' && !correction.reviewState) data.reviewState = 'PENDING';
      for (const [field, change] of Object.entries(changes)) {
        await prisma.imageScanCorrection.create({
          data: {
            scanId: scan.id,
            scanItemId: item.id,
            field,
            originalValue: change.from === null || change.from === undefined ? null : String(change.from),
            correctedValue: change.to === null || change.to === undefined ? null : String(change.to),
            userId: scope.userId || null,
          },
        });
      }
    }

    if (Object.keys(data).length) {
      await prisma.imageScanItem.update({ where: { id: item.id }, data });
    }
  }

  return getScanForReview(scope, scanId);
}

const extensionFor = (mimeType: string): string => {
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('heic')) return 'heic';
  return 'jpg';
};
